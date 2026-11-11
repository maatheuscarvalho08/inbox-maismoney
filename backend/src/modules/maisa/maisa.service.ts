import cron from "node-cron";
import type { Prisma, StatusProposta } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { emitCarrinhoNovo, emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { entregarMensagem } from "../mensagens/entrega.js";
import { getConversaById } from "../conversas/conversas.service.js";
import { avancarEtapa } from "../funil/funil.service.js";
import { classificadorRegras } from "./classificador.js";
import { bancoFacta, bancoSimulado, type BancoClt } from "./bancos.js";
import { codigoBancoPorNome, contratar, contratarPortRefin, digitacaoConfigurada, factaConfigurada, type ResultadoContratacao } from "./facta.js";
import { extrairDados } from "./coleta.js";
import type { DadosContrato } from "./contrato.js";
import { avancar, type Efeito, type Entrada, type EstadoMaisa, type Passo } from "./fluxo.js";
import { FORMATOS_EXTRATO, lerArquivo, parcelaPeloExtrato, transcreverAudio } from "./midia.js";
import { TEXTOS } from "./textos.js";
import { guardarAnalise } from "../extratos/guardadas.js";
import { buscarAlternativa } from "./alternativas.js";
import type { ExtratoLido } from "../extratos/leitor.js";

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

async function etapaAtual(conversaId: string) {
  return (await prisma.conversa.findUnique({ where: { id: conversaId }, select: { etapaFunil: true } }))?.etapaFunil ?? null;
}

async function aplicarEfeito(conversa: ConversaMaisa, efeito: Efeito) {
  switch (efeito.tipo) {
    case "convenio":
      // Convênio definido por uma pessoa da equipe vale mais que o da Maisa.
      if (conversa.convenioOrigem !== "operador") {
        await prisma.conversa.update({
          where: { id: conversa.id },
          data: { convenio: efeito.convenio, convenioOrigem: "maisa" },
        });
      }
      return;
    case "cpf":
      await prisma.contato.update({ where: { id: conversa.contatoId }, data: { cpf: efeito.cpf } });
      await avancarEtapa(conversa.id, "dados_coletados", await etapaAtual(conversa.id));
      return;
    case "simulacao": {
      const r = efeito.resultado;
      await prisma.simulacao.create({
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
      if (r.tipo !== "erro") {
        await avancarEtapa(conversa.id, r.tipo === "com_saldo" ? "simulacao_com_saldo" : "simulacao", await etapaAtual(conversa.id));
      }
      return;
    }
    case "proposta": {
      const estado = conversa.maisaEstado as EstadoMaisa | null;
      const oferta = estado?.oferta;
      await prisma.proposta.create({
        data: {
          conversaId: conversa.id,
          banco: "Facta",
          convenio: estado?.produto ?? null,
          valorCentavos: oferta?.valorCentavos ?? 0,
          parcelaCentavos: oferta?.parcelaCentavos ?? null,
          prazoMeses: oferta?.prazoMeses ?? null,
          numeroContrato: efeito.codigoAf,
        },
      });
      await avancarEtapa(conversa.id, "proposta_digitada", await etapaAtual(conversa.id));
      return;
    }
    case "transferir":
      // Sai da Maisa e entra em "Na fila". Quem estava atribuído continua.
      await prisma.conversa.update({ where: { id: conversa.id }, data: { comMaisa: false } });
      if (efeito.nota) await deixarNota(conversa.id, efeito.nota);
      return;
    case "encerrar":
      // Nada a oferecer: fecha sem ir para a fila. Se o cliente voltar, abre outra conversa.
      await prisma.conversa.update({ where: { id: conversa.id }, data: { status: "encerrada" } });
      return;
  }
}

// Nota interna para o operador: aparece na conversa, nunca vai para o WhatsApp e não
// mexe no horário da última mensagem (a lista continua ordenada pelo cliente).
async function deixarNota(conversaId: string, texto: string) {
  const nota = await prisma.mensagem.create({
    data: { conversaId, remetenteTipo: "nota", conteudoTexto: texto },
    include: {
      operador: { select: { id: true, nome: true, fotoPath: true } },
      respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
    },
  });
  emitNovaMensagem(nota);
}

function exigir<T>(valor: T | undefined | null, campo: string): T {
  if (valor === undefined || valor === null || valor === "") throw new Error(`falta ${campo}`);
  return valor;
}

async function digitarProposta(
  conversa: ConversaMaisa,
  estado: EstadoMaisa | null,
  d: DadosContrato,
  simulado: boolean,
): Promise<ResultadoContratacao> {
  // Conversa de teste nunca cria proposta de verdade.
  if (simulado) return { tipo: "enviada", codigoAf: "TESTE", url: "" };
  const produto = estado?.produto;
  if (produto !== "inss" && produto !== "siape") throw new Error("digitação só para INSS e SIAPE");
  const base = {
    cpf: await cpfDoContato(conversa.contatoId),
    dataNascimento: exigir(estado?.dataNascimento, "data de nascimento"),
    celular: conversa.contato.numeroWhatsapp,
    pessoa: pessoaDoContrato(d),
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

// Tempo de "digitando..." antes de cada mensagem, como uma pessoa: cresce com o
// tamanho do texto, com uma variação para não ficar sempre igual. Entre 3 e 12 segundos.
export function tempoDigitando(texto: string, sorteio = Math.random()) {
  const base = 2500 + texto.length * 30;
  return Math.round(Math.min(12_000, Math.max(3000, base * (0.85 + sorteio * 0.3))));
}

async function enviarResposta(conversa: ConversaMaisa, texto: string) {
  const mensagem = await criarMensagem({ conversaId: conversa.id, remetenteTipo: "maisa", conteudoTexto: texto });
  if (!mensagem) return;
  // No copiloto a mensagem fica só como sugestão. Conversa de teste nunca vai para o WhatsApp.
  if (env.MAISA_MODO === "automatico" && !ehTeste(conversa)) {
    await entregarMensagem(mensagem, conversa, null, { digitandoMs: tempoDigitando(texto) });
  }
  emitNovaMensagem(mensagem);
}

// O que fez a Maisa andar: uma mensagem do cliente ou a checagem da autorização.
type Gatilho = { mensagemId: string } | { evento: "verificar_autorizacao" | "verificar_oferta" };

async function processar(conversaId: string, gatilho: Gatilho) {
  if (env.MAISA_MODO === "desligado") return;

  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { contato: true, instancia: true },
  });
  if (!conversa || !conversa.comMaisa || !conversa.instancia.maisaAtiva || conversa.status === "encerrada") return;

  let entrada: Entrada;
  let arquivo: { midiaPath: string; tipo: string } | null = null;
  if ("mensagemId" in gatilho) {
    const mensagem = await prisma.mensagem.findUnique({ where: { id: gatilho.mensagemId } });
    if (!mensagem || mensagem.remetenteTipo !== "cliente") return;
    const tipo = mensagem.tipoMidia?.split(";")[0].trim() ?? null;
    if (tipo && mensagem.midiaPath && !mensagem.midiaDeleted) arquivo = { midiaPath: mensagem.midiaPath, tipo };
    entrada = { texto: mensagem.conteudoTexto, temMidia: Boolean(tipo), documento: Boolean(arquivo && FORMATOS_EXTRATO.includes(arquivo.tipo)) };
    // Áudio: ela escuta e segue como se o cliente tivesse escrito. Se falhar, vai para a equipe.
    if (arquivo?.tipo.startsWith("audio/") && env.OPENAI_API_KEY) {
      try {
        const texto = await transcreverAudio(await lerArquivo(arquivo.midiaPath), arquivo.tipo);
        if (texto) entrada = { texto, temMidia: false };
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
  const estadoAntes = (conversa.maisaEstado as EstadoMaisa | null) ?? null;
  const passo: Passo = await avancar(estadoAntes, entrada, {
    classificador: classificadorRegras,
    agora: () => new Date(),
    solicitarAutorizacao: async (nome) =>
      banco
        ? banco.solicitarAutorizacao({ cpf: await cpfDoContato(conversa.contatoId), nome, celular: conversa.contato.numeroWhatsapp })
        : semBanco(),
    consultar: async () => (banco ? banco.consultar(await cpfDoContato(conversa.contatoId)) : semBanco()),
    statusProposta: () => ultimaProposta(conversa.contatoId),
    simularPorExtrato: async (convenio, dataNascimento) => {
      if (!banco) return semBanco();
      if (!arquivo) return { tipo: "extrato_invalido", motivo: "arquivo não encontrado" };
      const inicio = Date.now();
      const { resultado: leitura, registro } = await parcelaPeloExtrato(await lerArquivo(arquivo.midiaPath), arquivo.tipo, convenio);
      // A equipe vê no balão do arquivo o que ela leu e por que não passou.
      if ("mensagemId" in gatilho) {
        await guardarAnalise(gatilho.mensagemId, registro).catch((err) =>
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
    extrairDados: async (pergunta, recebida, faltando) => {
      const doc = recebida.documento && arquivo ? { conteudo: await lerArquivo(arquivo.midiaPath), tipo: arquivo.tipo } : null;
      const dados = await extrairDados(pergunta, recebida.texto, doc, faltando);
      console.log(`Maisa leu dados do contrato na conversa ${conversa.id}: ${Object.keys(dados).length} campo(s)`);
      return dados;
    },
    digitar: (dados) => digitarProposta(conversa, estadoAntes, dados, banco === bancoSimulado),
  });

  // Checagem sem novidade: só guarda quando checar de novo, sem registro nem aviso.
  const mudouEtapa = passo.estado.etapa !== estadoAntes?.etapa;
  if (!("mensagemId" in gatilho) && !mudouEtapa && !passo.respostas.length) {
    await prisma.conversa.update({ where: { id: conversa.id }, data: { maisaEstado: passo.estado as unknown as Prisma.InputJsonValue } });
    return;
  }

  // Primeiro grava o que ela aprendeu, depois responde, e só então sai da conversa:
  // assim a resposta de despedida ainda aparece como dela.
  const transferencia = passo.efeitos.find((e) => e.tipo === "transferir");
  for (const efeito of passo.efeitos) {
    if (efeito.tipo !== "transferir") await aplicarEfeito(conversa, efeito);
  }
  await prisma.conversa.update({
    where: { id: conversa.id },
    data: { maisaEstado: passo.estado as unknown as Prisma.InputJsonValue },
  });
  await prisma.maisaEvento.create({
    data: {
      conversaId: conversa.id,
      etapaAntes: estadoAntes?.etapa ?? null,
      etapaDepois: passo.estado.etapa,
      rotulo: passo.rotulo,
      motivo: transferencia?.tipo === "transferir" ? transferencia.motivo : null,
    },
  });

  for (const texto of passo.respostas) await enviarResposta(conversa, texto);
  if (transferencia) await aplicarEfeito(conversa, transferencia);

  // 24 horas sem responder a oferta: entra no Carrinho e avisa a equipe na hora.
  if (passo.estado.saida === "carrinho") {
    await prisma.conversa.update({ where: { id: conversa.id }, data: { carrinhoEm: new Date() } });
  }

  const atualizada = await getConversaById(conversa.id);
  if (atualizada) {
    emitConversaAtualizada(atualizada);
    if (passo.estado.saida === "carrinho") emitCarrinhoNovo(atualizada);
  }
}

// Uma coisa por vez em cada conversa. Se o cliente manda três mensagens seguidas,
// a segunda só é lida depois que a primeira mudou a etapa.
const filas = new Map<string, Promise<void>>();

function enfileirar(conversaId: string, gatilho: Gatilho): Promise<void> {
  const anterior = filas.get(conversaId) ?? Promise.resolve();
  const atual = anterior
    .then(() => processar(conversaId, gatilho))
    .catch(async (err) => {
      console.error(`Maisa falhou na conversa ${conversaId}:`, err);
      // Se ela quebrar no meio, o cliente não pode ficar sem resposta: vai para a fila.
      try {
        await prisma.conversa.update({ where: { id: conversaId }, data: { comMaisa: false } });
        const conversa = await getConversaById(conversaId);
        if (conversa) emitConversaAtualizada(conversa);
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
  const estado: EstadoMaisa = { etapa: "convenio", tentativas: 0 };
  await prisma.conversa.update({
    where: { id: conversaId },
    data: { maisaEstado: estado as unknown as Prisma.InputJsonValue },
  });
  await enviarResposta(conversa, TEXTOS.saudacao);
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

export function verificarAutorizacao(conversaId: string): Promise<void> {
  return enfileirar(conversaId, { evento: "verificar_autorizacao" });
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
  const agora = Date.now();
  const naHora = esperando.filter((c) => {
    const proxima = (c.maisaEstado as EstadoMaisa | null)?.proximaVerificacao;
    return !proxima || new Date(proxima).getTime() <= agora;
  });
  for (const c of naHora) await verificarAutorizacao(c.id);
  return naHora.length;
}

// Ofertas ainda sem resposta: o fluxo decide se é hora do follow-up ou do carrinho.
export async function verificarOfertasPendentes() {
  const ofertadas = await prisma.conversa.findMany({
    where: { comMaisa: true, status: { not: "encerrada" }, maisaEstado: { path: ["etapa"], equals: "oferta" } },
    select: { id: true },
  });
  for (const c of ofertadas) await enfileirar(c.id, { evento: "verificar_oferta" });
  return ofertadas.length;
}

export function startMaisaJobs() {
  if (env.MAISA_MODO === "desligado") return;
  cron.schedule("* * * * *", async () => {
    try {
      await verificarAutorizacoesPendentes();
      await verificarOfertasPendentes();
    } catch (err) {
      console.error("Erro nas checagens de tempo da Maisa:", err);
    }
  });
}
