import type { Convenio } from "@prisma/client";
import type { Classificador, ConvenioEntendido, LeituraOferta } from "./classificador.js";
import type { DigitacaoPort, ReducaoParcela, TabelaDigitacao, ResultadoAutorizacao, ResultadoBanco, ResultadoConsulta, ResultadoExtrato } from "./bancos.js";
import { cpfValido, extrairCpf } from "./cpf.js";
import { buscarFaq } from "./faq.js";
import { PRODUTOS_COM_SIMULACAO, ROTULO_CONVENIO, TEXTOS, formatarReais } from "./textos.js";
import { camposFaltando, proximaPergunta, resumoDados, todosCampos, type CampoContrato, type DadosContrato } from "./contrato.js";
import type { ResultadoContratacao } from "./facta.js";
import { NAO_QUERO, SIM_FORTE, normalizar, temReceio } from "./classificador.js";
import { motivoTravaDigitacao } from "./travaDigitacao.js";
import { invalidaConfirmacao } from "./ordemMensagens.js";
import {
  ACEITE_NO_FIM,
  CORRECAO,
  HESITACAO,
  SEM_REFIN,
  temCondicao,
  OUTRO_VALOR,
  PEDE_EXPLICACAO,
  RECOMECAR,
  RESPOSTA_SOCIAL,
  datasNoTexto,
  idadeEm,
  mensagemSocial,
  socialPositivo,
} from "./mensagens.js";

// O fluxograma da Maisa. Cada etapa só sabe tratar a resposta da pergunta que ela
// fez. Este arquivo não fala com o banco de dados nem com o WhatsApp: recebe o estado
// e a mensagem e devolve o novo estado, as respostas e o que precisa ser gravado.
// Assim dá para testar o fluxo inteiro sem nada rodando (ver scripts/testarMaisa.ts).

// CLT: cpf, nome, consentimento, aguardando (link do banco), oferta.
// INSS e SIAPE: cpf, nascimento, extrato, oferta. A margem sai do extrato do cliente.
export type Etapa =
  | "inicio"
  | "convenio"
  | "cpf"
  | "nome"
  | "consentimento"
  | "aguardando"
  | "nascimento"
  | "extrato"
  | "oferta"
  // Sem margem para novo, mas a Facta abriu port ou refin: ela oferta e a equipe digita.
  | "oferta_port"
  // Aceitou a port + refin: pede o número do contrato no banco de origem.
  | "numero_contrato"
  | "coleta"
  | "confirmacao"
  | "finalizada";

export type Produto = "clt" | "inss" | "siape";
type ProdutoExtrato = Exclude<Produto, "clt">;
const porExtrato = (p: string | undefined): p is ProdutoExtrato => p === "inss" || p === "siape";

export interface EstadoMaisa {
  etapa: Etapa;
  // Quantas vezes seguidas ela não entendeu a resposta da etapa atual.
  tentativas: number;
  produto?: Produto;
  // INSS e SIAPE: AAAA-MM-DD, a Facta pede na simulação.
  dataNascimento?: string;
  // Data com ano impossível (ex.: 1852): a que ela acha que o cliente quis dizer, esperando confirmação.
  dataSugerida?: string;
  // Extrato que chegou antes da hora (na etapa do CPF, por exemplo): é lido quando tiver a data.
  extratoPendenteId?: string;
  // Nome completo, que o banco exige no pedido de autorização.
  nome?: string;
  // Espera pela autorização do cliente no link do banco (ISO).
  autorizacaoPedidaEm?: string;
  proximaVerificacao?: string;
  reenvios?: number;
  // Oferta enviada e ainda sem resposta: follow-up em 10 minutos, carrinho em 24 horas.
  ofertaEm?: string;
  ultimoContatoCliente?: string;
  followupEnviado?: boolean;
  oferta?: {
    banco: string;
    valorCentavos: number;
    parcelaCentavos: number;
    prazoMeses: number;
    tabela?: { codigoTabela: number; prazo: number; contrato: number; parcela: number; coeficiente: number };
    renda?: number | null;
    especie?: number | null;
    matricula?: string | null;
    contaSalario?: { bancoConta: string; agencia: string; conta: string } | null;
  };
  // Quantas objeções ela já tentou contornar nesta oferta.
  contornos?: number;
  // Ela pediu "posso seguir?" depois de um "ok" ou aceite com condição: o próximo sim vale.
  confirmarAceite?: boolean;
  // Os 4 últimos dígitos do CPF informado: basta para saber se um CPF mandado depois é outro.
  cpfFim?: string;
  // Mensagens sociais seguidas ("ok", "valeu", emoji) sem responder a pergunta da etapa.
  sociais?: number;
  // O cliente já tinha aceitado (conversa retomada): ela não oferta de novo, vai direto ao contrato.
  aceitouOferta?: boolean;
  // Port, port + refin ou refin que a Facta abriu, ofertado ao cliente.
  alternativa?: {
    operacao: "port_refin" | "portabilidade" | "refin";
    trocoCentavos: number | null;
    motivo: string;
    digitacao?: DigitacaoPort;
    reducoes?: ReducaoParcela[];
    // Todo contrato em que a Facta abriu tabela, com as tabelas, para a nota da equipe.
    simulacoes?: DigitacaoPort[];
    numeroContrato?: string;
    // Do extrato, para o contrato não perguntar de novo.
    renda?: number | null;
    matricula?: string | null;
    contaSalario?: { bancoConta: string; agencia: string; conta: string } | null;
  };
  // Cadastro para digitar a proposta. Sai do estado assim que ela passa para a equipe.
  // origem: campos que vieram do extrato (não são sobrescritos sem a equipe validar).
  // correcoes: o que o cliente mudou na confirmação, com o valor de antes.
  // correcaoPendente: o cliente apontou um erro que a Maisa não conseguiu aplicar. Enquanto
  // existir, nenhum "sim" confirma os dados antigos.
  contrato?: { dados: DadosContrato; pergunta: string; origem?: Partial<Record<CampoContrato, "extrato">>; correcoes?: Correcao[]; correcaoPendente?: string };
  // "sim" da confirmação esperando a janela. Mensagem relevante do cliente cancela;
  // a digitação só acontece no evento "executar_digitacao", depois da revalidação.
  confirmacaoPendente?: { recebidoEm: string; executarEm: string; mensagemId?: string; consentimento: string };
  // Última mensagem do cliente lida pela Maisa. A recuperação depois de um reinício
  // lê o que chegou depois dela; a digitação não roda com mensagem nova sem ler.
  ultimaMensagemId?: string;
  ultimaMensagemEm?: string;
  // Último aviso à equipe de aceite depois de a conversa sair da Maisa.
  avisoAceiteEm?: string;
  motivoTransferencia?: string;
  // Onde ela estava quando passou para a equipe, e por quê, num rótulo fechado.
  // A tela usa isso para dizer ao atendente o que fazer em seguida.
  paradaEm?: Etapa;
  saida?: string;
}

// Mensagem do cliente, ou uma checagem automática do relógio (sem texto).
// documento = PDF ou imagem, que pode ser o extrato. Áudio chega já transcrito em texto.
export type Entrada =
  | { texto: string | null; temMidia: boolean; documento?: boolean; documentoId?: string; mensagemId?: string }
  | { evento: "verificar_autorizacao" | "verificar_oferta" | "executar_digitacao" };

export interface Correcao {
  campo: CampoContrato;
  origem: "extrato" | "cliente";
  anterior: unknown;
  novo: unknown;
  em: string;
  // false: dado do extrato, guardado só para a equipe validar.
  aplicada: boolean;
}

// O que a digitação devolve. "bloqueada": a Facta não foi chamada porque já existe
// operação para o cliente (em andamento, incerta, ou concluída há pouco); a equipe decide.
export type ResultadoDigitacao =
  | ResultadoContratacao
  | { tipo: "bloqueada"; motivo: string; status: string; codigoAf?: string | null };

export interface Dependencias {
  classificador: Classificador;
  agora(): Date;
  // Quem chama já sabe o CPF e o celular do cliente. O fluxo não precisa vê-los.
  solicitarAutorizacao(nome: string): Promise<ResultadoAutorizacao>;
  consultar(): Promise<ResultadoConsulta>;
  statusProposta(): Promise<{ banco: string; status: string } | null>;
  // Lê o extrato que acabou de chegar e simula com a margem dele.
  // documentoId: extrato que o cliente mandou antes da hora. Sem ele, o da mensagem atual.
  simularPorExtrato(produto: ProdutoExtrato, dataNascimento: string, documentoId?: string): Promise<ResultadoExtrato>;
  // Digitação na Facta (INSS e SIAPE). Desligada, o "sim" vai para a equipe.
  digitacaoAtiva: boolean;
  extrairDados(pergunta: string, entrada: { texto: string | null; documento?: boolean }, faltando: CampoContrato[]): Promise<DadosContrato>;
  // Idempotente: quem chama garante uma digitação por oferta (chave única no banco).
  digitar(dados: DadosContrato): Promise<ResultadoDigitacao>;
  // Trava própria da digitação automática (MAISA_DIGITACAO_LIBERADA). Desligada por padrão.
  digitacaoLiberada?: boolean;
  // Espera depois do "sim" da confirmação antes de digitar. Ausente: 30 segundos.
  janelaConfirmacaoMs?: number;
  // Há mensagem do cliente que chegou e ainda não foi lida? Ausente: não há.
  // O cliente mandou mensagem relevante depois do "sim" (pelo horário do WhatsApp, ou
  // recebida depois dele)? Ausente: não mandou.
  mensagemDepoisDoSim?(simMensagemId: string | undefined, recebidoEm: string): Promise<boolean>;
  // Lembrete e Carrinho também na oferta de portabilidade.
  followupPort?: boolean;
  // Responde ao que o cliente disse fora do esperado (ex.: "estou negativo"), só com fatos
  // aprovados. null: não tem o que dizer. Ausente nos testes: valem as regras.
  responderLivre?(texto: string, etapa: string, produto: string | undefined, pergunta: string): Promise<string | null>;
}

export type Efeito =
  | { tipo: "convenio"; convenio: Convenio }
  | { tipo: "cpf"; cpf: string }
  | { tipo: "simulacao"; convenio: Produto; resultado: ResultadoBanco }
  // nota: o que a Maisa fez, para o operador ler na conversa.
  | { tipo: "transferir"; motivo: string; nota?: string }
  // Não há o que fazer: a conversa fecha sem passar para a equipe.
  | { tipo: "encerrar"; motivo: string }
  | { tipo: "proposta"; codigoAf: string };

export interface Passo {
  estado: EstadoMaisa;
  respostas: string[];
  efeitos: Efeito[];
  // O que ela entendeu da mensagem. Vai para o registro, nunca o texto do cliente.
  rotulo: string;
}

// Não entendeu duas vezes: pergunta de novo. Na terceira, passa para a equipe.
const MAX_TENTATIVAS = 2;
// Link reenviado no máximo duas vezes.
const MAX_REENVIOS = 2;
// Depois de 48 horas sem autorizar, a conversa vai para a equipe.
const PRAZO_AUTORIZACAO_MS = 48 * 60 * 60_000;

const PERGUNTA_DA_ETAPA: Record<Etapa, string> = {
  inicio: TEXTOS.perguntaConvenio,
  convenio: TEXTOS.perguntaConvenio,
  cpf: "Pode me mandar o seu CPF? Só os números.",
  nome: TEXTOS.nomeInvalido,
  consentimento: TEXTOS.perguntaConsentimento,
  aguardando: TEXTOS.aindaNaoAutorizou,
  nascimento: "Qual a sua data de nascimento? Pode mandar assim: 15/03/1958.",
  extrato: TEXTOS.lembraExtrato,
  oferta: TEXTOS.perguntaOferta,
  oferta_port: TEXTOS.perguntaOferta,
  numero_contrato: TEXTOS.numeroContratoInvalido,
  coleta: TEXTOS.continuarCadastro,
  confirmacao: TEXTOS.perguntaConfirmacao,
  finalizada: "",
};

// Depois de responder ao que o cliente disse, ela retoma a etapa com uma pergunta curta.
// Repetir o texto inteiro (a lista de 10 produtos) a cada mensagem soa como robô.
const RETOMA_ETAPA: Partial<Record<Etapa, string>> = {
  inicio: "Me conta: qual é o seu vínculo? Por exemplo CLT, INSS, SIAPE ou outro.",
  convenio: "Me conta: qual é o seu vínculo? Por exemplo CLT, INSS, SIAPE ou outro.",
  cpf: "Pode me mandar o seu CPF? Só os números.",
  nascimento: "Qual a sua data de nascimento?",
  extrato: "Quando puder, me manda o extrato aqui, em PDF ou foto.",
  consentimento: "Posso consultar? É só me responder SIM.",
};

const NOME_ETAPA: Record<Etapa, string> = {
  inicio: "início",
  convenio: "vínculo",
  cpf: "CPF",
  nome: "nome",
  consentimento: "autorização",
  aguardando: "link do banco",
  nascimento: "data de nascimento",
  extrato: "extrato",
  oferta: "oferta",
  oferta_port: "oferta de portabilidade",
  numero_contrato: "número do contrato",
  coleta: "dados do contrato",
  confirmacao: "confirmação dos dados",
  finalizada: "fim",
};

function ir(estado: EstadoMaisa, etapa: Etapa, respostas: string[], rotulo: string, efeitos: Efeito[] = [], extra: Partial<EstadoMaisa> = {}): Passo {
  return { estado: { ...estado, ...extra, etapa, tentativas: 0, sociais: 0 }, respostas, efeitos, rotulo };
}

function transferir(
  estado: EstadoMaisa,
  motivo: string,
  resposta: string | null,
  rotulo: string,
  efeitos: Efeito[] = [],
  saida = rotulo,
): Passo {
  return {
    // Os dados do cadastro (RG, endereço, filiação) não ficam guardados depois daqui.
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined },
    respostas: resposta ? [resposta] : [],
    efeitos: [...efeitos, { tipo: "transferir", motivo, nota: notaEquipe(estado, motivo, efeitos) }],
    rotulo,
  };
}

