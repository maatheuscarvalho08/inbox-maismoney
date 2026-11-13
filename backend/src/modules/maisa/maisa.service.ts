import cron from "node-cron";
import type { Prisma, StatusProposta } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { emitAvisoMaisa, emitCarrinhoNovo, emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { getConversaById } from "../conversas/conversas.service.js";
import { avancarEtapa } from "../funil/funil.service.js";
import { classificadorRegras } from "./classificador.js";
import { bancoFacta, bancoSimulado, type BancoClt } from "./bancos.js";
import { codigoBancoPorNome, contratar, contratarPortRefin, digitacaoConfigurada, factaConfigurada, type ResultadoContratacao } from "./facta.js";
import { extrairDados } from "./coleta.js";
import type { DadosContrato } from "./contrato.js";
import { avancar, type Efeito, type Entrada, type EstadoMaisa, type Passo, type ResultadoDigitacao } from "./fluxo.js";
import { FORMATOS_EXTRATO, lerArquivo, parcelaPeloExtrato, transcreverAudio } from "./midia.js";
import { TEXTOS } from "./textos.js";
import { guardarAnalise } from "../extratos/guardadas.js";
import { buscarAlternativa } from "./alternativas.js";
import { comModelo, responderLivre } from "./intencao.js";
import { TEXTO_FORA_DO_HORARIO, dentroDoHorario, proximaAbertura } from "./horario.js";
import type { ExtratoLido } from "../extratos/leitor.js";
import { executarReservada, invalidar, passarPontoSemVolta, recuperarOperacoesPresas, reservar } from "./operacaoFacta.js";
import { aguardarDespachos as aguardarDespachosLocal, criarNota, despachar, recuperarSaidas, registrarSaidas } from "./saidaMaisa.js";
import { DONO_PROCESSO, portasMaisa } from "./portasMaisa.js";
import { instanteEnvio, invalidaConfirmacao, mandadaDepoisOuJunto } from "./ordemMensagens.js";

export { portasMaisa, tempoDigitando } from "./portasMaisa.js";
export { aguardarDespachos, despachar, recuperarSaidas } from "./saidaMaisa.js";
import { INTERVALO_AVISO_ACEITE_MS, ehAceiteTardio } from "./aceiteTardio.js";

// Número fictício das conversas criadas pelo simulador. Nenhum número real começa assim.
export const PREFIXO_NUMERO_TESTE = "5500000";

const STATUS_PROPOSTA: Record<StatusProposta, string> = {
  digitada: "digitada, aguardando o banco",
  em_analise: "em análise no banco",
  aprovada: "aprovada",
  paga: "paga",
  recusada: "recusada pelo banco",
  cancelada: "cancelada",
};

type ConversaMaisa = Prisma.ConversaGetPayload<{ include: { contato: true; instancia: true } }>;

const ehTeste = (conversa: ConversaMaisa) => conversa.contato.numeroWhatsapp.startsWith(PREFIXO_NUMERO_TESTE);

// Conversa de teste sempre usa o banco de mentira: o número dela não existe.
function bancoDaConversa(conversa: ConversaMaisa): BancoClt | null {
  if (ehTeste(conversa) || env.MAISA_BANCO_SIMULADO) return bancoSimulado;
  if (factaConfigurada()) return bancoFacta;
  return null;
}

export function bancoConfigurado() {
  return env.MAISA_BANCO_SIMULADO ? "simulado" : factaConfigurada() ? "facta" : "nenhum";
}

async function cpfDoContato(contatoId: string) {
  const contato = await prisma.contato.findUnique({ where: { id: contatoId }, select: { cpf: true } });
  if (!contato?.cpf) throw new Error("CPF não encontrado no contato");
  return contato.cpf;
}

async function ultimaProposta(contatoId: string) {
  const proposta = await prisma.proposta.findFirst({
    where: { conversa: { contatoId } },
    orderBy: { createdAt: "desc" },
  });
  return proposta ? { banco: proposta.banco, status: STATUS_PROPOSTA[proposta.status] } : null;
}

// Efeitos do passo, dentro da transação que grava o estado. Transferir e encerrar já
// estão na própria atualização da conversa; a nota da transferência é gravada à parte.
async function aplicarEfeito(tx: Prisma.TransactionClient, conversa: ConversaMaisa, efeito: Efeito) {
  const etapaAtual = async () => (await tx.conversa.findUnique({ where: { id: conversa.id }, select: { etapaFunil: true } }))?.etapaFunil ?? null;
  switch (efeito.tipo) {
    case "convenio":
      // Convênio definido por uma pessoa da equipe vale mais que o da Maisa.
      if (conversa.convenioOrigem !== "operador") {
        await tx.conversa.update({ where: { id: conversa.id }, data: { convenio: efeito.convenio, convenioOrigem: "maisa" } });
      }
      return;
    case "cpf":
      await tx.contato.update({ where: { id: conversa.contatoId }, data: { cpf: efeito.cpf } });
      await avancarEtapa(conversa.id, "dados_coletados", await etapaAtual(), tx);
      return;
    case "simulacao": {
      const r = efeito.resultado;
      await tx.simulacao.create({
        data: {
          conversaId: conversa.id,
          banco: r.banco,
          convenio: efeito.convenio,
          resultado: r.tipo,
          valorCentavos: r.tipo === "com_saldo" ? r.valorCentavos : null,
          motivo: r.tipo === "com_saldo" ? null : r.motivo,
        },
      });
      // Erro na API do banco não é simulação concluída, então não move o funil.
      if (r.tipo !== "erro") await avancarEtapa(conversa.id, r.tipo === "com_saldo" ? "simulacao_com_saldo" : "simulacao", await etapaAtual(), tx);
      return;
    }
    case "proposta":
      // A proposta já foi gravada junto com a conclusão da operação (operacaoFacta.ts).
      await avancarEtapa(conversa.id, "proposta_digitada", await etapaAtual(), tx);
      return;
    case "transferir":
    case "encerrar":
      return;
  }
}

function exigir<T>(valor: T | undefined | null, campo: string): T {
  if (valor === undefined || valor === null || valor === "") throw new Error(`falta ${campo}`);
  return valor;
}

async function digitarProposta(
  conversa: ConversaMaisa,
  estado: EstadoMaisa | null,
  d: DadosContrato,
  pontoSemVolta: () => Promise<boolean>,
): Promise<ResultadoContratacao> {
  const produto = estado?.produto;
  if (produto !== "inss" && produto !== "siape") throw new Error("digitação só para INSS e SIAPE");
  const base = {
    cpf: await cpfDoContato(conversa.contatoId),
    dataNascimento: exigir(estado?.dataNascimento, "data de nascimento"),
    celular: conversa.contato.numeroWhatsapp,
    pessoa: pessoaDoContrato(d),
    pontoSemVolta,
  };
  // Port + refin aceito: compra o contrato do outro banco e libera o troco.
  const port = estado?.alternativa;
  const resultado =
    port?.digitacao && port.numeroContrato
      ? await contratarPortRefin({
          ...base,
          port: port.digitacao.port,
          refin: exigir(port.digitacao.refin, "tabela do refin da port"),
          compra: {
            bancoCodigo: exigir(port.digitacao.bancoCodigo, "código do banco de origem"),
            numeroContrato: port.numeroContrato,
            parcela: port.digitacao.parcela,
            prazoRestante: port.digitacao.prazoRestante,
            prazoOriginal: port.digitacao.prazoOriginal,
            saldoDevedor: port.digitacao.saldoDevedor,
          },
        })
      : await contratar({ ...base, convenio: produto, tabela: exigir(estado?.oferta?.tabela, "tabela da oferta") });
  console.log(`Maisa digitou na Facta, conversa ${conversa.id}: ${resultado.tipo === "enviada" ? `proposta ${resultado.codigoAf}` : `erro em ${resultado.etapa}`}`);
  return resultado;
}

function pessoaDoContrato(d: DadosContrato) {
  return {
    nome: exigir(d.nome, "nome"),
    sexo: exigir(d.sexo, "sexo"),
    estadoCivil: exigir(d.estadoCivil, "estado civil"),
    rg: exigir(d.rg, "RG"),
    estadoRg: exigir(d.estadoRg, "UF do RG"),
    orgaoEmissor: exigir(d.orgaoEmissor, "órgão emissor"),
    dataExpedicao: exigir(d.dataExpedicao, "data de expedição"),
    estadoNatural: exigir(d.estadoNatural, "UF de nascimento"),
    cidadeNatural: exigir(d.cidadeNatural, "cidade de nascimento"),
    renda: exigir(d.renda, "renda"),
    cep: exigir(d.cep, "CEP"),
    endereco: exigir(d.endereco, "endereço"),
    numero: exigir(d.numero, "número"),
    complemento: d.complemento ?? "",
    bairro: exigir(d.bairro, "bairro"),
    cidade: exigir(d.cidade, "cidade"),
    estado: exigir(d.estado, "UF"),
    nomeMae: exigir(d.nomeMae, "nome da mãe"),
    nomePai: exigir(d.nomePai, "nome do pai"),
    // Decisão do dono: patrimônio sempre faixa 1 (até R$ 10 mil), sem perguntar ao cliente.
    valorPatrimonio: d.valorPatrimonio ?? "1",
    matricula: exigir(d.matricula, "matrícula"),
    email: exigir(d.email, "e-mail"),
    tipoCreditoNb: d.tipoCreditoNb,
    tipoBeneficio: d.tipoBeneficio,
    bancoConta: d.bancoConta,
    agencia: d.agencia,
    conta: d.conta,
  };
}

// ---------- lease por conversa ----------
// Um processo por vez em cada conversa, também entre instâncias. O lease vence sozinho
// (o processo pode cair) e é renovado enquanto o processamento roda.
const LEASE_S = 90;

async function pegarLease(conversaId: string) {
  const n = await prisma.$executeRaw`
    UPDATE conversas SET maisa_lease_ate = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_S}), maisa_lease_dono = ${DONO_PROCESSO}
    WHERE id = ${conversaId} AND (maisa_lease_ate IS NULL OR maisa_lease_ate < (now() AT TIME ZONE 'UTC') OR maisa_lease_dono = ${DONO_PROCESSO})`;
  return n === 1;
}
async function renovarLease(conversaId: string) {
  await prisma.$executeRaw`
    UPDATE conversas SET maisa_lease_ate = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_S})
    WHERE id = ${conversaId} AND maisa_lease_dono = ${DONO_PROCESSO}`;
}
async function soltarLease(conversaId: string) {
  await prisma.$executeRaw`UPDATE conversas SET maisa_lease_ate = NULL, maisa_lease_dono = NULL WHERE id = ${conversaId} AND maisa_lease_dono = ${DONO_PROCESSO}`;
}

// O que fez a Maisa andar: uma mensagem do cliente ou uma checagem do relógio.
// reler: a equipe mandou a Maisa ler de novo um arquivo antigo (o extrato).
type Gatilho = { mensagemId: string; reler?: boolean } | { evento: "verificar_autorizacao" | "verificar_oferta" | "executar_digitacao" };

// Outra gravação mudou o estado no meio (operador devolveu a conversa, outro processo).
class ConflitoEstado extends Error {}
// Outro processo está com a conversa: tenta de novo daqui a pouco.
class ConversaOcupada extends Error {}

// Ordem de leitura das mensagens: recebimento e, no empate, o id.
const depoisDe = (m: { createdAt: Date; id: string }, em?: string, id?: string) => {
  if (!em) return true;
  const t = m.createdAt.getTime(), e = new Date(em).getTime();
  return t > e || (t === e && id !== undefined && m.id > id);
};

const SAIDAS_COM_OFERTA = (e: EstadoMaisa | null) => Boolean(e && (e.oferta || e.alternativa));

// Mensagem relevante do cliente mandada depois do "sim" (horário do WhatsApp, mesmo
// segundo conta) ou recebida depois dele. Neutras ("obrigado", "ok", 👍) não contam.
async function mensagemDepoisDoSim(conversaId: string, simMensagemId: string | undefined, recebidoEm: string) {
  const sim = simMensagemId ? await prisma.mensagem.findUnique({ where: { id: simMensagemId } }) : null;
  const ref = sim ?? { id: "", timestamp: null, createdAt: new Date(recebidoEm) };
  const desdeSegundo = new Date(Math.floor(instanteEnvio(ref).getTime() / 1000) * 1000);
  const candidatas = await prisma.mensagem.findMany({
    where: {
      conversaId,
      remetenteTipo: "cliente",
      ...(ref.id ? { id: { not: ref.id } } : {}),
      OR: [{ createdAt: { gt: ref.createdAt } }, { timestamp: { gte: desdeSegundo } }],
    },
    select: { id: true, timestamp: true, createdAt: true, conteudoTexto: true, tipoMidia: true },
  });
  return candidatas.some((m) => invalidaConfirmacao(m) && (m.createdAt > ref.createdAt || mandadaDepoisOuJunto(m, ref)));
}

async function processar(conversaId: string, gatilho: Gatilho) {
  if (env.MAISA_MODO === "desligado") return;
  if (!(await pegarLease(conversaId))) throw new ConversaOcupada(conversaId);
  const renovacao = setInterval(() => void renovarLease(conversaId).catch(() => {}), (LEASE_S / 3) * 1000);
  try {
    await processarComLease(conversaId, gatilho);
  } finally {
    clearInterval(renovacao);
    await soltarLease(conversaId).catch(() => {});
  }
}

async function processarComLease(conversaId: string, gatilho: Gatilho) {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { contato: true, instancia: true },
  });
  if (!conversa || conversa.status === "encerrada") return;
  // Fora da Maisa: ela não responde. Se o cliente disser que quer seguir, avisa a equipe.
  if (!conversa.comMaisa || !conversa.instancia.maisaAtiva) {
    if ("mensagemId" in gatilho && !conversa.comMaisa) await avisarAceiteTardio(conversa, gatilho.mensagemId);
    return;
  }
  const versaoLida = conversa.maisaVersao;
  const estadoAntes = (conversa.maisaEstado as EstadoMaisa | null) ?? null;

  let entrada: Entrada;
  let arquivo: { midiaPath: string; tipo: string } | null = null;
  let lida: { id: string; createdAt: Date } | null = null;
  if ("mensagemId" in gatilho) {
    const mensagem = await prisma.mensagem.findUnique({ where: { id: gatilho.mensagemId } });
    if (!mensagem || mensagem.remetenteTipo !== "cliente" || mensagem.conversaId !== conversa.id) return;
    // Já lida (webhook repetido, recuperação depois de reinício): não lê de novo.
    if (!gatilho.reler && estadoAntes?.ultimaMensagemEm && !depoisDe(mensagem, estadoAntes.ultimaMensagemEm, estadoAntes.ultimaMensagemId)) {
      registrarProcesso("mensagem_ja_lida", conversa.id, mensagem.id);
      return;
    }
    lida = { id: mensagem.id, createdAt: mensagem.createdAt };
    const tipo = mensagem.tipoMidia?.split(";")[0].trim() ?? null;
    if (tipo && mensagem.midiaPath && !mensagem.midiaDeleted) arquivo = { midiaPath: mensagem.midiaPath, tipo };
    const documento = Boolean(arquivo && FORMATOS_EXTRATO.includes(arquivo.tipo));
    entrada = { texto: mensagem.conteudoTexto, temMidia: Boolean(tipo), documento, mensagemId: mensagem.id, ...(documento ? { documentoId: mensagem.id } : {}) };
    // Áudio: ela escuta e segue como se o cliente tivesse escrito. Se falhar, vai para a equipe.
    if (arquivo?.tipo.startsWith("audio/") && env.OPENAI_API_KEY) {
      try {
        const texto = await transcreverAudio(await lerArquivo(arquivo.midiaPath), arquivo.tipo);
        if (texto) entrada = { texto, temMidia: false, mensagemId: mensagem.id };
        console.log(`Maisa transcreveu áudio da conversa ${conversa.id} (${texto.length} caracteres)`);
      } catch (err) {
        console.error(`Maisa não conseguiu transcrever o áudio da conversa ${conversa.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } else {
    entrada = gatilho;
  }

  const banco = bancoDaConversa(conversa);
  const semBanco = () => Promise.reject(new Error("Nenhum banco configurado para a Maisa"));
  const passo: Passo = await avancar(estadoAntes, entrada, {
    classificador: comModelo(classificadorRegras),
    responderLivre,
    agora: portasMaisa.agora,
    solicitarAutorizacao: async (nome) =>
      banco
        ? banco.solicitarAutorizacao({ cpf: await cpfDoContato(conversa.contatoId), nome, celular: conversa.contato.numeroWhatsapp })
        : semBanco(),
    consultar: async () => (banco ? banco.consultar(await cpfDoContato(conversa.contatoId)) : semBanco()),
    statusProposta: () => ultimaProposta(conversa.contatoId),
    simularPorExtrato: async (convenio, dataNascimento, documentoId) => {
      if (!banco) return semBanco();
      // Extrato que chegou antes da hora: lê o arquivo daquela mensagem.
      let doc = arquivo;
      let docId = "mensagemId" in gatilho ? gatilho.mensagemId : null;
      if (documentoId) {
        const m = await prisma.mensagem.findUnique({ where: { id: documentoId } });
        const tipo = m?.tipoMidia?.split(";")[0].trim();
        doc = m?.midiaPath && tipo && !m.midiaDeleted ? { midiaPath: m.midiaPath, tipo } : null;
        docId = documentoId;
      }
      if (!doc) return { tipo: "extrato_invalido", motivo: "arquivo não encontrado" };
      const inicio = Date.now();
      const { resultado: leitura, registro } = await parcelaPeloExtrato(await lerArquivo(doc.midiaPath), doc.tipo, convenio);
      // A equipe vê no balão do arquivo o que ela leu e por que não passou.
      if (docId) {
        await guardarAnalise(docId, registro).catch((err) =>
          console.error(`Não foi possível guardar a análise do extrato da conversa ${conversa.id}:`, err),
        );
      }
      // Registro de acesso a documento sensível, sem dado pessoal.
      console.log(`Maisa leu extrato ${convenio} da conversa ${conversa.id}: ${leitura.tipo} ${Date.now() - inicio}ms`);
      const cpf = await cpfDoContato(conversa.contatoId);
      // Sem empréstimo novo: antes de desistir, vê se dá para portar ou refinanciar.
      // Renda e matrícula do documento vão junto: o contrato não pergunta de novo.
      const lido = registro.leitura as ExtratoLido;
      const bancoSal = lido.conta_banco ? codigoBancoPorNome(lido.conta_banco) : null;
      const agenciaSal = (lido.conta_agencia ?? "").replace(/\D/g, "");
      const contaSal = (lido.conta_numero ?? "").replace(/\D/g, "");
      const contaSalario = bancoSal && agenciaSal.length >= 3 && contaSal.length >= 4 ? { bancoConta: bancoSal, agencia: agenciaSal, conta: contaSal } : null;
      const lidos = { renda: lido.renda_bruta ?? lido.base_calculo, matricula: lido.matricula, contaSalario };
      const alternativa = async () => {
        const alt = await buscarAlternativa({ convenio, analise: registro.analise, banco, cpf, dataNascimento });
        return alt ? { ...alt, ...lidos } : null;
      };
      // Mesmo com leitura em dúvida: se a Facta abrir tabela, ela oferta. Se não abrir e
      // houver dúvida, a equipe confere (o fluxo trata "revisar").
      if (leitura.tipo === "sem_saldo") return (await alternativa()) ?? leitura;
      if (leitura.tipo !== "ok") return leitura;
      const resultado = await banco.simularConsignado({ convenio, cpf, dataNascimento, parcelaMaxima: leitura.parcelaMaxima });
      if (resultado.tipo === "sem_saldo") return (await alternativa()) ?? resultado;
      return resultado.tipo === "com_saldo" ? { ...resultado, renda: leitura.renda, especie: leitura.especie, matricula: leitura.matricula, contaSalario } : resultado;
    },
    digitacaoAtiva: env.MAISA_DIGITA_PROPOSTA && (banco === bancoSimulado || (banco === bancoFacta && digitacaoConfigurada())),
    // Trava própria, independente do código master. Desligada por padrão.
    digitacaoLiberada: env.MAISA_DIGITACAO_LIBERADA,
    janelaConfirmacaoMs: env.MAISA_JANELA_CONFIRMACAO_S * 1000,
    followupPort: env.MAISA_FOLLOWUP_PORT,
    mensagemDepoisDoSim: (simId, recebidoEm) => mensagemDepoisDoSim(conversa.id, simId, recebidoEm),
    extrairDados: async (pergunta, recebida, faltando) => {
      const doc = recebida.documento && arquivo ? { conteudo: await lerArquivo(arquivo.midiaPath), tipo: arquivo.tipo } : null;
      const dados = await extrairDados(pergunta, recebida.texto, doc, faltando);
      console.log(`Maisa leu dados do contrato na conversa ${conversa.id}: ${Object.keys(dados).length} campo(s)`);
      return dados;
    },
    digitar: (dados) => digitarComSeguranca(conversa, estadoAntes, dados, banco === bancoSimulado),
  });

  // A mensagem lida passa a ser a última: a recuperação e a digitação contam a partir dela.
  // Releitura de arquivo antigo não faz a marca voltar no tempo.
  const avanca = lida && depoisDe(lida, passo.estado.ultimaMensagemEm, passo.estado.ultimaMensagemId);
  const estadoNovo: EstadoMaisa = lida && avanca ? { ...passo.estado, ultimaMensagemId: lida.id, ultimaMensagemEm: lida.createdAt.toISOString() } : passo.estado;

  // Checagem sem novidade: só guarda quando checar de novo, sem registro nem aviso.
  const mudouEtapa = passo.estado.etapa !== estadoAntes?.etapa;
  if (!lida && !mudouEtapa && !passo.respostas.length && !passo.efeitos.length) {
    const r = await prisma.conversa.updateMany({
      where: { id: conversa.id, maisaVersao: versaoLida },
      data: { maisaEstado: estadoNovo as unknown as Prisma.InputJsonValue, maisaVersao: { increment: 1 } },
    });
    if (!r.count) throw new ConflitoEstado(`estado da conversa ${conversa.id} mudou durante o processamento`);
    return;
  }

  const transferencia = passo.efeitos.find((e) => e.tipo === "transferir");
  const encerramento = passo.efeitos.find((e) => e.tipo === "encerrar");
  // Finalizada pela Maisa nunca continua com ela (o banco também recusa esse estado).
  const sai = estadoNovo.etapa === "finalizada";
  const respostas = [...passo.respostas];
  if (transferencia && !dentroDoHorario()) respostas.push(TEXTO_FORA_DO_HORARIO(proximaAbertura()));
  const enviar = env.MAISA_MODO === "automatico" && !ehTeste(conversa);

  // Uma transação: estado, saída da Maisa, efeitos, evento, nota e respostas. Ou tudo
  // fica gravado, ou nada (e a mensagem é lida de novo).
  const gravarPasso = () => prisma.$transaction(async (tx) => {
    const r = await tx.conversa.updateMany({
      where: { id: conversa.id, maisaVersao: versaoLida },
      data: {
        maisaEstado: estadoNovo as unknown as Prisma.InputJsonValue,
        maisaVersao: { increment: 1 },
        ...(sai ? { comMaisa: false } : {}),
        ...(encerramento ? { status: "encerrada" as const } : {}),
        ...(estadoNovo.saida === "carrinho" ? { carrinhoEm: new Date() } : {}),
      },
    });
    if (!r.count) throw new ConflitoEstado(`estado da conversa ${conversa.id} mudou durante o processamento`);
    for (const efeito of passo.efeitos) await aplicarEfeito(tx, conversa, efeito);
    await tx.maisaEvento.create({
      data: {
        conversaId: conversa.id,
        etapaAntes: estadoAntes?.etapa ?? null,
        etapaDepois: estadoNovo.etapa,
        rotulo: passo.rotulo,
        motivo: transferencia?.tipo === "transferir" ? transferencia.motivo : null,
      },
    });
    const notas = transferencia?.tipo === "transferir" && transferencia.nota ? [await criarNota(tx, conversa.id, transferencia.nota)] : [];
    const mensagens = await registrarSaidas(tx, conversa.id, respostas, enviar);
    return { notas, mensagens };
  });
  const gravado = await gravarPasso().catch(async (err) => {
    // A proposta já foi criada na Facta (e registrada junto com a operação), mas a conversa
    // mudou no meio: a equipe assumiu ou outro processo gravou. Avisa a equipe.
    const proposta = passo.efeitos.find((e) => e.tipo === "proposta");
    if (err instanceof ConflitoEstado && proposta?.tipo === "proposta") {
      const nota = await prisma.mensagem.create({ data: { conversaId: conversa.id, remetenteTipo: "nota", conteudoTexto: `A Maisa digitou a proposta ${proposta.codigoAf} na Facta, mas a conversa mudou no meio. O cliente pode não ter recebido o link: confira e envie.` } });
      emitirSemFalhar(() => emitNovaMensagem(nota));
      avisar({ tipo: "digitacao_incerta", conversaId: conversa.id, nome: conversa.contato.nome, detalhe: `proposta ${proposta.codigoAf}` });
    }
    throw err;
  });


  for (const m of [...gravado.notas, ...gravado.mensagens]) emitirSemFalhar(() => emitNovaMensagem(m));
  if (passo.rotulo === "digitacao_incerta" || passo.rotulo === "digitacao_bloqueada_cliente") {
    avisar({ tipo: passo.rotulo === "digitacao_incerta" ? "digitacao_incerta" : "digitacao_bloqueada", conversaId: conversa.id, nome: conversa.contato.nome, detalhe: transferencia?.tipo === "transferir" ? transferencia.motivo : undefined });
  }
  const atualizada = await getConversaById(conversa.id);
  if (atualizada) {
    emitirSemFalhar(() => emitConversaAtualizada(atualizada));
    if (estadoNovo.saida === "carrinho") emitirSemFalhar(() => emitCarrinhoNovo(atualizada));
  }
  // Entrega fora da transação e do lease: o despachante cuida da ordem e das falhas.
  if (gravado.mensagens.length && enviar) void despachar(conversa.id).catch((err) => console.error("Despachante da Maisa falhou:", err));
}

// Digitação com todas as travas: reserva por CPF, conferência de mensagem depois do "sim"
// já com a reserva gravada, ponto sem volta antes da etapa 3, proposta gravada junto.
async function digitarComSeguranca(conversa: ConversaMaisa, estado: EstadoMaisa | null, dados: DadosContrato, simulado: boolean): Promise<ResultadoDigitacao> {
  if (!estado) throw new Error("sem estado da conversa");
  // Conversa de teste (banco de mentira) nunca chama a Facta nem reserva CPF.
  if (simulado) return { tipo: "enviada", codigoAf: "TESTE", url: "" };
  const cpf = await cpfDoContato(conversa.contatoId);
  const reserva = await reservar(conversa.id, cpf, estado, portasMaisa.agora());
  if (!reserva.ok) return { tipo: "bloqueada", motivo: reserva.motivo, status: reserva.status, codigoAf: reserva.codigoAf };
  // Daqui em diante, mensagem nova do cliente invalida a reserva na própria gravação. O
  // que chegou antes da reserva é visto aqui.
  const p = estado.confirmacaoPendente;
  if (p && (await mensagemDepoisDoSim(conversa.id, p.mensagemId, p.recebidoEm))) {
    await invalidar(reserva.operacaoId, "mensagem do cliente depois do sim");
    return { tipo: "abortada", etapa: "antes da Facta", mensagem: "mensagem do cliente depois do sim" };
  }
  const oferta = estado.oferta;
  return executarReservada(
    reserva.operacaoId,
    {
      conversaId: conversa.id,
      convenio: estado.produto === "inss" || estado.produto === "siape" ? estado.produto : null,
      valorCentavos: oferta?.valorCentavos ?? estado.alternativa?.trocoCentavos ?? 0,
      parcelaCentavos: oferta?.parcelaCentavos ?? null,
      prazoMeses: oferta?.prazoMeses ?? null,
    },
    () => digitarProposta(conversa, estado, dados, () => passarPontoSemVolta(reserva.operacaoId)),
  );
}

// Cliente diz que quer seguir numa conversa que já saiu da Maisa depois de uma oferta.
// Só avisa: nada é executado. Não avisa se a equipe já está conversando com ele.
async function avisarAceiteTardio(conversa: ConversaMaisa, mensagemId: string) {
  const estado = (conversa.maisaEstado as EstadoMaisa | null) ?? null;
  if (!estado || estado.etapa !== "finalizada" || !SAIDAS_COM_OFERTA(estado)) return;
  const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
  if (!mensagem || mensagem.remetenteTipo !== "cliente" || !ehAceiteTardio(mensagem.conteudoTexto)) return;
  const agora = portasMaisa.agora();
  if (estado.avisoAceiteEm && agora.getTime() - new Date(estado.avisoAceiteEm).getTime() < INTERVALO_AVISO_ACEITE_MS) return;
  const [ultimaEquipe, ultimaMaisa] = await Promise.all([
    prisma.mensagem.findFirst({ where: { conversaId: conversa.id, remetenteTipo: "operador" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.mensagem.findFirst({ where: { conversaId: conversa.id, remetenteTipo: "maisa" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (ultimaEquipe && (!ultimaMaisa || ultimaEquipe.createdAt > ultimaMaisa.createdAt)) return;
  const onde = estado.saida === "carrinho" ? "estava no Carrinho" : `saiu da Maisa (${estado.motivoTransferencia ?? estado.saida ?? "passou para a equipe"})`;
  const nota = await prisma.$transaction(async (tx) => {
    // Grava a hora do aviso só se ninguém mudou o estado: dois avisos ao mesmo tempo viram um.
    const r = await tx.conversa.updateMany({
      where: { id: conversa.id, maisaVersao: conversa.maisaVersao },
      data: { maisaEstado: { ...estado, avisoAceiteEm: agora.toISOString() } as unknown as Prisma.InputJsonValue, maisaVersao: { increment: 1 } },
    });
    if (!r.count) return null;
    await tx.maisaEvento.create({ data: { conversaId: conversa.id, etapaAntes: "finalizada", etapaDepois: "finalizada", rotulo: "aceite_apos_transferencia", motivo: null } });
    return criarNota(
      tx,
      conversa.id,
      `ATENÇÃO: o cliente disse que quer seguir ("${(mensagem.conteudoTexto ?? "").slice(0, 120)}"). A conversa ${onde}. ` +
        "A Maisa não fez nada: chame o cliente e confira a oferta antes de digitar.",
    );
  });
  if (!nota) return;
  emitirSemFalhar(() => emitNovaMensagem(nota));
  avisar({ tipo: "aceite_apos_transferencia", conversaId: conversa.id, nome: conversa.contato.nome });
}

function avisar(aviso: Parameters<typeof emitAvisoMaisa>[0]) {
  emitirSemFalhar(() => emitAvisoMaisa(aviso));
}

function emitirSemFalhar(f: () => void) {
  try {
    f();
  } catch (err) {
    console.error("Não foi possível emitir pelo socket:", err instanceof Error ? err.message : err);
  }
}

function registrarProcesso(evento: string, conversaId: string, detalhe?: string) {
  console.log(JSON.stringify({ origem: "maisa", tipo: "processamento", evento, conversaId, detalhe: detalhe ?? null }));
}

// Uma coisa por vez em cada conversa dentro deste processo. Entre processos, quem
// garante é o lease, a versão do estado e a reserva da operação na Facta.
const filas = new Map<string, Promise<void>>();

function enfileirar(conversaId: string, gatilho: Gatilho, tentativa = 1): Promise<void> {
  const anterior = filas.get(conversaId) ?? Promise.resolve();
  const atual = anterior
    .then(() => processar(conversaId, gatilho))
    .catch(async (err) => {
      // Outro processo com a conversa, ou estado mudado no meio: tenta de novo. Se não der,
      // a recuperação pega a mensagem depois (ela continua não lida).
      if ((err instanceof ConversaOcupada || err instanceof ConflitoEstado) && tentativa < 20) {
        registrarProcesso(err instanceof ConversaOcupada ? "conversa_ocupada" : "conflito_estado", conversaId);
        setTimeout(() => void enfileirar(conversaId, gatilho, tentativa + 1), err instanceof ConversaOcupada ? 1500 : 0);
        return;
      }
      if (err instanceof ConversaOcupada) return;
      console.error(`Maisa falhou na conversa ${conversaId}:`, err);
      // Se ela quebrar no meio, o cliente não pode ficar sem resposta: vai para a fila.
      try {
        const nota = await prisma.$transaction(async (tx) => {
          const c = await tx.conversa.findUnique({ where: { id: conversaId } });
          if (!c?.comMaisa) return null;
          const e = (c.maisaEstado as EstadoMaisa | null) ?? null;
          await tx.conversa.update({
            where: { id: conversaId },
            data: {
              comMaisa: false,
              maisaVersao: { increment: 1 },
              ...(e ? { maisaEstado: { ...e, confirmacaoPendente: undefined } as unknown as Prisma.InputJsonValue } : {}),
            },
          });
          return criarNota(tx, conversaId, `Passei para a equipe: a Maisa teve um erro interno (${err instanceof Error ? err.message.slice(0, 200) : "desconhecido"}). Leia as últimas mensagens do cliente.`);
        });
        if (nota) emitirSemFalhar(() => emitNovaMensagem(nota));
        const conversa = await getConversaById(conversaId);
        if (conversa) emitirSemFalhar(() => emitConversaAtualizada(conversa));
      } catch (erroFila) {
        console.error("Não foi possível passar a conversa para a fila:", erroFila);
      }
    });
  filas.set(conversaId, atual);
  atual.finally(() => {
    if (filas.get(conversaId) === atual) filas.delete(conversaId);
  });
  return atual;
}

// Devolvida pela equipe: ela não espera o cliente escrever. Manda a saudação com a
// lista de produtos e fica na etapa do convênio.
async function retomar(conversaId: string) {
  if (env.MAISA_MODO === "desligado") return;
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { contato: true, instancia: true },
  });
  if (!conversa || !conversa.comMaisa || !conversa.instancia.maisaAtiva || conversa.status === "encerrada") return;
  // As mensagens de antes da devolução já foram vistas pela equipe: a Maisa começa daqui.
  const ultima = await prisma.mensagem.findFirst({ where: { conversaId, remetenteTipo: "cliente" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const estado: EstadoMaisa = { etapa: "convenio", tentativas: 0, ...(ultima ? { ultimaMensagemId: ultima.id, ultimaMensagemEm: ultima.createdAt.toISOString() } : {}) };
  const enviar = env.MAISA_MODO === "automatico" && !ehTeste(conversa);
  const mensagens = await prisma.$transaction(async (tx) => {
    await tx.conversa.update({ where: { id: conversaId }, data: { maisaEstado: estado as unknown as Prisma.InputJsonValue, maisaVersao: { increment: 1 } } });
    return registrarSaidas(tx, conversaId, [TEXTOS.saudacao], enviar);
  });
  for (const m of mensagens) emitirSemFalhar(() => emitNovaMensagem(m));
  if (enviar) void despachar(conversaId).catch(() => {});
}

export function retomarComMaisa(conversaId: string): Promise<void> {
  const anterior = filas.get(conversaId) ?? Promise.resolve();
  const atual = anterior
    .then(() => retomar(conversaId))
    .catch((err) => console.error(`Maisa não conseguiu retomar a conversa ${conversaId}:`, err));
  filas.set(conversaId, atual);
  atual.finally(() => {
    if (filas.get(conversaId) === atual) filas.delete(conversaId);
  });
  return atual;
}

export function processarComMaisa(conversaId: string, mensagemId: string): Promise<void> {
  return enfileirar(conversaId, { mensagemId });
}

// A equipe pediu para a Maisa ler de novo um arquivo que já estava na conversa.
export function relerComMaisa(conversaId: string, mensagemId: string): Promise<void> {
  return enfileirar(conversaId, { mensagemId, reler: true });
}

export function verificarAutorizacao(conversaId: string): Promise<void> {
  return enfileirar(conversaId, { evento: "verificar_autorizacao" });
}

// Para os testes: espera todas as filas esvaziarem, ou esquece todas (reinício).
export async function aguardarFilas() {
  // Processamentos e entregas: uma entrega pode gerar uma passagem para a equipe e vice-versa.
  for (let i = 0; i < 50; i++) {
    while (filas.size) await Promise.allSettled([...filas.values()]);
    await aguardarDespachosLocal();
    if (!filas.size) break;
  }
}
export function esquecerFilas() {
  filas.clear();
}

// Conversas esperando o cliente autorizar o link do banco e já na hora de checar.
export async function verificarAutorizacoesPendentes() {
  const esperando = await prisma.conversa.findMany({
    where: {
      comMaisa: true,
      status: { not: "encerrada" },
      maisaEstado: { path: ["etapa"], equals: "aguardando" },
    },
    select: { id: true, maisaEstado: true },
  });
  const agora = portasMaisa.agora().getTime();
  const naHora = esperando.filter((c) => {
    const proxima = (c.maisaEstado as EstadoMaisa | null)?.proximaVerificacao;
    return !proxima || new Date(proxima).getTime() <= agora;
  });
  for (const c of naHora) await verificarAutorizacao(c.id);
  return naHora.length;
}

// Ofertas ainda sem resposta: o fluxo decide se é hora do follow-up ou do carrinho.
// A de portabilidade só com MAISA_FOLLOWUP_PORT ligado.
export async function verificarOfertasPendentes() {
  const etapas = env.MAISA_FOLLOWUP_PORT ? ["oferta", "oferta_port"] : ["oferta"];
  const ofertadas = await prisma.conversa.findMany({
    where: { comMaisa: true, status: { not: "encerrada" }, OR: etapas.map((e) => ({ maisaEstado: { path: ["etapa"], equals: e } })) },
    select: { id: true },
  });
  for (const c of ofertadas) await enfileirar(c.id, { evento: "verificar_oferta" });
  return ofertadas.length;
}

// "sim" na confirmação com a janela vencida: tenta digitar (o fluxo revalida tudo).
// Sobrevive a reinício: o agendamento está no estado salvo, não num temporizador.
export async function executarDigitacoesPendentes() {
  const naConfirmacao = await prisma.conversa.findMany({
    where: { comMaisa: true, status: { not: "encerrada" }, instancia: { maisaAtiva: true }, maisaEstado: { path: ["etapa"], equals: "confirmacao" } },
    select: { id: true, maisaEstado: true },
  });
  const agora = portasMaisa.agora().getTime();
  const vencidas = naConfirmacao.filter((c) => {
    const p = (c.maisaEstado as EstadoMaisa | null)?.confirmacaoPendente;
    return p && new Date(p.executarEm).getTime() <= agora;
  });
  for (const c of vencidas) await enfileirar(c.id, { evento: "executar_digitacao" });
  return vencidas.length;
}

// Mensagens que chegaram e não foram lidas (o processo reiniciou no meio, ou caiu antes
// de ler). Lê na ordem. Só olha mensagens com mais de 20 segundos, para não disputar com
// o webhook que acabou de chegar, e conversas que não estão sendo processadas agora.
export async function recuperarMensagensNaoLidas(idadeMinimaMs = 20_000) {
  const agora = portasMaisa.agora().getTime();
  const conversas = await prisma.conversa.findMany({
    where: { comMaisa: true, status: { not: "encerrada" }, instancia: { maisaAtiva: true }, lastMessageAt: { gte: new Date(agora - 24 * 60 * 60_000) } },
    select: { id: true, maisaEstado: true, createdAt: true },
  });
  let total = 0;
  for (const c of conversas) {
    if (filas.has(c.id)) continue;
    const e = c.maisaEstado as EstadoMaisa | null;
    // Sem estado: só conversa nova (menos de 30 minutos) cuja primeira mensagem não foi lida.
    // Conversa antiga sem estado é a equipe devolvendo para a Maisa, e ela começa do zero.
    if (!e && agora - c.createdAt.getTime() > 30 * 60_000) continue;
    if (e && (!e.ultimaMensagemEm || e.etapa === "finalizada")) continue;
    const desde = e?.ultimaMensagemEm ? new Date(e.ultimaMensagemEm) : c.createdAt;
    const candidatas = await prisma.mensagem.findMany({
      where: { conversaId: c.id, remetenteTipo: "cliente", createdAt: { gte: desde, lte: new Date(agora - idadeMinimaMs) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
      select: { id: true, createdAt: true },
    });
    for (const m of candidatas.filter((m) => depoisDe(m, e?.ultimaMensagemEm, e?.ultimaMensagemId))) {
      registrarProcesso("mensagem_recuperada", c.id, m.id);
      void enfileirar(c.id, { mensagemId: m.id });
      total++;
    }
  }
  return total;
}

// Digitação parada no meio por queda do processo. "preparada" volta a poder tentar (a
// etapa 3 não foi chamada). "irreversivel" vira "desconhecida": a conversa sai da Maisa
// e a equipe confere no portal.
export async function recuperarDigitacoesPresas() {
  const presas = await recuperarOperacoesPresas(portasMaisa.agora());
  for (const op of presas) {
    const r = await prisma.$transaction(async (tx) => {
      const c = await tx.conversa.findUnique({ where: { id: op.conversaId }, include: { contato: true } });
      if (!c) return null;
      const e = (c.maisaEstado as EstadoMaisa | null) ?? null;
      if (c.comMaisa) {
        await tx.conversa.update({
          where: { id: c.id },
          data: { comMaisa: false, maisaVersao: { increment: 1 }, ...(e ? { maisaEstado: { ...e, confirmacaoPendente: undefined } as unknown as Prisma.InputJsonValue } : {}) },
        });
      }
      const nota = await criarNota(tx, c.id, "RESULTADO INCERTO: a digitação na Facta foi interrompida depois do ponto sem volta (o sistema reiniciou). A proposta pode existir: confira no portal Facta. Para tentar de novo, a operação precisa ser liberada.");
      return { nota, nome: c.contato.nome };
    });
    if (!r) continue;
    emitirSemFalhar(() => emitNovaMensagem(r.nota));
    avisar({ tipo: "digitacao_incerta", conversaId: op.conversaId, nome: r.nome });
  }
  return presas.length;
}

// Tudo o que um reinício pode ter deixado pela metade.
export async function recuperarMaisa() {
  await recuperarDigitacoesPresas();
  await recuperarSaidas();
  await executarDigitacoesPendentes();
  await recuperarMensagensNaoLidas();
}

export function startMaisaJobs() {
  if (env.MAISA_MODO === "desligado") return;
  // Ao subir: retoma o que ficou pela metade antes do reinício.
  void recuperarMaisa().catch((err) => console.error("Erro na recuperação da Maisa ao subir:", err));
  cron.schedule("* * * * *", async () => {
    try {
      await verificarAutorizacoesPendentes();
      await verificarOfertasPendentes();
    } catch (err) {
      console.error("Erro nas checagens de tempo da Maisa:", err);
    }
  });
  // A cada 5 segundos: fila de saída, digitações com a janela vencida e mensagens não lidas.
  let rodando = false;
  cron.schedule("*/5 * * * * *", async () => {
    if (rodando) return;
    rodando = true;
    try {
      await recuperarMaisa();
    } catch (err) {
      console.error("Erro na recuperação da Maisa:", err);
    } finally {
      rodando = false;
    }
  });
}