const r$ = (reais: number) => formatarReais(Math.round(reais * 100));

// Nota para o operador ao passar a conversa: o que a Maisa fez, onde simulou e o que
// voltou. Fica na conversa, só para a equipe. Os dados do cadastro saem resumidos.
export function notaEquipe(estado: EstadoMaisa, motivo: string, efeitos: Efeito[] = []): string {
  const linhas = [`Passei para a equipe: ${motivo}.`];
  const produto = estado.produto ? estado.produto.toUpperCase() : "não definido";
  linhas.push(`Produto: ${produto}. Parei na etapa: ${NOME_ETAPA[estado.etapa]}.`);

  for (const e of efeitos) {
    if (e.tipo !== "simulacao") continue;
    const r = e.resultado;
    if (r.tipo === "com_saldo") {
      linhas.push(`Simulei no ${r.banco}: até ${formatarReais(r.valorCentavos)} em ${r.prazoMeses}x de ${formatarReais(r.parcelaCentavos)}.`);
    } else if (r.tipo === "sem_saldo") {
      linhas.push(`Simulei no ${r.banco === "extrato" ? "extrato (leitura do documento)" : r.banco}: sem saldo. ${r.motivo}`);
    } else {
      linhas.push(`Simulação no ${r.banco} deu erro: ${r.motivo}`);
    }
  }

  const o = estado.oferta;
  if (o) {
    linhas.push(
      `Oferta enviada (${o.banco}): até ${formatarReais(o.valorCentavos)} em ${o.prazoMeses}x de ${formatarReais(o.parcelaCentavos)}` +
        (o.tabela ? `, tabela ${o.tabela.codigoTabela}.` : "."),
    );
  }

  const a = estado.alternativa;
  if (a) {
    const nome = { port_refin: "port + refin", portabilidade: "portabilidade", refin: "refin" }[a.operacao];
    linhas.push(...dadosDoCliente(estado));
    linhas.push(`Simulei na Facta (${nome}, operação 003500): ${a.motivo}.`);
    if (a.trocoCentavos) linhas.push(`Troco ofertado: até ${formatarReais(a.trocoCentavos)}.`);
    if (a.numeroContrato) linhas.push(`Número do contrato informado pelo cliente: ${a.numeroContrato}.`);
    if (a.digitacao) linhas.push(`Contrato que ela ofertou: ${a.digitacao.banco}, parcela ${r$(a.digitacao.parcela)}.`);
    // Tudo o que a Facta abriu, contrato por contrato, para a equipe digitar no portal.
    if (a.simulacoes?.length) {
      linhas.push("", "SIMULAÇÕES NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.");
      a.simulacoes.forEach((s, i) => linhas.push(...blocoSimulacao(s, i + 1, a.numeroContrato, a.digitacao)));
    }
  }
  // Conversa antiga, sem a lista: só o contrato ofertado e as reduções.
  if (a && !a.simulacoes?.length) {
    if (a.digitacao) linhas.push("", "SIMULAÇÃO NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.", ...blocoSimulacao(a.digitacao, 1, a.numeroContrato, a.digitacao));
    for (const red of a.reducoes ?? []) linhas.push(`Port ${red.banco}: parcela de ${r$(red.atual)} cai para ${r$(red.nova)}.`);
  }

  const dados = estado.contrato?.dados;
  if (dados && Object.keys(dados).length) {
    linhas.push("", `DADOS PARA O CADASTRO:\n${resumoDados(dados, true)}`);
  }
  // Rastro de cada correção: de onde veio o dado, o valor de antes e o novo.
  const correcoes = estado.contrato?.correcoes ?? [];
  if (correcoes.length) {
    linhas.push("", "CORREÇÕES DO CLIENTE NA CONFIRMAÇÃO:");
    for (const c of correcoes) {
      const fonte = c.origem === "extrato" ? "lido do extrato" : "informado pelo cliente";
      linhas.push(`- ${c.campo} (${fonte}): ${String(c.anterior ?? "vazio")} para ${String(c.novo)}${c.aplicada ? "" : " [NÃO aplicado: validar com o extrato]"}`);
    }
  }
  return linhas.join("\n");
}

const pct = (n: number) => `${String(Number(n.toFixed(2))).replace(".", ",")}% a.m.`;

function linhaTabela(rotulo: string, t: TabelaDigitacao, refin: boolean): string {
  return (
    `   ${rotulo}: tabela ${t.codigoTabela}${t.nome ? ` (${t.nome})` : ""}, ${t.prazo}x de ${r$(t.parcela)}` +
    (t.taxa ? `, taxa ${pct(t.taxa)}` : "") +
    `, coeficiente ${t.coeficiente}, ${refin ? "bruto" : "valor da operação"} ${r$(t.contrato)}` +
    (refin && t.liquido != null ? `, troco ${r$(t.liquido)}` : "")
  );
}

// Um contrato simulado, com tudo o que o portal pede para digitar.
function blocoSimulacao(s: DigitacaoPort, n: number, numeroCliente?: string, ofertado?: DigitacaoPort): string[] {
  const foiOfertado = ofertado && ofertado.banco === s.banco && ofertado.parcela === s.parcela;
  const numero = s.numeroContrato || (foiOfertado ? numeroCliente : undefined);
  const economia = s.parcela - s.port.parcela;
  return [
    `${n}) ${s.banco}${s.bancoCodigo ? `, código ${s.bancoCodigo}` : ", código do banco não identificado"}` +
      `${numero ? `, contrato nº ${numero}` : ", nº do contrato: pegar na BRB"}${foiOfertado ? "  [OFERTADO]" : ""}`,
    // Sem o total no extrato, o prazo original enviado à Facta é o próprio restante.
    `   Hoje: parcela ${r$(s.parcela)}, faltam ${s.prazoRestante}` +
      (s.prazoOriginal > s.prazoRestante ? ` de ${s.prazoOriginal}` : " (total e pagas não informados no extrato: conferir na BRB)") +
      `, saldo estimado ${r$(s.saldoDevedor)}`,
    linhaTabela("Port", s.port, false) + (economia > 0 ? `, parcela cai ${r$(economia)} por mês` : ""),
    s.refin ? linhaTabela("Refin da port", s.refin, true) : "   Refin da port: nenhuma tabela com troco (só port pura)",
  ];
}

// Cliente: o que o portal pede além do cadastro, lido do extrato.
function dadosDoCliente(estado: EstadoMaisa): string[] {
  const a = estado.alternativa;
  const partes = [
    estado.nome ? `nome ${estado.nome}` : null,
    estado.dataNascimento ? `nascimento ${estado.dataNascimento.slice(0, 10).split("-").reverse().join("/")}` : null,
    a?.matricula ? `matrícula ${a.matricula}` : null,
    a?.renda ? `renda bruta ${r$(a.renda)}` : null,
    a?.contaSalario ? `conta salário: banco ${a.contaSalario.bancoConta}, agência ${a.contaSalario.agencia}, conta ${a.contaSalario.conta}` : null,
  ].filter(Boolean);
  return partes.length ? [`Cliente: ${partes.join("; ")}.`] : [];
}

// Fim sem atendente: nada a oferecer agora. Se o cliente escrever de novo, começa outra conversa.
function encerrar(estado: EstadoMaisa, motivo: string, resposta: string, rotulo: string, efeitos: Efeito[] = [], saida = rotulo): Passo {
  return {
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined },
    respostas: [resposta],
    efeitos: [...efeitos, { tipo: "encerrar", motivo }],
    rotulo,
  };
}

function tentarDeNovo(estado: EstadoMaisa, resposta: string, rotulo: string, saida = "nao_entendeu"): Passo {
  const tentativas = estado.tentativas + 1;
  if (tentativas > MAX_TENTATIVAS) {
    return transferir(estado, `não entendeu a resposta na etapa ${NOME_ETAPA[estado.etapa]}`, TEXTOS.transferindo, rotulo, [], saida);
  }
  return { estado: { ...estado, tentativas }, respostas: [resposta], efeitos: [], rotulo };
}

// Resposta fora do que a etapa espera. Se for uma dúvida conhecida, responde e repete
// a pergunta. Dúvida desconhecida vai para a equipe, em vez de a Maisa improvisar.
// Antes de repetir a pergunta da etapa, responde ao que o cliente disse. Sem resposta
// possível, vale a regra de sempre (FAQ, dúvida para a equipe ou "não entendi").
async function ouvirCliente(estado: EstadoMaisa, texto: string, deps: Dependencias, pergunta = PERGUNTA_DA_ETAPA[estado.etapa]): Promise<Passo> {
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, pergunta], efeitos: [], rotulo: "faq" };
  const tentativas = estado.tentativas + 1;
  if (deps.responderLivre && texto.trim() && tentativas <= MAX_TENTATIVAS) {
    try {
      const resposta = await deps.responderLivre(texto, NOME_ETAPA[estado.etapa], estado.produto, pergunta);
      if (resposta) {
        const retoma = RETOMA_ETAPA[estado.etapa] ?? pergunta;
        return { estado: { ...estado, tentativas }, respostas: [resposta, retoma], efeitos: [], rotulo: "resposta_livre" };
      }
    } catch (err) {
      console.error("Resposta livre falhou:", err instanceof Error ? err.message : err);
    }
  }
  return foraDaEtapa(estado, texto);
}

function foraDaEtapa(estado: EstadoMaisa, texto: string): Passo {
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
  if (texto.includes("?")) return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, "duvida");
  return tentarDeNovo(estado, `${TEXTOS.naoEntendi} ${PERGUNTA_DA_ETAPA[estado.etapa]}`, "nao_entendeu");
}

function decidirConvenio(estado: EstadoMaisa, convenio: ConvenioEntendido, prefixo: string[] = []): Passo {
  const comPrefixo = (p: Passo) => ({ ...p, respostas: [...prefixo, ...p.respostas] });
  // Só segue com a Maisa o produto que tem simulação por API (CLT, INSS e SIAPE, na Facta).
  // Os demais vão para a equipe abaixo.
  if ((convenio === "clt" || porExtrato(convenio)) && PRODUTOS_COM_SIMULACAO.includes(convenio)) {
    return comPrefixo(ir(estado, "cpf", [TEXTOS.pedeCpf], convenio, [{ tipo: "convenio", convenio }], { produto: convenio }));
  }
  if (convenio === "servidor") {
    return comPrefixo(transferir(estado, "servidor público", TEXTOS.servidorComEquipe, "servidor"));
  }
  if (convenio === "outro") {
    return comPrefixo(transferir(estado, "vínculo fora dos convênios", TEXTOS.transferindo, "outro"));
  }
  return comPrefixo(
    transferir(
      estado,
      `convênio ${ROTULO_CONVENIO[convenio]}`,
      TEXTOS.convenioComEquipe(ROTULO_CONVENIO[convenio]),
      convenio,
      [{ tipo: "convenio", convenio }],
      "convenio",
    ),
  );
}

// Quando checar de novo se o cliente autorizou: a cada minuto nos primeiros 15,
// a cada 5 até completar 1 hora, depois a cada 30.
function proximaVerificacao(pedidaEm: Date, agora: Date) {
  const passou = agora.getTime() - pedidaEm.getTime();
  const intervalo = passou < 15 * 60_000 ? 60_000 : passou < 60 * 60_000 ? 5 * 60_000 : 30 * 60_000;
  return new Date(agora.getTime() + intervalo).toISOString();
}

const DESCONTO: Record<Produto, string> = { clt: "no seu salário", inss: "no seu benefício", siape: "na sua folha de pagamento" };

function mostrarResultado(estado: EstadoMaisa, resultado: ResultadoBanco, agora: Date): Passo {
  const efeito: Efeito = { tipo: "simulacao", convenio: estado.produto ?? "clt", resultado };
  if (resultado.tipo === "sem_saldo") {
    // "extrato" = a margem já acabou no extrato, nem chegou a consultar o banco.
    const doExtrato = resultado.banco === "extrato";
    // Leitura com dúvida: pode ser erro de leitura, a equipe confere.
    if (resultado.revisar) {
      return transferir(estado, `sem margem, leitura com dúvida: ${resultado.motivo}`, TEXTOS.semMargemExtrato, "sem_saldo", [efeito], "revisar_extrato");
    }
    // Sem margem e sem port ou refin: não há o que fazer. Encerra sem atendente.
    return encerrar(estado, `sem saldo: ${resultado.motivo}`, doExtrato ? TEXTOS.semMargemFim : TEXTOS.semSaldoFim, "sem_saldo", [efeito]);
  }
  if (resultado.tipo === "erro") {
    return transferir(estado, `erro no banco: ${resultado.motivo}`, TEXTOS.erroBanco, "erro_banco", [efeito]);
  }
  const { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario } = resultado;
  const mensagem = TEXTOS.oferta(formatarReais(valorCentavos), prazoMeses, formatarReais(parcelaCentavos), DESCONTO[estado.produto ?? "clt"]);
  return ir(estado, "oferta", [mensagem], "com_saldo", [efeito], {
    oferta: { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario },
    autorizacaoPedidaEm: undefined,
    proximaVerificacao: undefined,
    ofertaEm: agora.toISOString(),
    ultimoContatoCliente: undefined,
    followupEnviado: false,
  });
}

async function etapaInicio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const intencao = await deps.classificador.intencao(texto);

  if (intencao === "acompanhar_proposta") {
    const proposta = await deps.statusProposta();
    if (!proposta) return transferir(estado, "quer acompanhar uma proposta sem registro", TEXTOS.transferindo, intencao);
    return ir(estado, "inicio", [TEXTOS.statusProposta(proposta.banco, proposta.status)], intencao);
  }

  // Quem já diz o vínculo na primeira mensagem pula a pergunta. "Outro" fica de fora
  // aqui porque "quero outro empréstimo" não diz nada sobre o vínculo.
  // Um número solto antes de ver a lista não é escolha de produto.
  const convenio = /^\d+\W*$/.test(texto) ? null : await deps.classificador.convenio(texto);
  if (convenio && convenio !== "outro") return decidirEContinuar(estado, convenio, texto, deps, [TEXTOS.apresentacao]);

  if (intencao === "duvida") {
    const faq = buscarFaq(texto);
    if (!faq) return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, intencao);
    return ir(estado, "convenio", [faq, TEXTOS.saudacao], intencao);
  }

  return ir(estado, "convenio", [TEXTOS.saudacao], intencao);
}

async function etapaConvenio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const convenio = await deps.classificador.convenio(texto);
  return convenio ? decidirEContinuar(estado, convenio, texto, deps) : ouvirCliente(estado, texto, deps);
}

// "sou siape, meu cpf é ...": decide o produto e já usa o CPF (e a data) da mesma mensagem,
// em vez de pedir de novo.
async function decidirEContinuar(estado: EstadoMaisa, convenio: ConvenioEntendido, texto: string, deps: Dependencias, prefixo: string[] = []): Promise<Passo> {
  const faq = buscarFaq(texto);
  const p = decidirConvenio(estado, convenio, faq ? [...prefixo, faq] : prefixo);
  if (p.estado.etapa !== "cpf" || !extrairCpf(texto)) return p;
  const q = await etapaCpf(p.estado, texto, deps);
  return { ...q, respostas: [...prefixo, ...q.respostas], efeitos: [...p.efeitos, ...q.efeitos] };
}

async function etapaCpf(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const cpf = extrairCpf(texto);
  if (cpf) {
    if (!cpfValido(cpf)) return tentarDeNovo(estado, TEXTOS.cpfInvalido, "cpf_invalido");
    if (porExtrato(estado.produto)) {
      // "CPF 15/03/1958": a data veio junto, segue direto para o extrato.
      const data = lerDataNascimento(texto.replace(/\d{3}\.?\s?\d{3}\.?\s?\d{3}\s?-?\s?\d{2}/, " "), deps.agora());
      if (data) {
        const q = await seguirParaExtrato({ ...estado, etapa: "nascimento", cpfFim: cpf.slice(-4) }, data, deps);
        return { ...q, efeitos: [{ tipo: "cpf", cpf }, ...q.efeitos], rotulo: "cpf_e_data" };
      }
      return ir(estado, "nascimento", [TEXTOS.pedeNascimento], "cpf_valido", [{ tipo: "cpf", cpf }], { cpfFim: cpf.slice(-4) });
    }
    return ir(estado, "nome", [TEXTOS.pedeNome], "cpf_valido", [{ tipo: "cpf", cpf }], { cpfFim: cpf.slice(-4) });
  }
  if ((await deps.classificador.simNao(texto)) === "nao") {
    return transferir(estado, "não quis informar o CPF", TEXTOS.semConsentimento, "recusou_cpf");
  }
  return ouvirCliente(estado, texto, deps);
}

// Nome com pelo menos duas palavras, só letras.
const NOME_COMPLETO = /^[a-zA-ZÀ-ÿ'´`^~-]{2,}( [a-zA-ZÀ-ÿ'´`^~.-]+)+$/;

async function etapaNome(estado: EstadoMaisa, texto: string): Promise<Passo> {
  const nome = texto.replace(/\s+/g, " ").trim();
  if (nome.length <= 120 && NOME_COMPLETO.test(nome)) {
    return ir(estado, "consentimento", [TEXTOS.pedeConsentimento], "nome_valido", [], { nome });
  }
  if (texto.includes("?")) return foraDaEtapa(estado, texto);
  return tentarDeNovo(estado, TEXTOS.nomeInvalido, "nome_invalido");
}

// "15/03/1958", "15-03-58", "15 03 1958", "15031958", "150358", "1958-03-15" ou "15 de março de
// 1958". Com mais de uma data ("15/03/1958, ah não, é 16/03/1958"), vale a última. Devolve
// AAAA-MM-DD, ou null se nenhuma data tiver idade entre 18 e 100 anos.
export function lerDataNascimento(texto: string, agora: Date): string | null {
  const validas = datasNoTexto(texto, agora).filter((d) => {
    const idade = idadeEm(d.iso, agora);
    return idade >= 18 && idade <= 100;
  });
  return validas.length ? validas[validas.length - 1].iso : null;
}

const produtoExtrato = (estado: EstadoMaisa): ProdutoExtrato => (porExtrato(estado.produto) ? estado.produto : "inss");

// Ano impossível com cara de erro de digitação (1852 no lugar de 1952): a data que
// provavelmente era. null se não der para adivinhar com segurança.
export function sugerirDataNascimento(texto: string, agora: Date): string | null {
  const m = texto.match(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})\b/);
  if (!m || m[3].startsWith("19")) return null;
  return lerDataNascimento(`${m[1]}/${m[2]}/19${m[3].slice(2)}`, agora);
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

// Com a data em mãos: se o extrato já chegou antes, lê e simula agora; senão, pede o extrato.
async function seguirParaExtrato(estado: EstadoMaisa, data: string, deps: Dependencias): Promise<Passo> {
  const pronto: EstadoMaisa = { ...estado, etapa: "extrato", tentativas: 0, dataNascimento: data, dataSugerida: undefined, extratoPendenteId: undefined };
  if (estado.extratoPendenteId) return etapaExtrato(pronto, { texto: null, documento: true }, deps, estado.extratoPendenteId);
  return { estado: pronto, respostas: [TEXTOS.pedeExtrato(produtoExtrato(estado))], efeitos: [], rotulo: "nascimento_valido" };
}

async function etapaNascimento(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Confirmou a data que ela sugeriu ("isso", "sim", "tá certa").
  if (estado.dataSugerida && ((await deps.classificador.simNao(texto)) === "sim" || /(cert|corret|exato|essa mesma|isso)/.test(t))) {
    return seguirParaExtrato(estado, estado.dataSugerida, deps);
  }
  const data = lerDataNascimento(texto, deps.agora());
  if (data) return seguirParaExtrato(estado, data, deps);
  const datas = datasNoTexto(texto, deps.agora());
  const ultima = datas[datas.length - 1];
  if (ultima && idadeEm(ultima.iso, deps.agora()) < 18) return tentarDeNovo(estado, TEXTOS.menorDeIdade, "menor_de_idade");
  // "70 anos faz?": a idade entra na análise; a data é que diz o prazo.
  if (!datas.length && (/\b\d{2,3}\s*anos\b/.test(t) || /(ate que idade|idade (maxima|limite)|qual a idade|tem limite de idade)/.test(t))) {
    return { estado, respostas: [TEXTOS.perguntaIdade], efeitos: [], rotulo: "pergunta_idade" };
  }
  const sugerida = sugerirDataNascimento(texto, deps.agora());
  if (sugerida) return ir(estado, "nascimento", [TEXTOS.confirmaData(dataBr(sugerida))], "nascimento_sugerido", [], { dataSugerida: sugerida });
  // Sem número nenhum, é conversa: responde antes de pedir a data de novo.
  if (!/\d/.test(texto)) return ouvirCliente(estado, texto, deps);
  return tentarDeNovo(estado, TEXTOS.nascimentoInvalido, "nascimento_invalido");
}

// Chegou um PDF ou foto: lê como extrato e simula. Texto: explica como tirar o extrato.
async function etapaExtrato(
  estado: EstadoMaisa,
  entrada: { texto: string | null; documento?: boolean },
  deps: Dependencias,
  documentoId?: string,
): Promise<Passo> {
  if (!entrada.documento) {
    const texto = entrada.texto?.trim() ?? "";
    const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Não sabe tirar o extrato: explica como. Outra conversa ("estou negativo"): responde antes.
    // Só quando fala do extrato ou do aplicativo. "Não tenho margem" é outra conversa.
    const comoTirar =
      /(como|onde) (eu )?(tiro|tirar|baixo|baixar|pego|pegar|acho|achar|faco|fazer)|nao (sei|consigo) (tirar|baixar|pegar|achar|entrar|abrir|fazer)|nao tenho (o |a )?(extrato|aplicativo|app|sougov|senha|gov|celular)|sougov|meu inss|aplicativo|senha do gov|^nao (tenho|sei)( isso| esse| ele| nao)?[\s.!]*$/;
    // Data de novo, ou corrigida ("errei, é 16/03/1958"): atualiza de verdade antes da simulação.
    const novaData = lerDataNascimento(texto, deps.agora());
    if (novaData) {
      if (novaData === estado.dataNascimento) return { estado, respostas: [TEXTOS.dataJaAnotada, RETOMA_ETAPA.extrato!], efeitos: [], rotulo: "data_repetida" };
      return { estado: { ...estado, dataNascimento: novaData }, respostas: [TEXTOS.dataCorrigida(dataBr(novaData)), RETOMA_ETAPA.extrato!], efeitos: [], rotulo: "data_corrigida" };
    }
    if (/senha.{0,25}(expir|aspir|venc|bloque|caduc)|(esqueci|perdi|nao lembro)( a| minha)? senha/.test(t)) {
      return { estado, respostas: [TEXTOS.senhaGov(produtoExtrato(estado))], efeitos: [], rotulo: "senha_gov" };
    }
    if (/mensagem nao suportada|message type unknown/.test(t)) return { estado, respostas: [TEXTOS.mensagemNaoSuportada], efeitos: [], rotulo: "mensagem_nao_suportada" };
    // "Serve de ontem?" ou "o do mês passado serve?": serve. Responde sem contar como tentativa.
    if (/(serve|vale|pode ser|tem problema|da certo|aceita).*(ontem|antig|passad|velho|de hoje|recente|anterior|outro dia)|(ontem|antig|passad|velho|anterior|outro dia).*(serve|vale|pode ser|da certo)/.test(t)) {
      return { estado, respostas: [TEXTOS.extratoRecente], efeitos: [], rotulo: "extrato_recente" };
    }
    // Link do Acrobat, Drive etc.: ela não abre link, explica como mandar o arquivo.
    if (/https?:\/\/|www\.|acrobat|drive\.google|onedrive|dropbox/.test(t)) {
      return tentarDeNovo(estado, TEXTOS.extratoPorLink, "extrato_por_link", "sem_extrato");
    }
    // "Já está aí", "já mandei": nada chegou. Diz isso e explica como mandar.
    if (/(ja (esta|ta|mandei|enviei|foi|te mandei|te enviei))|((mandei|enviei|esta|ta) a(i|qui))/.test(t)) {
      return tentarDeNovo(estado, TEXTOS.extratoNaoChegou, "extrato_nao_chegou", "sem_extrato");
    }
    if (!t || comoTirar.test(t)) {
      return tentarDeNovo(estado, TEXTOS.comoTirarExtrato(produtoExtrato(estado)), "sem_extrato", "sem_extrato");
    }
    return ouvirCliente(estado, texto, deps);
  }
  let resultado: ResultadoExtrato;
  try {
    resultado = await deps.simularPorExtrato(produtoExtrato(estado), estado.dataNascimento ?? "", documentoId);
  } catch (err) {
    resultado = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na leitura do extrato" };
  }
  if (resultado.tipo === "alternativa") {
    const troco = resultado.trocoCentavos ? formatarReais(resultado.trocoCentavos) : null;
    const { operacao, trocoCentavos, motivo, digitacao, reducoes, simulacoes, renda, matricula, contaSalario } = resultado;
    const lidos = {
      ...(renda ? { renda } : {}),
      ...(matricula ? { matricula } : {}),
      ...(contaSalario ? { contaSalario } : {}),
      ...(simulacoes?.length ? { simulacoes } : {}),
    };
    // Sem simulação na Facta (INSS, refin ou simulação que falhou): pode passar, mas
    // ela não oferta o que não simulou. A equipe simula e mostra ao cliente.
    if (!resultado.simulada) {
      const comAlternativa: EstadoMaisa = { ...estado, alternativa: { operacao, trocoCentavos, motivo, ...lidos } };
      return transferir(comAlternativa, `sem margem para novo; ${motivo}`, TEXTOS.semMargemExtrato, "alternativa", [], "alternativa");
    }
    // Já tinha dito SIM: avisa que vai digitar e pede o que falta, começando pelo contrato.
    if (estado.aceitouOferta && digitacao && deps.digitacaoAtiva) {
      const ganho = TEXTOS.ganhoPort(troco, digitacao.banco, r$(digitacao.parcela), digitacao.refin ? null : r$(digitacao.port.parcela));
      // Número do contrato já no extrato: retoma direto nos dados do cliente.
      if (digitacao.numeroContrato) {
        const comAlternativa: EstadoMaisa = {
          ...estado,
          aceitouOferta: undefined,
          alternativa: { operacao, trocoCentavos, motivo, digitacao, ...(reducoes?.length ? { reducoes } : {}), ...lidos },
        };
        return iniciarColetaPort(comAlternativa, digitacao.numeroContrato, "retoma_contrato", [TEXTOS.retomaSemNumero(ganho)]);
      }
      return ir(
        estado,
        "numero_contrato",
        [
          TEXTOS.retomaDigitacao(
            digitacao.banco,
            r$(digitacao.parcela),
            TEXTOS.ganhoPort(
              troco,
              digitacao.banco,
              r$(digitacao.parcela),
              digitacao.refin ? null : r$(digitacao.port.parcela),
            ),
          ),
        ],
        "retoma_contrato",
        [],
        {
          aceitouOferta: undefined,
          alternativa: { operacao, trocoCentavos, motivo, digitacao, ...(reducoes?.length ? { reducoes } : {}), ...lidos },
        },
      );
    }
    return ir(estado, "oferta_port", [TEXTOS.ofertaPort({ operacao, trocoCentavos, digitacao, reducoes })], "alternativa", [], {
      alternativa: { operacao, trocoCentavos, motivo, ...(digitacao ? { digitacao } : {}), ...(reducoes?.length ? { reducoes } : {}), ...lidos },
      // Relógio do lembrete e do Carrinho, igual à oferta de empréstimo novo.
      ofertaEm: deps.agora().toISOString(),
      ultimoContatoCliente: undefined,
      followupEnviado: false,
    });
  }
  if (resultado.tipo === "servidor_outro") {
    return transferir(estado, resultado.motivo, TEXTOS.servidorNaoFederal, "servidor_outro", [], "servidor_outro");
  }
  if (resultado.tipo === "extrato_invalido") {
    return tentarDeNovo(estado, TEXTOS.extratoInvalido(produtoExtrato(estado)), "extrato_invalido", "extrato_invalido");
  }
  return mostrarResultado(estado, resultado, deps.agora());
}

async function pedirAutorizacao(
  estado: EstadoMaisa,
  deps: Dependencias,
  rotulo: string,
  reenvio = false,
  aviso?: string,
): Promise<Passo> {
  let resultado: ResultadoAutorizacao;
  try {
    resultado = await deps.solicitarAutorizacao(estado.nome ?? "");
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha no pedido de autorização";
    return transferir(estado, `erro no banco: ${motivo}`, TEXTOS.erroBanco, "erro_banco", [], "erro_banco");
  }

  if (resultado === "telefone_de_outro_cpf") {
    return transferir(estado, "o celular já está ligado a outro CPF no banco", TEXTOS.transferindo, rotulo, [], "telefone_outro_cpf");
  }
  if (resultado === "erro") {
    return transferir(estado, "erro no banco: pedido de autorização recusado", TEXTOS.erroBanco, rotulo, [], "erro_banco");
  }
  // Já autorizou nos últimos 30 dias: consulta direto.
  // Sem renovar de novo, para não ficar num ciclo se a Facta insistir em "expirado".
  if (resultado === "ja_autorizado") return consultarAgora(estado, deps, rotulo, true, false);

  const agora = deps.agora();
  return ir(estado, "aguardando", [aviso ?? (reenvio ? TEXTOS.linkReenviado : TEXTOS.avisoLink)], rotulo, [], {
    autorizacaoPedidaEm: reenvio && estado.autorizacaoPedidaEm ? estado.autorizacaoPedidaEm : agora.toISOString(),
    proximaVerificacao: new Date(agora.getTime() + 60_000).toISOString(),
    reenvios: reenvio ? (estado.reenvios ?? 0) + 1 : 0,
  });
}

// Consulta o banco. "avisar" = o cliente está esperando uma resposta agora.
async function consultarAgora(
  estado: EstadoMaisa,
  deps: Dependencias,
  rotulo: string,
  avisar: boolean,
  podeRenovar = true,
): Promise<Passo> {
  let resultado: ResultadoConsulta;
  try {
    resultado = await deps.consultar();
  } catch (err) {
    resultado = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na consulta" };
  }

  const agora = deps.agora();
  const pedidaEm = new Date(estado.autorizacaoPedidaEm ?? agora.toISOString());
  const esperando = { ...estado, etapa: "aguardando" as const, autorizacaoPedidaEm: pedidaEm.toISOString() };

  if (resultado.tipo === "nao_autorizado") {
    if (agora.getTime() - pedidaEm.getTime() > PRAZO_AUTORIZACAO_MS) {
      return transferir(esperando, "não autorizou o link do banco em 48 horas", null, rotulo, [], "link_nao_autorizado");
    }
    const proxima = proximaVerificacao(pedidaEm, agora);
    if (!avisar) return { estado: { ...esperando, proximaVerificacao: proxima }, respostas: [], efeitos: [], rotulo };
    // O cliente diz que autorizou, mas o banco ainda não mostra. Na terceira vez, a equipe ajuda.
    const tentativas = estado.tentativas + 1;
    if (tentativas > MAX_TENTATIVAS) {
      return transferir(esperando, "cliente diz que autorizou, mas o banco não mostra", TEXTOS.transferindo, rotulo, [], "link_nao_autorizado");
    }
    return { estado: { ...esperando, tentativas, proximaVerificacao: proxima }, respostas: [TEXTOS.aindaNaoAutorizou], efeitos: [], rotulo };
  }
  // O link venceu antes de o cliente autorizar: pede outro e avisa, até o limite de reenvios.
  if (resultado.tipo === "link_expirado") {
    if (!podeRenovar || (estado.reenvios ?? 0) >= MAX_REENVIOS) {
      return transferir(esperando, "o link do banco venceu e o pedido novo não resolveu", TEXTOS.transferindo, rotulo, [], "link_nao_autorizado");
    }
    return pedirAutorizacao(esperando, deps, "link_expirado", true, TEXTOS.linkVencido);
  }
  if (resultado.tipo === "indisponivel") {
    // Virada de folha: o banco volta em algumas horas. Checa de novo em 1 hora.
    const proximaEm = new Date(agora.getTime() + 60 * 60_000).toISOString();
    return { estado: { ...esperando, proximaVerificacao: proximaEm }, respostas: avisar ? [TEXTOS.viradaFolha] : [], efeitos: [], rotulo };
  }
  return mostrarResultado(esperando, resultado, agora);
}

async function etapaConsentimento(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  if (resposta === "nao") return transferir(estado, "não autorizou a consulta", TEXTOS.semConsentimento, "nao_autorizou");
  if (resposta !== "sim") return ouvirCliente(estado, texto, deps);
  return pedirAutorizacao(estado, deps, "autorizou");
}

async function etapaAguardando(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  if (await deps.classificador.linkNaoChegou(texto)) {
    if ((estado.reenvios ?? 0) >= MAX_REENVIOS) {
      return transferir(estado, "o link do banco não chegou para o cliente", TEXTOS.transferindo, "link_nao_chegou", [], "link_nao_autorizado");
    }
    return pedirAutorizacao(estado, deps, "reenviar_link", true);
  }
  if (texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);
  // Qualquer outra coisa ("autorizei", "pronto") faz ela olhar no banco na hora.
  return consultarAgora(estado, deps, "cliente_respondeu", true);
}

// Aceitou a port ou o refin: a equipe confirma o saldo na CIP e digita. Recusou: encerra.
async function etapaOfertaPort(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  return tratarOferta(estado, texto, deps);
}

// Quantas dúvidas seguidas ela responde na oferta antes de chamar a equipe.
const MAX_DUVIDAS_OFERTA = 3;

// A resposta à oferta (port ou empréstimo novo). A ordem importa: primeiro o que o código
// reconhece com certeza (pedido de explicação, cumprimento, "ok", dado repetido), depois a
// leitura do modelo, com travas. Aceite só segue sem condição; "ok" e "valeu" pedem
// confirmação; outro valor ou prazo vai para a equipe; data ou CPF corrigidos também.
async function tratarOferta(atual: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  // O "posso seguir?" vale só para a resposta seguinte. Se o cliente perguntou outra coisa
  // no meio, um "👍" depois pode ser só "entendi a resposta".
  const pediuConfirmacao = Boolean(atual.confirmarAceite);
  const estado: EstadoMaisa = { ...atual, confirmarAceite: undefined };
  const port = estado.etapa === "oferta_port";
  const t = normalizar(texto);
  const pergunta = PERGUNTA_DA_ETAPA[estado.etapa];
  const fica = (respostas: string[], rotulo: string, extra: Partial<EstadoMaisa> = {}): Passo => ({ estado: { ...estado, ...extra }, respostas, efeitos: [], rotulo });
  const duvida = (respostas: string[], rotulo: string): Passo => {
    const n = estado.tentativas + 1;
    if (n > MAX_DUVIDAS_OFERTA) return transferir(estado, "muitas dúvidas seguidas na oferta", TEXTOS.duvidaParaEquipe, "duvidas_oferta", [], "objecao");
    return { estado: { ...estado, tentativas: n }, respostas, efeitos: [], rotulo };
  };

  if (PEDE_EXPLICACAO.test(t)) return duvida([explicarOferta(estado), pergunta], "explicacao_oferta");

  const social = mensagemSocial(texto);
  if (social) {
    if (pediuConfirmacao && socialPositivo(social, texto)) return seguirComAceite(estado, deps, texto);
    if (social === "confuso") return duvida([explicarOferta(estado), pergunta], "explicacao_oferta");
    const antes = RESPOSTA_SOCIAL[social] ? [RESPOSTA_SOCIAL[social]!] : [];
    // "ok", "👍", "valeu": não é sim nem não. Pergunta de novo, e o próximo "sim" ou "ok" vale.
    if (social === "confirmacao_curta" || social === "emoji" || social === "agradecimento") {
      return fica([...antes, TEXTOS.confirmaAceite], `confirma_${social}`, { confirmarAceite: true });
    }
    return fica([...antes, TEXTOS.relembraOferta], `social_${social}`);
  }

  const dado = dadoNaOferta(estado, texto, deps.agora());
  if (dado) return dado;
  if (RECOMECAR.test(t)) return fica([TEXTOS.recomecar], "recomecar");

  // O modelo lê (com reserva nas regras). O código trava o aceite.
  const leitura = await deps.classificador.lerOferta(texto, contextoOferta(estado));
  if (leitura?.tipo === "humano") return transferir(estado, "quer falar com uma pessoa", TEXTOS.transferindo, "humano", [], "objecao");
  const simForte = (SIM_FORTE.test(t) || ACEITE_NO_FIM.test(t)) && !NAO_QUERO.test(t);
  // "quero não", "aceito não", "claro que não": recusa, mesmo que o modelo leia aceite.
  const negou = NAO_QUERO.test(t) && !simForte;
  const simRegra = (/^(sim+|s|ss|claro|quero|aceito|isso(?! (e|eh|ai e|nao)\b)|bora)\b/.test(t) || simForte) && !NAO_QUERO.test(t);
  let aceite = !negou && (leitura ? leitura.tipo === "aceita" || simForte : simRegra);
  // "aceito?", "sim? o que acontece?": a palavra de aceite virou pergunta.
  if (aceite && /\b(sim+|quero( sim)?|aceito|pode (fazer|seguir|mandar)|fechado|bora|topo)\s*\?/.test(t)) aceite = false;
  // "pode ser que sim", "talvez": não é aceite. Pergunta de novo, sem pressa.
  if (HESITACAO.test(t) && !simForte) return fica([TEXTOS.semPressa], "hesitacao");
  // Na port + refin, "quero só a portabilidade, sem troco": oferece a port sem refin.
  if (port && estado.alternativa?.digitacao?.refin && SEM_REFIN.test(t)) return contornar(estado, texto, { tipo: "objecao", objecao: "prazo_longo", outraOferta: null });
  // "sim?" e "e se eu quiser?" são perguntas, não aceite.
  if (aceite && /\?\s*$/.test(texto) && !simForte && !/^(sim+|quero|aceito)\b.{4,}/.test(t)) aceite = false;
  if (aceite) {
    if (OUTRO_VALOR.test(t)) {
      return transferir(estado, `aceitou com outro valor ou prazo: "${texto.slice(0, 120)}"`, TEXTOS.outroValorEquipe, "outro_valor", [], "alternativa");
    }
    if (temCondicao(t)) {
      if (port && leitura && (leitura.objecao === "prazo_longo" || leitura.objecao === "pouco_valor")) return contornar(estado, texto, leitura);
      const sobre = respostaSobreOferta(estado, t);
      return fica(sobre ? [sobre, TEXTOS.confirmaCondicao] : [TEXTOS.confirmaAntes], "aceite_condicional", { confirmarAceite: true });
    }
    // Aceite com pergunta ou pedido junto ("sim, quando cai?", "quero, e me manda o contato"):
    // responde e segue.
    const antes = [respostaSobreOferta(estado, t), buscarFaq(texto)].filter((x): x is string => Boolean(x));
    return seguirComAceite(estado, deps, texto, antes);
  }
  if (leitura?.tipo === "pensar") return fica([TEXTOS.semPressa], "pensando");
  // Pergunta que a oferta responde vem antes da objeção ("e o prazo?" não é reclamar do prazo).
  const sobrePergunta = texto.includes("?") ? respostaSobreOferta(estado, t) : null;
  if (sobrePergunta && leitura?.tipo !== "recusa") return duvida([sobrePergunta, pergunta], "duvida_oferta");
  if (leitura && (leitura.tipo === "objecao" || (leitura.tipo === "recusa" && leitura.objecao))) {
    if (port) return contornar(estado, texto, leitura);
    return objecao(estado, texto, "objeção na oferta", leitura.tipo === "recusa");
  }
  const recusa = negou || (leitura ? leitura.tipo === "recusa" : /^(nao|n|nn)\W*$/.test(t));
  if (recusa) {
    if (port) return objecao(estado, texto, "recusou a portabilidade", true);
    return transferir(estado, "recusou a oferta", TEXTOS.recusou, "recusou");
  }
  const sobre = respostaSobreOferta(estado, t);
  if (sobre) return duvida([sobre, pergunta], "duvida_oferta");
  const faq = buscarFaq(texto);
  if (faq) return fica([faq, pergunta], "faq");
  // "dá pra fazer em 48x?", "consegue 5 mil?": outro valor ou prazo é com a equipe.
  if (OUTRO_VALOR.test(t) && /\b(da pra|pode ser|consegue|quero|queria|faz|fazer|tem como|seria possivel|aceito|prefiro)\b/.test(t) && !/\bpor que\b|\bporque\b/.test(t)) return transferir(estado, `pediu outro valor ou prazo: "${texto.slice(0, 120)}"`, TEXTOS.outroValorEquipe, "outro_valor", [], "alternativa");
  if (temReceio(t)) return transferir(estado, port ? "objeção na oferta de portabilidade" : "objeção na oferta", TEXTOS.objecao, "objecao", [], "objecao");
  if (texto.includes("?")) {
    return transferir(estado, `dúvida sem resposta pronta na oferta: ${texto.slice(0, 120)}`, TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
  }
  return duvida([TEXTOS.naoSeiSeEntendi], "oferta_nao_entendida");
}

// Data ou CPF na oferta. Igual ao que ela já tem: avisa que está anotado. Diferente: a
// simulação foi feita com o dado antigo, então a equipe refaz.
function dadoNaOferta(estado: EstadoMaisa, texto: string, agora: Date): Passo | null {
  const t = normalizar(texto);
  const pergunta = PERGUNTA_DA_ETAPA[estado.etapa];
  const soDado = /^[\d\s./,\-]+$/.test(texto.trim());
  const datas = datasNoTexto(texto, agora);
  if (datas.length && (soDado || CORRECAO.test(t) || /nasc|data/.test(t))) {
    const nova = datas[datas.length - 1].iso;
    if (nova === estado.dataNascimento) return { estado, respostas: [TEXTOS.dataJaAnotada, pergunta], efeitos: [], rotulo: "data_repetida" };
    const antiga = estado.dataNascimento ? dataBr(estado.dataNascimento) : "sem data";
    return transferir(estado, `cliente corrigiu a data de nascimento depois da oferta (${antiga} para ${dataBr(nova)}): refazer a simulação`, TEXTOS.dadoCorrigidoEquipe, "dado_corrigido", [], "alternativa");
  }
  const cpf = extrairCpf(texto);
  if (cpf && cpfValido(cpf)) {
    // Só diz "já está anotado" quando é o mesmo CPF. Outro CPF, ou sem como conferir: a equipe confere.
    if (estado.cpfFim && cpf.slice(-4) === estado.cpfFim && !CORRECAO.test(t)) return { estado, respostas: [TEXTOS.cpfJaAnotado, pergunta], efeitos: [], rotulo: "cpf_repetido" };
    return transferir(estado, "cliente informou outro CPF depois da oferta: conferir e refazer a simulação", TEXTOS.dadoCorrigidoEquipe, "dado_corrigido", [], "alternativa");
  }
  if (soDado) return { estado, respostas: [TEXTOS.numeroNaOferta, pergunta], efeitos: [], rotulo: "numero_na_oferta" };
  return null;
}

// Aceite sem condição: port vai para o número do contrato (ou direto para os dados, se o
// número veio junto ou está no extrato); empréstimo novo vai para os dados.
function seguirComAceite(estado: EstadoMaisa, deps: Dependencias, texto: string, antes: string[] = []): Passo {
  const limpo: EstadoMaisa = { ...estado, confirmarAceite: undefined, tentativas: 0 };
  if (estado.etapa === "oferta_port") {
    const dig = estado.alternativa?.digitacao;
    if (dig && deps.digitacaoAtiva) {
      const numero = dig.numeroContrato ?? (/\d{5,}/.test(texto) ? extrairNumeroContrato(texto) : null);
      if (numero) return iniciarColetaPort(limpo, numero, "aceitou_port", [...antes, TEXTOS.inicioContrato]);
      return ir(limpo, "numero_contrato", [...antes, TEXTOS.pedeNumeroContrato(dig.banco, formatarReais(Math.round(dig.parcela * 100)))], "aceitou_port");
    }
    return transferir(limpo, `aceitou: ${estado.alternativa?.motivo ?? "portabilidade"}`, TEXTOS.aceitouPort, "aceitou_port", [], "alternativa");
  }
  // INSS e SIAPE com a digitação ligada: ela mesma faz o contrato.
  if (porExtrato(estado.produto) && deps.digitacaoAtiva && estado.oferta?.tabela) {
    const dados: DadosContrato = {};
    if (estado.oferta.renda) dados.renda = estado.oferta.renda;
    if (estado.oferta.matricula) dados.matricula = estado.oferta.matricula;
    if (estado.produto === "siape" && estado.oferta.contaSalario) Object.assign(dados, estado.oferta.contaSalario);
    if (estado.produto === "inss" && estado.oferta.especie) dados.tipoBeneficio = String(estado.oferta.especie);
    const pergunta = proximaPergunta(dados, estado.produto)!;
    return ir(limpo, "coleta", [...antes, TEXTOS.inicioContrato, pergunta], "aceitou_contrato", [], {
      contrato: { dados, pergunta, origem: origemExtrato(dados) },
      ofertaEm: undefined,
      followupEnviado: undefined,
    });
  }
  return transferir(limpo, "aceitou a oferta", TEXTOS.aceitou, "aceitou");
}

// A oferta de empréstimo novo em texto, para o modelo ler a resposta.
function contextoOferta(estado: EstadoMaisa): string {
  if (estado.alternativa) return contextoOfertaPort(estado);
  const o = estado.oferta;
  if (!o) return "oferta de crédito consignado";
  return `Operação: empréstimo novo (dinheiro na conta).\nValor: até ${formatarReais(o.valorCentavos)}.\nParcelas: ${o.prazoMeses} de ${formatarReais(o.parcelaCentavos)}.`;
}

function explicarOferta(estado: EstadoMaisa): string {
  if (estado.alternativa) return explicarOfertaPort(estado.alternativa);
  const o = estado.oferta!;
  return (
    `Te explico de um jeito simples. A Facta te empresta até ${formatarReais(o.valorCentavos)}, que cai na sua conta. ` +
    `Você paga ${o.prazoMeses} parcelas de ${formatarReais(o.parcelaCentavos)}, descontadas direto ${DESCONTO[estado.produto ?? "clt"]}. ` +
    "Não tem nada para pagar para fazer, e o contrato só vale depois que você conferir e assinar pelo link da Facta."
  );
}

// A oferta em texto, para o modelo entender a resposta do cliente.
function contextoOfertaPort(estado: EstadoMaisa): string {
  const a = estado.alternativa;
  const d = a?.digitacao;
  if (!a) return "oferta de portabilidade";
  const linhas = [`Operação: ${a.operacao === "port_refin" ? "portabilidade com refinanciamento (libera troco)" : "portabilidade (só baixa a parcela)"}.`];
  if (d) linhas.push(`Contrato: ${d.banco}, parcela ${r$(d.parcela)}, faltam ${d.prazoRestante} parcelas.`);
  if (d?.refin) linhas.push(`Na Facta: parcela ${r$(d.refin.parcela)} em ${d.refin.prazo} parcelas.`);
  if (a.trocoCentavos) linhas.push(`Troco: até ${formatarReais(a.trocoCentavos)}.`);
  for (const red of a.reducoes ?? []) linhas.push(`${red.banco}: parcela de ${r$(red.atual)} para ${r$(red.nova)}.`);
  return linhas.join("\n");
}

const MAX_CONTORNOS = 2;

// Contorna a objeção com os argumentos aprovados pelo dono e os números da simulação.
// Depois de duas tentativas, ou sem argumento para aquele caso, a equipe assume.
function contornar(estado: EstadoMaisa, texto: string, l: LeituraOferta): Passo {
  const a = estado.alternativa;
  const dig = a?.digitacao;
  const vezes = estado.contornos ?? 0;
  const motivo = `objeção (${l.objecao ?? "sem motivo"}): ${texto.slice(0, 120)}${l.outraOferta ? ` | outra oferta: ${l.outraOferta}` : ""}`;
  if (vezes >= MAX_CONTORNOS) {
    return transferir(estado, motivo, l.objecao === "desconfianca" ? TEXTOS.objecao : TEXTOS.recusaValor, "objecao", [], "objecao");
  }
  const fica = (respostas: string[], extra: Partial<EstadoMaisa> = {}): Passo => ({
    estado: { ...estado, ...extra, contornos: vezes + 1 },
    respostas,
    efeitos: [],
    rotulo: `contorno_${l.objecao}`,
  });
  switch (l.objecao) {
    case "desconfianca":
      return fica([TEXTOS.contornoConfianca, PERGUNTA_DA_ETAPA.oferta_port]);
    case "pouco_valor":
      if (a?.trocoCentavos && dig?.refin) return fica([TEXTOS.contornoPoucoValor(r$(dig.refin.parcela), formatarReais(a.trocoCentavos))]);
      break;
    case "prazo_longo":
      // Não quer esticar: oferece a port sem refin, que mantém as parcelas que faltam.
      if (a && dig?.refin && dig.port.parcela < dig.parcela) {
        const reducoes = [{ banco: dig.banco, atual: dig.parcela, nova: dig.port.parcela, restantes: dig.prazoRestante }];
        return fica([TEXTOS.contornoPrazo(dig.banco, dig.prazoRestante, r$(dig.parcela), r$(dig.port.parcela))], {
          alternativa: { ...a, operacao: "portabilidade", trocoCentavos: null, digitacao: { ...dig, refin: undefined }, reducoes },
        });
      }
      break;
    case "oferta_melhor":
      if (l.outraOferta) return transferir(estado, motivo, TEXTOS.ofertaMelhorEquipe, "objecao", [], "objecao");
      return fica([TEXTOS.perguntaOutraOferta]);
  }
  return transferir(estado, motivo, l.tipo === "recusa" ? TEXTOS.recusaValor : TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
}

// Número do contrato no banco de origem: a Facta precisa dele para comprar a dívida.
async function etapaNumeroContrato(estado: EstadoMaisa, texto: string): Promise<Passo> {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/nao sei|nao tenho|nao lembro|nao acho|onde (eu )?(vejo|acho|encontro|pego)|voces nao tem/.test(t)) {
    return transferir(estado, "não sabe o número do contrato", TEXTOS.semNumeroContrato, "sem_numero_contrato", [], "alternativa");
  }
  // Mandou o contrato de outro banco (ex.: Santander quando o pedido era o Hoje): não aceita.
  const banco = estado.alternativa?.digitacao?.banco ?? "";
  const outro = outroBancoCitado(t, banco);
  if (outro) {
    return tentarDeNovo(estado, TEXTOS.contratoOutroBanco(outro, banco), "contrato_outro_banco", "alternativa");
  }
  const numero = extrairNumeroContrato(texto);
  if (!numero) {
    return tentarDeNovo(estado, TEXTOS.numeroContratoInvalido, "numero_contrato_invalido", "alternativa");
  }
  return iniciarColetaPort(estado, numero, "numero_contrato", [TEXTOS.inicioContrato]);
}

// Começa o cadastro da port com o número do contrato em mãos. Renda, matrícula e conta
// salário já lidas do extrato entram preenchidas: ela não pergunta de novo.
function iniciarColetaPort(estado: EstadoMaisa, numero: string, rotulo: string, antes: string[]): Passo {
  const dados: DadosContrato = {};
  if (estado.alternativa?.renda) dados.renda = estado.alternativa.renda;
  if (estado.alternativa?.matricula) dados.matricula = estado.alternativa.matricula;
  if (estado.produto === "siape" && estado.alternativa?.contaSalario) Object.assign(dados, estado.alternativa.contaSalario);
  const pergunta = proximaPergunta(dados, produtoExtrato(estado))!;
  return ir(estado, "coleta", [...antes, pergunta], rotulo, [], {
    alternativa: { ...estado.alternativa!, numeroContrato: numero },
    contrato: { dados, pergunta, origem: origemExtrato(dados) },
  });
}

// Campos lidos do extrato no início do cadastro: renda, matrícula, conta salário e espécie.
const CAMPOS_DO_EXTRATO: CampoContrato[] = ["renda", "matricula", "bancoConta", "agencia", "conta", "tipoBeneficio"];
function origemExtrato(dados: DadosContrato): Partial<Record<CampoContrato, "extrato">> {
  return Object.fromEntries(CAMPOS_DO_EXTRATO.filter((c) => dados[c] !== undefined && dados[c] !== null && dados[c] !== "").map((c) => [c, "extrato"]));
}

// O número do contrato: o maior trecho com pelo menos 4 dígitos ("Hoje 20250464573").
export function extrairNumeroContrato(texto: string): string | null {
  const trechos = (texto.match(/[0-9A-Za-z.\-/]+/g) ?? [])
    .map((x) => x.replace(/[^0-9A-Za-z]/g, ""))
    .filter((x) => x.length >= 5 && x.length <= 30 && (x.match(/\d/g) ?? []).length >= 4);
  return trechos.sort((a, b) => b.length - a.length)[0] ?? null;
}

// Bancos que o cliente costuma escrever. Usado só para perceber contrato de outro banco.
const NOMES_BANCO: [RegExp, string][] = [
  [/santander|\bole\b/, "Santander/Olé"],
  [/bradesc/, "Bradesco"],
  [/\bitau\b/, "Itaú"],
  [/\bcaixa\b|\bcef\b/, "Caixa"],
  [/banco do brasil|\bbb\b/, "Banco do Brasil"],
  [/\bpan\b/, "PAN"],
  [/\bbmg\b/, "BMG"],
  [/daycoval/, "Daycoval"],
  [/agibank/, "Agibank"],
  [/\bc6\b/, "C6"],
  [/digio/, "Digio"],
  [/safra/, "Safra"],
  [/mercantil/, "Mercantil"],
  [/\bhoje\b/, "Hoje"],
  [/\bqi\b/, "QI"],
  [/sabemi/, "SABEMI"],
  [/futuro/, "Futuro"],
  [/digimais/, "Digimais"],
];

// Nome do banco que o cliente citou, quando não é o do contrato pedido. null se não citou
// banco nenhum ou citou o certo.
function outroBancoCitado(t: string, bancoPedido: string): string | null {
  const pedido = bancoPedido.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const citados = NOMES_BANCO.filter(([re]) => re.test(t));
  if (!citados.length || citados.some(([re]) => re.test(pedido))) return null;
  return citados[0][1];
}

// Na oferta, o que não é SIM é objeção: dúvida com resposta pronta ela responde e repete a
// pergunta. O resto (receio, NÃO, pergunta sem resposta) vai para a equipe como lead quente.
const PENSANDO = /(pensar|pensando|depois|mais tarde|amanh|vou ver|ver com|conversar com|falar com (a|o|minha|meu))/i;

function objecao(estado: EstadoMaisa, texto: string, motivo: string, recusou = false): Passo {
  // "Deixa eu pensar" não é objeção: ela espera (follow-up e Carrinho cuidam do resto).
  if (PENSANDO.test(texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) && !texto.includes("?")) {
    return { estado, respostas: [TEXTOS.semPressa], efeitos: [], rotulo: "pensando" };
  }
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Receio de verdade pede acolhimento e a equipe, mesmo que fale de dinheiro.
  if (temReceio(t)) return transferir(estado, motivo, TEXTOS.objecao, "objecao", [], "objecao");
  // Recusou (NÃO): nunca repetir a oferta. Pedido com resposta pronta (contato da Facta) ela
  // atende; senão a equipe tenta outra condição, com resposta que reconhece o motivo.
  if (recusou) {
    const faqRecusa = buscarFaq(texto);
    if (faqRecusa) return { estado, respostas: [faqRecusa, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
    const motivoValor = /(pouco|baixo|pequeno|valor|troco|dinheiro|prazo|meses|mes|parcela|caro|juros|taxa)/.test(t);
    return transferir(estado, `${motivo}: ${texto.slice(0, 120)}`, motivoValor ? TEXTOS.recusaValor : TEXTOS.recusaSimples, "recusou", [], "objecao");
  }
  // Pergunta sobre a própria oferta: ela sabe a resposta, então responde com os números.
  const sobreOferta = respostaSobreOferta(estado, t);
  if (sobreOferta) return { estado, respostas: [sobreOferta, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "duvida_oferta" };
  const faq = buscarFaq(texto);
  if (faq) return { estado, respostas: [faq, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "faq" };
  // Dúvida que ela não sabe responder: chama a equipe, sem falar em preocupação.
  return transferir(estado, motivo, TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
}

// As perguntas que a oferta já responde, cada uma com a sua regra. Antes, regras largas
// ("qual", "quanto fica", "dinheiro", "parcela") davam a resposta pronta de outra pergunta.
// Mais de uma pergunta na mesma mensagem: responde todas. Nenhuma reconhecida: null.
function respostaSobreOferta(estado: EstadoMaisa, t: string): string | null {
  const a = estado.alternativa;
  const o = estado.oferta;
  if (!a && !o) return null;
  if (PEDE_EXPLICACAO.test(t)) return explicarOferta(estado);
  const dig = a?.digitacao;
  const reds = a?.reducoes ?? [];
  const red = reds[0];
  const refin = Boolean(a?.trocoCentavos && dig?.refin);
  const partes: string[] = [];
  const quer = (re: RegExp) => re.test(t);

  if (quer(/(troco|dinheiro (extra|na mao|a mais)|vai sobrar|sobra (algum|dinheiro|alguma coisa)|quanto (eu )?(pego|ganho|recebo|fico|ficaria|vou receber|vou pegar)|cai na (minha )?conta|valor que eu (fico|ficaria|recebo)|somando|libera (quanto|algum))/)) {
    if (!a) partes.push(`Pela simulação, você recebe até ${formatarReais(o!.valorCentavos)} na sua conta.`);
    else if (a.trocoCentavos) partes.push(`Pela simulação na Facta, você recebe até ${formatarReais(a.trocoCentavos)} de dinheiro extra na sua conta. É uma estimativa: o valor final depende do saldo que o seu banco informar.`);
    else if (red) partes.push(economiaPort(reds));
    else partes.push("Nessa opção não sai dinheiro na mão. O ganho é uma taxa menor no seu contrato.");
  }
  if (quer(/(quanto (fica|vai ficar|e|seria) a parcela|parcela (fica|de quanto|vai ser|e de quanto|aumenta|diminui|cai pra|cai para)|a parcela aumenta|quanto (vou )?pagar (por mes|de parcela|por parcela)|valor da parcela|qual (a|e a) parcela|prestacao|^(e )?(a )?parcela\s*\??$)/)) {
    const citado = reds.find((x) => normalizar(x.banco).split(/[\s-]+/).some((p) => p.length >= 3 && t.includes(p)));
    if (!a) partes.push(`A parcela é de ${formatarReais(o!.parcelaCentavos)}, descontada direto ${DESCONTO[estado.produto ?? "clt"]}.`);
    else if (citado) partes.push(`A parcela do ${citado.banco} cai de ${r$(citado.atual)} para ${r$(citado.nova)}.`);
    else if (refin) partes.push(`A parcela continua ${r$(dig!.refin!.parcela)}, em ${dig!.refin!.prazo} parcelas.`);
    else if (red) partes.push(`A parcela cai de ${r$(red.atual)} para ${r$(red.nova)}, e você continua com as mesmas parcelas que faltavam.`);
  }
  if (quer(/(quantas (parcelas|vezes)|em quantas|qual o prazo|e o prazo|quantos meses)/)) {
    if (!a) partes.push(`São ${o!.prazoMeses} parcelas de ${formatarReais(o!.parcelaCentavos)}.`);
    else if (refin) partes.push(`São ${dig!.refin!.prazo} parcelas na Facta: com o refinanciamento, o contrato recomeça.`);
    else if (red?.restantes) partes.push(`Você continua com as ${red.restantes} parcelas que faltam no contrato do ${red.banco}.`);
  }
  if (quer(/\b(taxa|juros)\b/) && !quer(/(mudar|muda|aumentar|fixa|variar)/)) {
    if (!a) partes.push("Os juros e o custo total aparecem no contrato da Facta, para você conferir antes de assinar.");
    else if (refin && dig!.refin!.taxa) partes.push(`A taxa do refinanciamento na Facta é de ${dig!.refin!.taxa.toLocaleString("pt-BR")}% ao mês.`);
    else if (red?.taxa) partes.push(`Na Facta, a taxa fica em ${red.taxa.toLocaleString("pt-BR")}% ao mês.`);
  }
  if (quer(/((qual|quais|que|de qual)\s+(contrato|contratos|banco|deles)\b|depende do qual|qual deles)/)) {
    if (!a) partes.push("É o banco Facta Financeira, o nosso parceiro.");
    else if (dig) {
      partes.push(
        `É o seu contrato do ${dig.banco}, o de parcela de ${r$(dig.parcela)}, que ainda tem ${dig.prazoRestante} parcelas. ` +
          (a.trocoCentavos
            ? `Ele foi o que deu o melhor resultado na simulação: você recebe até ${formatarReais(a.trocoCentavos)} na sua conta${dig.refin ? `, e a parcela continua ${r$(dig.refin.parcela)}` : ""}.`
            : red
              ? `Na Facta, a parcela dele cai para ${r$(red.nova)}.`
              : "Ele foi o que deu o melhor resultado na simulação."),
      );
    } else if (red) partes.push(`São estes contratos:\n${reds.map((x) => `• ${x.banco}: de ${r$(x.atual)} para ${r$(x.nova)} por mês`).join("\n")}`);
  }
  if (quer(/(quando (cai|o dinheiro|recebo|libera|chega|comeca|vai cair|muda)|quanto tempo (demora|leva)|em quantos dias|demora (quanto|muito)|cai (quando|amanha|hoje)|amanha (ja )?cai)/)) {
    partes.push(
      a && !a.trocoCentavos
        ? "A parcela menor começa a valer depois que a portabilidade é aprovada. Não consigo te prometer uma data exata."
        : "O dinheiro cai depois que a operação é aprovada. Não consigo te prometer um prazo exato.",
    );
  }
  if (quer(/\bseguro\b/) && !quer(/seguro desemprego|e seguro|eh seguro|seguro (mandar|passar)/)) {
    if (!a) partes.push("Não, essa condição é sem seguro.");
    else if (refin) partes.push("O refinanciamento que simulei é sem seguro.");
  }
  if (quer(/(proximo passo|e agora\b|o que eu faco|como (eu )?faco|como funciona agora)/)) {
    partes.push("É só me responder SIM que eu começo o seu contrato. Depois a Facta manda um link no seu WhatsApp para você conferir e assinar.");
  }
  if (a && quer(/(volta (pro|para o|ao) (zero|comeco|inicio)|recomeca|zera)/)) {
    partes.push(refin ? `Sim. Com o refinanciamento, o contrato recomeça na Facta, em ${dig!.refin!.prazo} parcelas.` : "Não. Na portabilidade você continua com as mesmas parcelas que faltam.");
  }
  if (quer(/(como (eu )?assino|assina como|preciso ir (na|em|a) (agencia|loja)|tenho que ir|presencial)/)) {
    partes.push("É tudo pelo celular: a Facta manda um link no seu WhatsApp e você assina por ele, só se concordar.");
  }
  return partes.length ? partes.join("\n\n") : null;
}

// Port sem troco: soma a economia de todos os contratos.
function economiaPort(reds: ReducaoParcela[]): string {
  const porMes = reds.reduce((s, x) => s + (x.atual - x.nova), 0);
  const total = reds.reduce((s, x) => s + (x.atual - x.nova) * (x.restantes ?? 0), 0);
  return (
    "Nessa opção não sai dinheiro na mão, não tem troco. O ganho é pagar menos todo mês: " +
    (reds.length > 1 ? `somando os ${reds.length} contratos, você paga ${r$(porMes)} a menos por mês` : `a parcela cai de ${r$(reds[0].atual)} para ${r$(reds[0].nova)}, ${r$(porMes)} a menos por mês`) +
    (total > 0 ? `, ou ${r$(total)} até o fim dos contratos.` : ".")
  );
}

// A oferta de port em palavras simples, para quem disse "não entendi".
function explicarOfertaPort(a: NonNullable<EstadoMaisa["alternativa"]>): string {
  const dig = a.digitacao;
  if (a.trocoCentavos && dig?.refin) {
    return (
      `Te explico de um jeito simples. A Facta quita o seu empréstimo do ${dig.banco} e faz um contrato novo no lugar dele. ` +
      `A parcela fica ${r$(dig.refin.parcela)} por mês, em ${dig.refin.prazo} parcelas, e a diferença cai na sua conta: até ${formatarReais(a.trocoCentavos)}. ` +
      "Você não paga nada para fazer, o desconto continua direto no salário."
    );
  }
  const reds = a.reducoes ?? [];
  if (reds.length) {
    const porMes = reds.reduce((s, x) => s + (x.atual - x.nova), 0);
    const quais = reds.map((x) => `${x.banco} de ${r$(x.atual)} para ${r$(x.nova)}`).join("; ");
    return (
      `Te explico de um jeito simples. Hoje você paga os seus empréstimos com uma taxa de juros. A Facta compra esses contratos com uma taxa menor, ` +
      `então a parcela diminui: ${quais}. ` +
      `No total, são ${r$(porMes)} a menos por mês. Não sai dinheiro na mão e o número de parcelas que faltam continua o mesmo. ` +
      "Você não paga nada para fazer, o desconto continua direto no salário."
    );
  }
  return "Te explico de um jeito simples: a Facta traz o seu empréstimo para ela com uma taxa menor. Você não paga nada para fazer, o desconto continua direto no salário.";
}

async function etapaOferta(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  return tratarOferta(estado, texto, deps);
}

// Cada resposta do cliente (texto, foto do documento ou áudio já transcrito) preenche
// o que der do cadastro. Falta algo: pergunta o próximo. Completo: mostra o resumo.
async function etapaColeta(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  const produto = produtoExtrato(estado);
  const dados = estado.contrato?.dados ?? {};
  const pergunta = estado.contrato?.pergunta ?? proximaPergunta(dados, produto) ?? TEXTOS.continuarCadastro;
  const texto = entrada.texto?.trim() ?? "";
  // No meio da coleta o cliente mandou o número do contrato do banco certo ("Hoje 2025..."):
  // anota no lugar do anterior e segue com a mesma pergunta.
  const dig = estado.alternativa?.digitacao;
  if (dig && texto && !entrada.documento) {
    const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const citaBancoPedido = NOMES_BANCO.some(
      ([re]) => re.test(t) && re.test(dig.banco.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()),
    );
    const numero = citaBancoPedido ? extrairNumeroContrato(texto) : null;
    if (numero) {
      return {
        estado: { ...estado, alternativa: { ...estado.alternativa!, numeroContrato: numero } },
        respostas: [TEXTOS.contratoAnotado(dig.banco, numero), pergunta],
        efeitos: [],
        rotulo: "numero_contrato_corrigido",
      };
    }
  }
  if (!entrada.documento && texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);
  if (!entrada.documento && /(desisti|nao quero mais|pode cancelar|cancela tudo|deixa pra la)/.test(normalizar(texto))) {
    return transferir(estado, "desistiu no meio do cadastro", TEXTOS.recusou, "desistiu", [], "dados_contrato");
  }
  // "aliás, o número do contrato certo é ...": anota o número novo.
  if (dig && texto && !entrada.documento && /contrato/.test(normalizar(texto)) && CORRECAO.test(normalizar(texto))) {
    const numero = extrairNumeroContrato(texto);
    if (numero) {
      return {
        estado: { ...estado, alternativa: { ...estado.alternativa!, numeroContrato: numero } },
        respostas: [TEXTOS.contratoAnotado(dig.banco, numero), pergunta],
        efeitos: [],
        rotulo: "numero_contrato_corrigido",
      };
    }
  }

  let novos: DadosContrato;
  try {
    novos = await deps.extrairDados(pergunta, entrada, camposFaltando(dados, produto));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "falha ao ler a resposta";
    return transferir(estado, `erro na coleta dos dados: ${motivo}`, TEXTOS.erroDigitacao, "erro_coleta", [], "erro_digitacao");
  }
  if (novos.pixCpf === false) {
    return transferir(estado, "não quer receber por PIX no CPF", TEXTOS.pixRecusado, "pix_recusado", [], "dados_contrato");
  }

  const junto = { ...dados, ...novos };
  const proxima = proximaPergunta(junto, produto);
  if (!proxima) {
    // RG e conta inteiros: mascarados, o cliente achava que estavam incompletos.
    return ir(estado, "confirmacao", [TEXTOS.confirmaDados(resumoDados(junto, true))], "dados_completos", [], {
      contrato: { ...estado.contrato, dados: junto, pergunta: TEXTOS.perguntaConfirmacao },
    });
  }
  if (!Object.keys(novos).length) {
    // Pergunta ou recusa no meio do cadastro ("pra que precisa do nome da mãe?", "meu pai é
    // falecido"): responde com os fatos aprovados e repete a pergunta pendente.
    const tt = normalizar(texto);
    // Sem "?", só frases que travam o cadastro: dado que o cliente não tem ou não quer dar.
    const travou =
      /\b(falecid|nao (tenho|sei|conheco|lembro) (o |a |do |da |meu |minha )?(pai|mae|rg|cnh|identidade|email|e-mail|cep|endereco|conta)|nao vou (passar|mandar|dar|informar))/.test(tt);
    if (!entrada.documento && texto && (texto.includes("?") || travou)) {
      try {
        const r = deps.responderLivre ? await deps.responderLivre(texto, NOME_ETAPA.coleta, estado.produto, pergunta) : null;
        if (r) return { estado: { ...estado, contrato: { ...estado.contrato, dados, pergunta }, tentativas: estado.tentativas + 1 }, respostas: [r, pergunta], efeitos: [], rotulo: "resposta_livre" };
      } catch (err) {
        console.error("Resposta livre falhou no cadastro:", err instanceof Error ? err.message : err);
      }
      return transferir(estado, `dúvida no cadastro: ${texto.slice(0, 120)}`, TEXTOS.duvidaParaEquipe, "duvida_cadastro", [], "dados_contrato");
    }
    const aviso = entrada.documento ? TEXTOS.fotoSemDado : TEXTOS.naoEntendi;
    return tentarDeNovo({ ...estado, contrato: { ...estado.contrato, dados, pergunta } }, `${aviso} ${pergunta}`, "dado_nao_entendido", "dados_contrato");
  }
  return ir(estado, "coleta", [proxima], "dado_recebido", [], { contrato: { ...estado.contrato, dados: junto, pergunta: proxima } });
}

// Confirmação: "correto", "confere", "tá certo", "certinho" também são sim.
// "isso é golpe?" e "isso não" começam com "isso", mas não confirmam.
const CONFIRMA_DADOS =
  /^(sim+|s|ss|isso(?! (e|eh|ai e|nao)\b)|isso mesmo|correto|certo|ta certo|esta certo|tudo certo|ta tudo certo|esta tudo certo|confere|confirmo|confirmado|certinho|exato|perfeito|pode (mandar|seguir|fazer|confirmar)|tudo ok|ok+|okay|beleza|uhum|aham)\b/;
// Na confirmação, quem espera, hesita ou desconfia ainda não confirmou.
const ESPERA_CONFIRMACAO =
  /\b(espera|perai|pera|calma|deixa eu|nao sei|vou (ver|pensar|conferir|olhar)|pensar|depois|amanha|mais tarde|com (meu|minha) (filh|marido|esposa|mulher|famil)|golpe|seguro|confiavel|desconfi|medo|fraude|verdade)/;
// "não tem erro", "não precisa mudar nada": o "não" confirma.
const NAO_QUE_CONFIRMA = /nao (tem|ha|precisa|preciso|falta) (erro|nada|mudar|corrigir|alterar)|nada (errado|a corrigir)/;
// Só sem pergunta: "e se eu desistir depois?" é dúvida. "cancela meu contrato antigo" não é desistir deste.
const DESISTE_CONFIRMACAO = /(desisti\b|desisto|nao quero( mais)?\b|quero nao|pode cancelar|cancela (tudo|isso|esse|essa|o pedido|a proposta)|deixa pra la|nao vou querer)/;

async function etapaConfirmacao(estado: EstadoMaisa, texto: string, deps: Dependencias, mensagemId?: string): Promise<Passo> {
  const t = normalizar(texto);
  // "sim, mas o CEP é…": tem correção junto. Nunca digita: corrige e mostra o resumo de novo.
  const temCorrecao = temCondicao(t) || CORRECAO.test(t) || /\d{3,}|@/.test(t) || /\b(menos|so o|so a|exceto|tirando)\b/.test(t);
  // Qualquer dúvida trava a digitação: pergunta, "não" fora de "não tem erro", hesitação,
  // receio, pedido de explicação ou "hum", "sei", "entendi".
  const nega = (/\b(nao|n|nn)\b/.test(t) && !NAO_QUE_CONFIRMA.test(t)) || NAO_QUERO.test(t);
  // "sim, e quando chega o link?" confirma e pergunta do próximo passo. "sim?" e "tudo certo?" não confirmam.
  const simComPergunta = /^(sim+|s|ss|correto|certo|ta certo|esta certo|tudo certo|ta tudo certo|isso mesmo|confere|certinho|pode (mandar|seguir|fazer))\b(?!\s*\?)[^?]{3,}\?/.test(t);
  const duvida = (texto.includes("?") && !simComPergunta) || temReceio(t) || HESITACAO.test(t) || PEDE_EXPLICACAO.test(t) || ESPERA_CONFIRMACAO.test(t);
  const social = mensagemSocial(texto);
  const ouvindo = social === "confirmacao_curta" && !socialPositivo(social, texto);
  const sim =
    !nega && !duvida && !ouvindo && (CONFIRMA_DADOS.test(t) || socialPositivo(social, texto) || (await deps.classificador.simNao(texto)) === "sim");
  if (!sim) {
    // Dado novo na mensagem (número, e-mail, "o certo é", "menos o…"): é correção.
    const corrigeDado = CORRECAO.test(t) || /\d{3,}|@/.test(t) || /\b(menos|so o|so a|exceto|tirando)\b/.test(t);
    if (DESISTE_CONFIRMACAO.test(t) && !corrigeDado && !texto.includes("?")) return transferir(estado, "desistiu na confirmação dos dados", TEXTOS.recusou, "desistiu", [], "dados_contrato");
    if (temReceio(t)) return transferir(estado, "receio na confirmação dos dados", TEXTOS.objecao, "objecao", [], "dados_contrato");
    if (!corrigeDado) {
      if (texto.includes("?")) return ouvirCliente(estado, texto, deps, TEXTOS.confirmaDadosDeNovo);
      if (HESITACAO.test(t) || ESPERA_CONFIRMACAO.test(t)) return { estado, respostas: [TEXTOS.semPressaConfirmacao], efeitos: [], rotulo: "confirmacao_espera" };
      if (ouvindo || PEDE_EXPLICACAO.test(t)) return tentarDeNovo(estado, TEXTOS.confirmaDadosDeNovo, "confirmacao_ambigua", "dados_contrato");
    }
    return corrigirDados(estado, { texto }, deps);
  }
  if (temCorrecao) return corrigirDados(estado, { texto }, deps);

  // Port pura ou banco de origem sem código: a API da Facta não digita. Tudo coletado, a
  // equipe só cadastra no portal Agente Facta com os dados da nota.
  const dig = estado.alternativa?.digitacao;
  // O cliente apontou um erro que não deu para aplicar ("espera, o CEP é ..." sem a Maisa
  // conseguir ler o CEP). O "sim" agora pode ser resposta a outra coisa: a equipe confere.
  const pendenteCorrecao = estado.contrato?.correcaoPendente;
  if (pendenteCorrecao) {
    return transferir(estado, `o cliente pediu uma correção que a Maisa não conseguiu aplicar ("${pendenteCorrecao}") e depois disse "${texto.trim().slice(0, 40)}": conferir os dados com ele antes de digitar`, TEXTOS.corrigirDados, "correcao_nao_aplicada", [], "dados_contrato");
  }
  if (estado.alternativa && (!dig?.refin || !dig.bancoCodigo)) {
    const motivo = !dig?.refin
      ? "port pura aceita, a API da Facta não digita port sem refin: cadastrar no portal Agente Facta"
      : "banco de origem sem código conhecido: cadastrar no portal Agente Facta";
    return transferir(estado, motivo, TEXTOS.portProntaEquipe, "port_pronta", [], "alternativa");
  }

  // "sim" antigo: chegou depois de uma mensagem relevante que o cliente mandou mais tarde
  // (áudio "sim" baixado depois de um texto "espera"). Não vale como confirmação.
  if (mensagemId && deps.mensagemDepoisDoSim && (await deps.mensagemDepoisDoSim(mensagemId, deps.agora().toISOString()))) {
    return { estado, respostas: [], efeitos: [], rotulo: "sim_antigo_ignorado" };
  }

  // Não digita agora: agenda. Uma mensagem relevante do cliente dentro da janela cancela
  // ("sim" e logo depois "espera, o CEP está errado"). A digitação roda no evento
  // "executar_digitacao", que revalida tudo antes.
  const agora = deps.agora();
  const janela = deps.janelaConfirmacaoMs ?? 30_000;
  return {
    estado: {
      ...estado,
      tentativas: 0,
      sociais: 0,
      confirmacaoPendente: {
        recebidoEm: agora.toISOString(),
        executarEm: new Date(agora.getTime() + janela).toISOString(),
        ...(mensagemId ? { mensagemId } : {}),
        consentimento: texto.trim().slice(0, 80),
      },
    },
    respostas: [TEXTOS.confirmacaoRecebida],
    efeitos: [],
    rotulo: "confirmacao_agendada",
  };
}

// A janela passou: revalida e digita. Cada condição que falha deixa o contrato com a
// equipe, nunca digita "no escuro".
async function executarDigitacao(estado: EstadoMaisa, deps: Dependencias): Promise<Passo> {
  const parado = (rotulo: string, e: EstadoMaisa = estado): Passo => ({ estado: e, respostas: [], efeitos: [], rotulo });
  const p = estado.confirmacaoPendente;
  if (estado.etapa !== "confirmacao" || !p) return parado("nada_a_executar");
  if (deps.agora().getTime() < new Date(p.executarEm).getTime()) return parado("aguardando_janela");
  const limpo: EstadoMaisa = { ...estado, confirmacaoPendente: undefined };
  // Mensagem relevante mandada depois do "sim": o "sim" não vale mais. A mensagem é (ou
  // já foi) lida e decide o que fazer; a digitação só volta com um "sim" novo.
  if (deps.mensagemDepoisDoSim && (await deps.mensagemDepoisDoSim(p.mensagemId, p.recebidoEm))) {
    return parado("digitacao_cancelada_mensagem_nova", limpo);
  }
  const trava = motivoTravaDigitacao(estado, { liberada: deps.digitacaoLiberada === true });
  if (trava) {
    return transferir(limpo, `digitação automática não executada (${trava}): a equipe digita no portal com os dados da nota`, TEXTOS.digitacaoComEquipe, "digitacao_bloqueada", [], "dados_contrato");
  }

  let resultado: ResultadoDigitacao;
  try {
    resultado = await deps.digitar(estado.contrato?.dados ?? {});
  } catch (err) {
    // Exceção fora da Facta (banco de dados, código): sem saber se a Facta foi chamada,
    // trata como resultado desconhecido. Nunca como "pode tentar de novo".
    resultado = { tipo: "desconhecido", etapa: "sistema", mensagem: err instanceof Error ? err.message : "falha na digitação" };
  }
  if (resultado.tipo === "bloqueada") {
    // A Facta não foi chamada. Nada antigo é apresentado como contrato novo.
    return transferir(
      limpo,
      `digitação NÃO feita: ${resultado.motivo}. Confira no portal Facta; para tentar de novo, a operação precisa ser liberada por alguém da equipe`,
      TEXTOS.digitacaoEmConferencia,
      "digitacao_bloqueada_cliente",
      [],
      "erro_digitacao",
    );
  }
  if (resultado.tipo === "abortada") {
    // O cliente mandou mensagem antes do ponto sem volta: nada foi criado. A mensagem dele
    // é lida em seguida.
    return parado("digitacao_abortada", limpo);
  }
  if (resultado.tipo === "desconhecido") {
    return transferir(limpo, `RESULTADO INCERTO na digitação (${resultado.etapa}: ${resultado.mensagem}). A proposta pode existir: conferir no portal Facta antes de digitar de novo`, TEXTOS.digitacaoEmConferencia, "digitacao_incerta", [], "erro_digitacao");
  }
  if (resultado.tipo === "erro") {
    return transferir(
      limpo,
      `a digitação parou na etapa "${resultado.etapa}" (${resultado.mensagem}), antes do cadastro da proposta. Pela sequência da API a proposta não chega a ser criada nessa etapa, mas confira no portal Facta antes de digitar`,
      TEXTOS.erroDigitacao,
      "erro_digitacao",
    );
  }
  return transferir(limpo, `proposta ${resultado.codigoAf} digitada na Facta`, TEXTOS.contratoEnviado(resultado.url), "contrato_enviado", [
    { tipo: "proposta", codigoAf: resultado.codigoAf },
  ]);
}

// Apontou erro no resumo: lê o dado certo da própria mensagem (ou da foto) e mostra o
// resumo de novo. Só "não", ou "o RG está errado" sem o valor: pede o dado certo.
// Sem conseguir depois de duas tentativas, a equipe corrige.
// Dado que veio do extrato (renda, matrícula, conta salário) não é trocado em silêncio:
// a divergência fica registrada e a equipe valida.
async function corrigirDados(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  const dados = estado.contrato?.dados ?? {};
  const t = (entrada.texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const soNegou = !entrada.documento && /^(nao|n|nao esta|nao estao|esta errado|errado|tem erro)[\s.!]*$/.test(t);
  let novos: DadosContrato = {};
  if (!soNegou) {
    try {
      novos = await deps.extrairDados(TEXTOS.qualCorrigir, entrada, todosCampos(produtoExtrato(estado)));
    } catch {
      novos = {};
    }
  }
  const mudou = Object.fromEntries(
    Object.entries(novos).filter(([k, v]) => v !== undefined && v !== null && v !== "" && dados[k as CampoContrato] !== v),
  ) as DadosContrato;
  if (Object.keys(mudou).length) {
    const origem = estado.contrato?.origem ?? {};
    const em = deps.agora().toISOString();
    const registro: Correcao[] = (Object.keys(mudou) as CampoContrato[]).map((campo) => ({
      campo,
      origem: origem[campo] === "extrato" ? "extrato" : "cliente",
      anterior: dados[campo] ?? null,
      novo: mudou[campo],
      em,
      aplicada: origem[campo] !== "extrato",
    }));
    const correcoes = [...(estado.contrato?.correcoes ?? []), ...registro];
    const doExtrato = registro.filter((r) => !r.aplicada);
    const aplicar = Object.fromEntries(registro.filter((r) => r.aplicada).map((r) => [r.campo, r.novo])) as DadosContrato;
    const junto = { ...dados, ...aplicar };
    if (doExtrato.length) {
      const desc = doExtrato.map((r) => `${r.campo}: ${String(r.anterior)} para ${String(r.novo)}`).join("; ");
      return transferir(
        { ...estado, contrato: { ...estado.contrato!, dados: junto, correcoes } },
        `cliente quer mudar dado lido do extrato (${desc}): validar antes de digitar`,
        TEXTOS.dadoExtratoEquipe,
        "dado_extrato_divergente",
        [],
        "dados_contrato",
      );
    }
    return ir(estado, "confirmacao", [`${TEXTOS.dadosCorrigidos} ${TEXTOS.confirmaDados(resumoDados(junto, true))}`], "dados_corrigidos", [], {
      contrato: { ...estado.contrato, dados: junto, pergunta: TEXTOS.perguntaConfirmacao, correcoes, correcaoPendente: undefined },
    });
  }
  const tentativas = estado.tentativas + 1;
  if (tentativas > MAX_TENTATIVAS) {
    return transferir(estado, "cliente quer corrigir os dados", TEXTOS.corrigirDados, "corrigir_dados", [], "dados_contrato");
  }
  // Guarda o que o cliente disse: um "sim" depois disto não confirma os dados antigos.
  const pedido = (entrada.texto ?? (entrada.documento ? "(foto de documento)" : "")).trim().slice(0, 160);
  const contrato = estado.contrato ? { ...estado.contrato, correcaoPendente: pedido || estado.contrato.correcaoPendente } : estado.contrato;
  return { estado: { ...estado, tentativas, contrato }, respostas: [TEXTOS.qualCorrigir], efeitos: [], rotulo: "pede_correcao" };
}

const MAX_SOCIAIS = 4;

// Etapas em que mensagem social recebe resposta curta e a pergunta de novo.
const ETAPAS_SOCIAIS: Etapa[] = ["cpf", "nome", "nascimento", "extrato", "numero_contrato", "coleta", "confirmacao"];

function retomaDaEtapa(estado: EstadoMaisa): string {
  if (estado.etapa === "coleta") return estado.contrato?.pergunta ?? TEXTOS.continuarCadastro;
  if (estado.etapa === "confirmacao") return TEXTOS.perguntaConfirmacao;
  if (estado.etapa === "numero_contrato") {
    const banco = estado.alternativa?.digitacao?.banco;
    return banco ? TEXTOS.retomaNumero(banco) : TEXTOS.numeroContratoInvalido;
  }
  if (estado.etapa === "extrato") return RETOMA_ETAPA.extrato!;
  return RETOMA_ETAPA[estado.etapa] ?? PERGUNTA_DA_ETAPA[estado.etapa];
}

// "Na verdade sou do INSS", "me enganei, sou siape": só entre INSS e SIAPE (mesmo caminho de
// extrato), ou para CLT enquanto ainda pede o CPF.
async function trocaDeProduto(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<{ estado: EstadoMaisa; aviso: string; efeito: Efeito } | null> {
  const t = normalizar(texto);
  if (!/(na verdade|na real|me enganei|errei|alias|eu sou|\bsou (do|da|de)\b)/.test(t)) return null;
  const c = await deps.classificador.convenio(texto.replace(/\d/g, " "));
  const pode = c === "inss" || c === "siape" || (c === "clt" && estado.etapa === "cpf");
  if (!c || !pode || c === estado.produto) return null;
  return { estado: { ...estado, produto: c, tentativas: 0 }, aviso: `Certo, então é ${{ inss: "INSS", siape: "SIAPE", clt: "CLT" }[c as "inss" | "siape" | "clt"]}.`, efeito: { tipo: "convenio", convenio: c } };
}

const FOLLOWUP_MS = 10 * 60_000;
const CARRINHO_MS = 24 * 60 * 60_000;

// Oferta sem resposta. 10 minutos: uma mensagem só, para retomar. 24 horas: sai da
// Maisa e entra no Carrinho, para alguém da equipe ligar. O relógio conta a partir da
// última mensagem do cliente, ou da oferta se ele não escreveu nada depois.
// Oferta de portabilidade: o mesmo, com MAISA_FOLLOWUP_PORT ligado. Conversa de antes
// desta versão, sem a hora da oferta, começa a contar agora (o contexto fica igual).
function verificarOferta(estado: EstadoMaisa, agora: Date, followupPort = false): Passo {
  const parado: Passo = { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
  const port = estado.etapa === "oferta_port";
  if (port && !followupPort) return parado;
  if (estado.etapa !== "oferta" && !port) return parado;
  if (!estado.ofertaEm) {
    return port ? { estado: { ...estado, ofertaEm: agora.toISOString(), followupEnviado: false }, respostas: [], efeitos: [], rotulo: "relogio_oferta_iniciado" } : parado;
  }
  const desde = Math.max(new Date(estado.ofertaEm).getTime(), estado.ultimoContatoCliente ? new Date(estado.ultimoContatoCliente).getTime() : 0);
  const passou = agora.getTime() - desde;
  if (passou >= CARRINHO_MS) {
    return transferir(estado, port ? "não respondeu a oferta de portabilidade em 24 horas" : "não respondeu a oferta em 24 horas", null, "carrinho", [], "carrinho");
  }
  if (passou >= FOLLOWUP_MS && !estado.followupEnviado) {
    return { estado: { ...estado, followupEnviado: true }, respostas: [port ? TEXTOS.followupOfertaPort : TEXTOS.followupOferta], efeitos: [], rotulo: "followup_oferta" };
  }
  return parado;
}

export async function avancar(atual: EstadoMaisa | null, entrada: Entrada, deps: Dependencias): Promise<Passo> {
  let estado: EstadoMaisa = atual ?? { etapa: "inicio", tentativas: 0 };
  if (estado.etapa === "finalizada") return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };

  // Checagens automáticas do relógio.
  if ("evento" in entrada) {
    if (entrada.evento === "verificar_oferta") return verificarOferta(estado, deps.agora(), deps.followupPort === true);
    if (entrada.evento === "executar_digitacao") return executarDigitacao(estado, deps);
    if (estado.etapa !== "aguardando") return { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
    return consultarAgora(estado, deps, "verificacao_automatica", false);
  }

  // O cliente falou durante a oferta: o relógio do follow-up recomeça daqui.
  if (estado.etapa === "oferta" || estado.etapa === "oferta_port") estado = { ...estado, ultimoContatoCliente: deps.agora().toISOString() };

  // "sim" agendado e chegou outra mensagem. "obrigado", "ok" e emoji positivo mantêm o
  // agendamento. Qualquer outra coisa (correção, dúvida, arquivo, "espera") cancela e é
  // tratada como resposta à confirmação: a digitação só volta com um novo "sim".
  if (estado.confirmacaoPendente) {
    const s = entrada.texto && !entrada.temMidia ? mensagemSocial(entrada.texto) : null;
    // Neutra ("obrigado", 👍) ou outro "sim" puro: mantém o agendamento, sem repetir a resposta.
    const neutra = Boolean(entrada.texto) && !entrada.temMidia && !invalidaConfirmacao({ conteudoTexto: entrada.texto, tipoMidia: null });
    if (neutra) {
      const antes = s ? RESPOSTA_SOCIAL[s] : undefined;
      return { estado, respostas: antes ? [antes] : [], efeitos: [], rotulo: "confirmacao_mantida" };
    }
    estado = { ...estado, confirmacaoPendente: undefined };
  }

  // Na etapa do extrato, PDF ou foto é o que ela pediu. Fora dela, arquivo vai para a equipe.
  if (estado.etapa === "extrato" && entrada.documento) return etapaExtrato(estado, entrada, deps);
  // Extrato antes da hora (INSS ou SIAPE, ainda no CPF, nome ou data): guarda e pede o que falta.
  if (entrada.documento && entrada.documentoId && porExtrato(estado.produto) && ["cpf", "nome", "nascimento"].includes(estado.etapa)) {
    return {
      estado: { ...estado, extratoPendenteId: entrada.documentoId },
      respostas: [TEXTOS.extratoGuardado, PERGUNTA_DA_ETAPA[estado.etapa]],
      efeitos: [],
      rotulo: "extrato_antecipado",
    };
  }
  if (estado.etapa === "coleta" && entrada.documento) return etapaColeta(estado, entrada, deps);
  // Foto do documento na confirmação: é a correção de algum dado.
  if (estado.etapa === "confirmacao" && entrada.documento) return corrigirDados(estado, entrada, deps);
  // Arquivo antes de saber o vínculo: costuma ser o extrato. Guarda e pergunta o vínculo.
  if (entrada.documento && entrada.documentoId && (estado.etapa === "inicio" || estado.etapa === "convenio")) {
    const respostas = estado.etapa === "inicio" ? [`${TEXTOS.apresentacao} ${TEXTOS.arquivoNoInicio}`, TEXTOS.perguntaConvenio] : [TEXTOS.arquivoNoInicio];
    return ir(estado, "convenio", respostas, "arquivo_no_inicio", [], { extratoPendenteId: entrada.documentoId });
  }
  // Extrato de novo depois da oferta: a simulação já foi feita com ele.
  if (entrada.documento && (estado.etapa === "oferta" || estado.etapa === "oferta_port")) {
    return { estado, respostas: [TEXTOS.extratoRepetido, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "extrato_repetido" };
  }
  if (entrada.temMidia) return transferir(estado, "cliente enviou arquivo", TEXTOS.midiaRecebida, "midia");

  const texto = entrada.texto?.trim() ?? "";
  if (!texto) return { estado, respostas: [], efeitos: [], rotulo: "vazia" };

  // Pedir uma pessoa vale em qualquer etapa.
  if (await deps.classificador.pedeHumano(texto)) {
    return transferir(estado, "pediu atendente", TEXTOS.transferindo, "humano");
  }

  // Pedido de instruções internas ou credenciais: resposta padrão e volta à pergunta da
  // etapa, sem explicar a regra. O rótulo fica no registro da Maisa como auditoria.
  if (await deps.classificador.tentativaExtracao(texto)) {
    const pergunta = PERGUNTA_DA_ETAPA[estado.etapa];
    return { estado, respostas: pergunta ? [TEXTOS.seguranca, pergunta] : [TEXTOS.seguranca], efeitos: [], rotulo: "tentativa_extracao" };
  }

  // Cumprimento, agradecimento, "ok", emoji, riso, desculpa pela demora: responde curto e
  // retoma a pergunta, sem contar como erro. A oferta tem o seu próprio tratamento.
  const social = ETAPAS_SOCIAIS.includes(estado.etapa) ? mensagemSocial(texto) : null;
  if (social && !(estado.etapa === "confirmacao" && (social === "confirmacao_curta" || social === "emoji"))) {
    const retoma = retomaDaEtapa(estado);
    const antes = RESPOSTA_SOCIAL[social];
    const respostas = social === "confuso" ? [PERGUNTA_DA_ETAPA[estado.etapa] || retoma] : antes ? [antes, retoma] : [retoma];
    // Não conta como erro, mas também não pode girar para sempre: na quinta seguida, a equipe.
    const sociais = (estado.sociais ?? 0) + 1;
    if (sociais > MAX_SOCIAIS) return transferir(estado, `muitas mensagens sem responder à etapa ${NOME_ETAPA[estado.etapa]}`, TEXTOS.transferindo, "sociais", [], "nao_entendeu");
    return { estado: { ...estado, sociais }, respostas, efeitos: [], rotulo: `social_${social}` };
  }

  // "Na verdade sou do INSS": troca o produto antes de seguir.
  if (estado.etapa === "cpf" || estado.etapa === "nascimento" || estado.etapa === "extrato") {
    const troca = await trocaDeProduto(estado, texto, deps);
    if (troca) {
      let p: Passo | null = null;
      if (troca.estado.etapa === "cpf" && extrairCpf(texto)) p = await etapaCpf(troca.estado, texto, deps);
      else if (troca.estado.etapa === "nascimento" && lerDataNascimento(texto, deps.agora())) p = await etapaNascimento(troca.estado, texto, deps);
      if (p) return { ...p, respostas: [troca.aviso, ...p.respostas], efeitos: [troca.efeito, ...p.efeitos] };
      const pergunta = troca.estado.etapa === "extrato" ? TEXTOS.pedeExtrato(produtoExtrato(troca.estado)) : PERGUNTA_DA_ETAPA[troca.estado.etapa];
      return { estado: troca.estado, respostas: [troca.aviso, pergunta], efeitos: [troca.efeito], rotulo: "troca_produto" };
    }
  }

  switch (estado.etapa) {
    case "inicio":
      return etapaInicio(estado, texto, deps);
    case "convenio":
      return etapaConvenio(estado, texto, deps);
    case "cpf":
      return etapaCpf(estado, texto, deps);
    case "nome":
      return etapaNome(estado, texto);
    case "consentimento":
      return etapaConsentimento(estado, texto, deps);
    case "aguardando":
      return etapaAguardando(estado, texto, deps);
    case "nascimento":
      return etapaNascimento(estado, texto, deps);
    case "extrato":
      return etapaExtrato(estado, { texto }, deps);
    case "oferta":
      return etapaOferta(estado, texto, deps);
    case "oferta_port":
      return etapaOfertaPort(estado, texto, deps);
    case "numero_contrato":
      return etapaNumeroContrato(estado, texto);
    case "coleta":
      return etapaColeta(estado, { texto }, deps);
    case "confirmacao":
      return etapaConfirmacao(estado, texto, deps, entrada.mensagemId);
    case "finalizada":
      return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };
  }
}
