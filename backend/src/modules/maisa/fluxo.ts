import type { Convenio } from "@prisma/client";
import type { Classificador, ConvenioEntendido, LeituraOferta } from "./classificador.js";
import type { DigitacaoPort, ReducaoParcela, TabelaDigitacao, ResultadoAutorizacao, ResultadoBanco, ResultadoConsulta, ResultadoExtrato } from "./bancos.js";
import { cpfComTamanhoErrado, cpfValido, extrairCpf, normalizarCpf, trechoDoCpf } from "./cpf.js";
import { buscarFaq } from "./faq.js";
import { PRODUTOS_COM_SIMULACAO, ROTULO_CONVENIO, TEXTOS, formatarReais } from "./textos.js";
import { sexoPeloNome } from "./sexoPeloNome.js";
import { grupoPendente } from "./contrato.js";
import { leituraCurta } from "./conversa/leituraCurta.js";
import { lerEndereco, temAlgo } from "./endereco.js";
import { VINCULOS_SEM_CONSIGNADO } from "../extratos/leitor.js";
import { PERGUNTA_SEXO, ROTULO_CAMPO, camposFaltando, proximaPergunta, resumoDados, todosCampos, type CampoContrato, type DadosContrato, type ProdutoContrato } from "./contrato.js";
import type { ResultadoContratacao } from "./facta.js";
import { NAO_QUERO, SIM_FORTE, normalizar, temReceio } from "./classificador.js";
import { cltDigitavel, motivoTravaDigitacao } from "./travaDigitacao.js";
import type { Pendencia } from "./conversa/contexto.js";
import type { SaidaMotor } from "./conversa/motor.js";
import type { MemoriaConversa, RegistroInterpretacao } from "./conversa/tipos.js";
import type { OpcaoOferta, VinculoClt } from "./bancos.js";
import { invalidaConfirmacao, mensagemRelevante, perguntaSobreAndamento, type AssuntoAndamento } from "./ordemMensagens.js";
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
  dataInexistente,
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
  extratosPendentes?: string[];
  // REDE: a digitação falhou e espera alguém olhar o erro. Enquanto isso, nada é refeito.
  digitacaoErro?: { tipo: string; etapa: string; mensagem: string; em: string };
  redeAvisoEm?: string;
  vinculoSiape?: string; // vínculo lido no contracheque do SIAPE
  extratoSiapePendente?: ResultadoExtrato; // simulação feita com o extrato, esperando o contracheque // todos os arquivos que chegaram antes da hora (até 3)
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
  lembreteEnviado?: boolean; // lembrete único quando o cliente some no meio dos dados
  // Proposta digitada: lembrete único de assinatura, 10 min depois do link, se o cliente não falou.
  lembreteAssinaturaEm?: string;
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
    // CLT: o vínculo da Dataprev simulado (matrícula, nascimento, admissão, CNPJ do empregador).
    clt?: VinculoClt;
    // Tabelas da Facta mostradas ao cliente. Com mais de uma, ele escolhe pelo número, e a
    // escolhida vira os campos acima (é a que vai ser digitada).
    opcoes?: OpcaoOferta[];
    escolhida?: number;
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
  contrato?: { dados: DadosContrato; pergunta: string; origem?: Partial<Record<CampoContrato, "extrato" | "anterior">>; correcoes?: Correcao[]; correcaoPendente?: string };
  // Cadastro validado de um atendimento anterior, guardado quando a conversa passa para a equipe.
  // Reaproveitado por poucos dias, sempre com nova confirmação do cliente. Não guarda autorização
  // nenhuma (PIX, aceite, confirmação): essas são pedidas de novo.
  contratoSalvo?: ContratoSalvo;
  // Memória conversacional (fase 7): perguntas já feitas, orientações dadas, sinais do cliente.
  memoria?: MemoriaConversa;
  // Convênio marcado na conversa por uma pessoa (no disparo ou na etiqueta). A primeira
  // resposta do cliente segue direto para ele, sem perguntar o vínculo de novo.
  convenioMarcado?: { convenio: Convenio; em: string };
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
  | { texto: string | null; temMidia: boolean; documento?: boolean; documentoId?: string; mensagemId?: string; viaAudio?: boolean }
  | { evento: "verificar_autorizacao" | "verificar_oferta" | "executar_digitacao" | "verificar_silencio" };
type EntradaTexto = Exclude<Entrada, { evento: string }>;

// Camada conversacional (fase 7). Ausente ou desligada: tudo funciona como antes.
export interface ConversaDeps {
  etapas: ReadonlySet<string>;
  decidir(p: { estado: EstadoMaisa; texto: string; pendencia: Pendencia; viaAudio: boolean; agora: Date }): Promise<SaidaMotor>;
  // A Maisa de hoje não entendeu a resposta: devolve uma reformulação com outra abordagem, ou null.
  reformular?(p: { estado: EstadoMaisa; texto: string; pendencia: Pendencia; agora: Date; memoria: MemoriaConversa }): Promise<{ respostas: string[]; memoria: MemoriaConversa; rotulo: string; registro: RegistroInterpretacao } | null>;
  // Lê um arquivo que o cliente mandou no lugar do número do contrato.
  lerContratoDeArquivo?(documentoId?: string): Promise<{ legivel: boolean; numero: string | null; banco: string | null } | null>;
}

// Dias em que o cadastro de um atendimento anterior vale. Ajustado pelo serviço, de env.
// cadastroAtivo: o reaproveitamento de cadastro é um comportamento da fase 7 e só vale com
// MAISA_CONVERSA_MODO=ativo. Desligado ou em sombra, o fluxo é o de antes da fase 7.
// siapeOutrosBancos: SIAPE com tabela aberta na Facta vai para a equipe tentar outro banco
// (comissão da Facta baixa). Ligado pelo MAISA_SIAPE_OUTROS_BANCOS.
export interface InfoSiape { documento: string | null; vinculo: string | null; renda?: number | null }

// A simulação veio do extrato (sem renda) e o contracheque tem o bruto: o cadastro não pergunta.
function comRendaDoContracheque<T extends ResultadoExtrato>(r: T, renda: number | null | undefined): T {
  if (!renda || renda <= 0) return r;
  if ((r.tipo === "alternativa" || r.tipo === "com_saldo") && !r.renda) return { ...r, renda };
  return r;
}

// SIAPE: resultado que leva a oferta ou à equipe precisa do vínculo do contracheque antes.
const precisaVinculo = (r: ResultadoExtrato) => r.tipo === "com_saldo" || (r.tipo === "alternativa" && r.simulada) || (r.tipo === "sem_saldo" && r.revisar === true);

export const configFluxo = { reaproveitaDias: 7, cadastroAtivo: false, confiancaMin: 0.6, siapeOutrosBancos: false };

export interface ContratoSalvo {
  dados: DadosContrato;
  origem?: Partial<Record<CampoContrato, "extrato" | "anterior">>;
  correcoes?: Correcao[];
  produto?: Produto;
  salvoEm: string;
}

export interface Correcao {
  campo: CampoContrato;
  origem: "extrato" | "cliente" | "anterior";
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

export interface PropostaRecente {
  banco: string;
  status: "digitada" | "em_analise" | "aprovada" | "paga" | "recusada" | "cancelada";
  statusTexto: string;
  codigoAf: string | null;
  url: string | null;
  criadaEm: string;
}

export interface Dependencias {
  classificador: Classificador;
  agora(): Date;
  // Quem chama já sabe o CPF e o celular do cliente. O fluxo não precisa vê-los.
  solicitarAutorizacao(nome: string): Promise<ResultadoAutorizacao>;
  consultar(): Promise<ResultadoConsulta>;
  statusProposta(): Promise<{ banco: string; status: string } | null>;
  // Lê o extrato que acabou de chegar e simula com a margem dele.
  // documentoId: extrato que o cliente mandou antes da hora. Sem ele, o da mensagem atual.
  simularPorExtrato(produto: ProdutoExtrato, dataNascimento: string, documentoId?: string): Promise<ResultadoExtrato & { siape?: InfoSiape }>;
  // SIAPE: lê só o documento (sem banco) para saber se é contracheque e qual o vínculo.
  lerVinculoSiape?(documentoId?: string): Promise<InfoSiape>;
  // Digitação na Facta (INSS e SIAPE). Desligada, o "sim" vai para a equipe.
  digitacaoAtiva: boolean;
  extrairDados(pergunta: string, entrada: { texto: string | null; documento?: boolean }, faltando: CampoContrato[]): Promise<DadosContrato>;
  // CEP do endereço do cadastro. Sem ela, o endereço em pedaços segue pela leitura do modelo.
  consultarCep?(cep: string): Promise<{ cep: string; cidade: string; cidadeNome: string; estado: string; endereco?: string; bairro?: string } | null>;
  // Idempotente: quem chama garante uma digitação por oferta (chave única no banco).
  // alternativa: a condição conferida agora (pode ter troco diferente da oferta).
  digitar(dados: DadosContrato, alternativa?: EstadoMaisa["alternativa"]): Promise<ResultadoDigitacao>;
  // Proposta já feita para este cliente (qualquer conversa). Com ela, a Maisa nunca manda o menu.
  propostaRecente?(): Promise<PropostaRecente | null>;
  // Trava própria da digitação automática (MAISA_DIGITACAO_LIBERADA). Desligada por padrão.
  digitacaoLiberada?: boolean;
  // Espera depois do "sim" da confirmação antes de digitar. Ausente: 30 segundos.
  janelaConfirmacaoMs?: number;
  // Há mensagem do cliente que chegou e ainda não foi lida? Ausente: não há.
  // O cliente mandou mensagem relevante depois do "sim" (pelo horário do WhatsApp, ou
  // recebida depois dele)? Ausente: não mandou.
  mensagemDepoisDoSim?(simMensagemId: string | undefined, recebidoEm: string): Promise<boolean>;
  // Port + refin: simula de novo com as mesmas tabelas logo antes de digitar.
  revalidarPort?(d: DigitacaoPort): Promise<{ port: DigitacaoPort["port"]; refin?: DigitacaoPort["refin"] } | { erro: string }>;
  // Lembrete e Carrinho também na oferta de portabilidade.
  followupPort?: boolean;
  // MAISA_DIGITA_CLT: digitação automática do CLT. Desligada, o aceite do CLT vai para a equipe.
  digitaClt?: boolean;
  // MAISA_DIGITA_PORT_PURA: port sem refin do SIAPE. Desligada, vai para a equipe.
  digitaPortPura?: boolean;
  conversa?: ConversaDeps;
  // Responde ao que o cliente disse fora do esperado (ex.: "estou negativo"), só com fatos
  // aprovados. null: não tem o que dizer. Ausente nos testes: valem as regras.
  // ficha: o que já se sabe do cliente (oferta, contratos, proposta). Os valores dela podem ser citados.
  responderLivre?(texto: string, etapa: string, produto: string | undefined, pergunta: string, ficha?: string): Promise<string | null>;
}

export type Efeito =
  | { tipo: "convenio"; convenio: Convenio }
  | { tipo: "cpf"; cpf: string }
  | { tipo: "simulacao"; convenio: Produto; resultado: ResultadoBanco }
  // nota: o que a Maisa fez, para o operador ler na conversa.
  | { tipo: "transferir"; motivo: string; nota?: string }
  // Não há o que fazer: a conversa fecha sem passar para a equipe.
  | { tipo: "encerrar"; motivo: string }
  | { tipo: "proposta"; codigoAf: string }
  // REDE: a digitação não passou. Não vai para a equipe: vira nota e alerta no log, o cliente
  // ouve que o contrato está sendo digitado e a conversa fica parada com a Maisa.
  | { tipo: "rede"; nota: string };

export interface Passo {
  estado: EstadoMaisa;
  respostas: string[];
  efeitos: Efeito[];
  // O que ela entendeu da mensagem. Vai para o registro, nunca o texto do cliente.
  rotulo: string;
  // Registro da interpretação conversacional (fase 7), gravado sem o texto do cliente.
  interpretacao?: RegistroInterpretacao;
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

// Cadastro com ao menos um dado validado vira ContratoSalvo. Sem cadastro novo, mantém o que já havia.
function guardarCadastro(estado: EstadoMaisa): ContratoSalvo | undefined {
  if (!configFluxo.cadastroAtivo) return undefined;
  const c = estado.contrato;
  if (!c || !Object.keys(c.dados).length) return estado.contratoSalvo;
  return { dados: c.dados, origem: c.origem, correcoes: c.correcoes, produto: estado.produto, salvoEm: new Date().toISOString() };
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
    // O cadastro sai do estado ativo. Uma cópia estruturada fica por poucos dias, para a conversa
    // devolvida à Maisa não recomeçar do zero. Notas livres da equipe não são fonte de dado.
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined, contratoSalvo: guardarCadastro(estado) },
    respostas: resposta ? [resposta] : [],
    efeitos: [...efeitos, { tipo: "transferir", motivo, nota: notaEquipe({ ...estado, saida }, motivo, efeitos) }],
    rotulo,
  };
}

const r$ = (reais: number) => formatarReais(Math.round(reais * 100));

// Resposta curta sobre o contrato que está sendo feito, com os números da oferta aceita.
function respostaAndamento(estado: EstadoMaisa, assunto: AssuntoAndamento): string {
  const a = estado.alternativa;
  const valor = a?.trocoCentavos ?? estado.oferta?.valorCentavos ?? null;
  const parcela = a?.digitacao?.refin?.parcela ?? (estado.oferta?.parcelaCentavos != null ? estado.oferta.parcelaCentavos / 100 : null);
  if (assunto === "valor" && valor) return `O valor que cai na sua conta é ${formatarReais(valor)}.`;
  if (assunto === "parcela" && parcela) return `A parcela fica em ${r$(parcela)} por mês.`;
  if (assunto === "link") return "O link para assinar chega aqui no WhatsApp assim que o contrato ficar pronto.";
  return a ? TEXTOS.prazoPortabilidade : TEXTOS.prazoNovo;
}

// Nota para o operador ao passar a conversa: o que a Maisa fez, onde simulou e o que
// voltou. Fica na conversa, só para a equipe. Os dados do cadastro saem resumidos.
export function notaEquipe(estado: EstadoMaisa, motivo: string, efeitos: Efeito[] = []): string {
  const linhas = [`Passei para a equipe: ${motivo}.`];
  const produto = estado.produto ? estado.produto.toUpperCase() : "não definido";
  linhas.push(`Produto: ${produto}. Parei na etapa: ${NOME_ETAPA[estado.etapa]}.`);
  if (estado.vinculoSiape) linhas.push(`Vínculo no contracheque: ${estado.vinculoSiape.replace(/_/g, " ")}.`);

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
    // SIAPE que foi para outro banco: nada foi ofertado ao cliente. A nota não pode dizer que foi.
    const ofertou = estado.saida !== "siape_outros_bancos";
    if (!ofertou) linhas.push("NADA FOI OFERTADO AO CLIENTE: a Facta abriu tabela, mas pela regra do SIAPE a equipe tenta outro banco. Os números abaixo são só referência da Facta.");
    if (a.trocoCentavos) linhas.push(`${ofertou ? "Troco ofertado" : "Melhor troco na Facta (referência)"}: até ${formatarReais(a.trocoCentavos)}.`);
    if (a.numeroContrato) linhas.push(`Número do contrato informado pelo cliente: ${a.numeroContrato}.`);
    if (a.digitacao) linhas.push(`${ofertou ? "Contrato que ela ofertou" : "Melhor contrato na Facta (referência)"}: ${a.digitacao.banco}, parcela ${r$(a.digitacao.parcela)}.`);
    // Tudo o que a Facta abriu, contrato por contrato, para a equipe digitar no portal.
    if (a.simulacoes?.length) {
      linhas.push("", "SIMULAÇÕES NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.");
      a.simulacoes.forEach((s, i) => linhas.push(...blocoSimulacao(s, i + 1, a.numeroContrato, a.digitacao, ofertou)));
    }
  }
  // Conversa antiga, sem a lista: só o contrato ofertado e as reduções.
  if (a && !a.simulacoes?.length) {
    if (a.digitacao) linhas.push("", "SIMULAÇÃO NA FACTA (SIAPE, averbador 15, operação 003500). Saldo estimado: confirmar na CIP.", ...blocoSimulacao(a.digitacao, 1, a.numeroContrato, a.digitacao, estado.saida !== "siape_outros_bancos"));
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
function blocoSimulacao(s: DigitacaoPort, n: number, numeroCliente?: string, ofertado?: DigitacaoPort, ofertou = true): string[] {
  const foiOfertado = ofertado && ofertado.banco === s.banco && ofertado.parcela === s.parcela;
  const numero = s.numeroContrato || (foiOfertado ? numeroCliente : undefined);
  const economia = s.parcela - s.port.parcela;
  return [
    `${n}) ${s.banco}${s.bancoCodigo ? `, código ${s.bancoCodigo}` : ", código do banco não identificado"}` +
      `${numero ? `, contrato nº ${numero}` : ", nº do contrato: pegar na BRB"}${foiOfertado ? (ofertou ? "  [OFERTADO]" : "  [MELHOR NA FACTA]") : ""}`,
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
    estado: { ...estado, etapa: "finalizada", tentativas: 0, motivoTransferencia: motivo, paradaEm: estado.etapa, saida, contrato: undefined, contratoSalvo: guardarCadastro(estado) },
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

// O que já se sabe do cliente, em linhas que o modelo pode citar. Os valores daqui saíram
// da simulação na Facta (tabela do banco): podem ser ditos ao cliente como estão.
export function fichaCliente(estado: EstadoMaisa): string {
  const l: string[] = [];
  if (estado.produto) l.push(`Produto: ${estado.produto.toUpperCase()}.`);
  l.push(`Etapa do atendimento: ${NOME_ETAPA[estado.etapa] ?? estado.etapa}.`);
  const o = estado.oferta;
  if (o) l.push(`Oferta simulada no banco ${o.banco}: até ${formatarReais(o.valorCentavos)}${o.prazoMeses ? ` em ${o.prazoMeses}x` : ""}${o.parcelaCentavos ? ` de ${formatarReais(o.parcelaCentavos)}` : ""}.`);
  const a = estado.alternativa;
  const d = a?.digitacao;
  const numero = a?.numeroContrato ?? d?.numeroContrato ?? null;
  if (a && d) {
    l.push(`Oferta de portabilidade para o banco Facta: contrato do ${d.banco}${numero ? ` nº ${numero}` : ""}, parcela hoje ${r$(d.parcela)}, faltam ${d.prazoRestante} de ${d.prazoOriginal} parcelas.`);
    if (d.refin) l.push(`Com o refinanciamento na Facta: ${d.refin.prazo} parcelas de ${r$(d.refin.parcela)}, e cai na conta do cliente ${a.trocoCentavos ? formatarReais(a.trocoCentavos) : "um valor a confirmar"} (troco). Taxa ${pct(d.refin.taxa ?? 0)} no refinanciamento${d.port.taxa ? ` e ${pct(d.port.taxa)} na portabilidade` : ""}.`);
    else l.push(`Só portabilidade, sem dinheiro extra: parcela na Facta ${r$(d.port.parcela)}.`);
  }
  for (const s of (a?.simulacoes ?? []).filter((x) => x.numeroContrato !== numero).slice(0, 4)) {
    l.push(`Outro contrato simulado: ${s.banco}${s.numeroContrato ? ` nº ${s.numeroContrato}` : ""}, parcela hoje ${r$(s.parcela)}: ${s.refin?.liquido ? `a simulação mostrou troco de ${r$(s.refin.liquido)} com refinanciamento${s.digitavel ? "; se o cliente pedir este contrato, a oferta pode ser trocada por ele" : ", mas para seguir com ele a equipe confere antes"}` : "a Facta não abriu tabela com troco para ele"}.`);
  }
  return l.join("\n");
}

// Resposta livre com a ficha do cliente. null: o modelo não tinha fato para responder.
async function respostaLivre(estado: EstadoMaisa, texto: string, deps: Dependencias, pergunta: string): Promise<string | null> {
  if (!deps.responderLivre || !texto.trim()) return null;
  try {
    return await deps.responderLivre(texto, NOME_ETAPA[estado.etapa] ?? estado.etapa, estado.produto, pergunta, fichaCliente(estado));
  } catch (err) {
    console.error("Resposta livre falhou:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Reação a um balão (emoji em cima da mensagem): não é resposta, em nenhuma etapa.
const REACAO = /^\[Mensagem do tipo "reaction"/;

// Cliente que já tem proposta e voltou a falar com a conversa no início: nunca o menu.
// Mensagem neutra (ok, obrigada, emoji): silêncio. Pergunta do andamento: o status e o link.
// Qualquer outra coisa: a equipe que acompanha a proposta.
async function posProposta(estado: EstadoMaisa, texto: string, p: PropostaRecente, deps: Dependencias): Promise<Passo> {
  // Sem emoji e pontuação, sobra só "ok", "obrigada", "beleza"...: não pede resposta.
  const limpo = normalizar(texto.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, "")).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const neutra = !limpo || /^(ok|okay|oks|blz|beleza|certo|ta bom|ta|entendi|entendido|combinado|obrigad[oa]|muito obrigad[oa]|obg|valeu|vlw|show|perfeito|otimo|joia|amem|deus abencoe|ok obrigad[oa]|ok ok)$/.test(limpo);
  if (neutra || !mensagemRelevante({ conteudoTexto: texto, tipoMidia: null })) return { estado, respostas: [], efeitos: [], rotulo: "pos_proposta_silencio" };
  const andamento = perguntaSobreAndamento(texto) !== null || (await deps.classificador.intencao(texto)) === "acompanhar_proposta";
  if (andamento) {
    const resposta = p.status === "digitada" && p.url
      ? `A sua proposta no banco ${p.banco} já está feita e espera a sua assinatura. É só abrir o link, conferir e assinar: ${p.url}\n\nDepois que você assinar, o banco segue com a liberação e a gente te avisa por aqui.`
      : TEXTOS.statusProposta(p.banco, p.statusTexto);
    return { estado, respostas: [resposta], efeitos: [], rotulo: "pos_proposta_status" };
  }
  return transferir(estado, `cliente com proposta ${p.codigoAf ?? ""} no ${p.banco} (${p.statusTexto}) mandou: "${texto.slice(0, 160)}"`, TEXTOS.posPropostaEquipe, "pos_proposta");
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
      const resposta = await deps.responderLivre(texto, NOME_ETAPA[estado.etapa], estado.produto, pergunta, fichaCliente(estado));
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
  // SIAPE que passou na Facta: não oferta. A equipe tenta outro banco com mais comissão.
  if (configFluxo.siapeOutrosBancos && estado.produto === "siape" && resultado.tipo === "com_saldo") {
    return transferir(estado, `SIAPE passou na Facta (até ${formatarReais(resultado.valorCentavos)}): tentar outro banco, comissão da Facta baixa`, TEXTOS.siapeOutrosBancos, "siape_outros_bancos", [efeito], "siape_outros_bancos");
  }
  if (resultado.tipo === "sem_saldo") {
    // "extrato" = a margem já acabou no extrato, nem chegou a consultar o banco.
    const doExtrato = resultado.banco === "extrato";
    // Leitura com dúvida: pode ser erro de leitura, a equipe confere.
    if (resultado.revisar) {
      return transferir(estado, `sem margem, leitura com dúvida: ${resultado.motivo}`, TEXTOS.semMargemExtrato, "sem_saldo", [efeito], "revisar_extrato");
    }
    // CLT sem saldo na Facta: um atendente procura outras opções de bancos.
    if (estado.produto === "clt") {
      return transferir(estado, `CLT sem saldo na Facta (${resultado.motivo}): ver outras opções de bancos`, TEXTOS.semSaldoCltEquipe, "sem_saldo", [efeito], "sem_saldo_outros_bancos");
    }
    // Sem margem e sem port ou refin: não há o que fazer. Encerra sem atendente.
    return encerrar(estado, `sem saldo: ${resultado.motivo}`, doExtrato ? TEXTOS.semMargemFim : TEXTOS.semSaldoFim, "sem_saldo", [efeito]);
  }
  if (resultado.tipo === "erro") {
    return transferir(estado, `erro no banco: ${resultado.motivo}`, TEXTOS.erroBanco, "erro_banco", [efeito]);
  }
  const { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario, clt } = resultado;
  const opcoes = resultado.opcoes && resultado.opcoes.length > 1 ? resultado.opcoes : undefined;
  const desconto = DESCONTO[estado.produto ?? "clt"];
  const mensagem = opcoes
    ? TEXTOS.ofertaOpcoes(opcoes.map((o) => ({ valor: formatarReais(o.valorCentavos), prazo: o.prazoMeses, parcela: formatarReais(o.parcelaCentavos), taxa: o.taxa })), desconto)
    : TEXTOS.oferta(formatarReais(valorCentavos), prazoMeses, formatarReais(parcelaCentavos), desconto);
  return ir(estado, "oferta", [mensagem], "com_saldo", [efeito], {
    oferta: { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie, matricula, contaSalario, ...(clt ? { clt } : {}), ...(opcoes ? { opcoes } : {}) },
    autorizacaoPedidaEm: undefined,
    proximaVerificacao: undefined,
    ofertaEm: agora.toISOString(),
    ultimoContatoCliente: undefined,
    followupEnviado: false,
  });
}

async function etapaInicio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  // Convênio já marcado na conversa: "não" encerra com educação, o resto segue para ele.
  // CLT, INSS e SIAPE ela atende. Os outros convênios vão para a equipe, como sempre.
  if (estado.convenioMarcado && !estado.produto) {
    const t = normalizar(texto);
    if (NAO_QUERO.test(t) || /^(nao|n|pare|parar|sair|stop|remover|descadastrar)\b/.test(t)) {
      return encerrar(estado, "não quis seguir depois do contato", TEXTOS.disparoSemInteresse, "disparo_sem_interesse");
    }
    const c = estado.convenioMarcado.convenio;
    const intro = c === "clt" || c === "inss" || c === "siape" ? [TEXTOS.disparoContinua[c]] : [];
    return decidirEContinuar(estado, c, texto, deps, intro);
  }
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
    if (faq) return ir(estado, "convenio", [faq, TEXTOS.saudacao], intencao);
    const livre = await respostaLivre(estado, texto, deps, TEXTOS.saudacao);
    if (livre) return ir(estado, "convenio", [livre, TEXTOS.saudacao], "resposta_livre");
    return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, intencao);
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
  // Normalização determinística: pontuação, espaços e traços não fazem um CPF válido ser recusado.
  const lido = normalizarCpf(texto);
  if (lido.tipo === "tamanho_errado") return tentarDeNovo(estado, TEXTOS.cpfTamanho(lido.digitos), "cpf_tamanho_errado");
  const cpf = lido.tipo === "ausente" ? null : lido.cpf;
  if (cpf) {
    if (!cpfValido(cpf)) return tentarDeNovo(estado, TEXTOS.cpfInvalido, "cpf_invalido");
    if (porExtrato(estado.produto)) {
      // "CPF 15/03/1958": a data veio junto, segue direto para o extrato. O trecho do CPF sai antes.
      const trecho = trechoDoCpf(texto);
      const data = lerDataNascimento(trecho ? texto.replace(trecho, " ") : texto, deps.agora());
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
// Perfil do cadastro: CLT tem o seu (PIX, sem espécie nem conta salário). Os outros, o do extrato.
const produtoCadastro = (estado: EstadoMaisa): ProdutoContrato => (estado.produto === "clt" ? "clt" : produtoExtrato(estado));


// Ano impossível com cara de erro de digitação (1852 no lugar de 1952): a data que
// provavelmente era. null se não der para adivinhar com segurança.
export function sugerirDataNascimento(texto: string, agora: Date): string | null {
  const m = texto.match(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})\b/);
  if (!m) return null;
  // "12/25/1966": mês maior que 12 com dia até 12 é o formato americano. Pergunta se é 25/12.
  if (Number(m[2]) > 12 && Number(m[1]) <= 12) return lerDataNascimento(`${m[2]}/${m[1]}/${m[3]}`, agora);
  if (m[3].startsWith("19")) return null;
  return lerDataNascimento(`${m[1]}/${m[2]}/19${m[3].slice(2)}`, agora);
}

// Arquivos guardados antes da hora, do mais antigo ao mais novo (até 3).
const pendentes = (e: EstadoMaisa): string[] => e.extratosPendentes ?? (e.extratoPendenteId ? [e.extratoPendenteId] : []);
const guardarPendente = (e: EstadoMaisa, id: string): string[] => [...pendentes(e).filter((x) => x !== id), id].slice(-3);

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

// Com a data em mãos: se o extrato já chegou antes, lê e simula agora; senão, pede o extrato.
async function seguirParaExtrato(estado: EstadoMaisa, data: string, deps: Dependencias): Promise<Passo> {
  const pronto: EstadoMaisa = { ...estado, etapa: "extrato", tentativas: 0, dataNascimento: data, dataSugerida: undefined, extratoPendenteId: undefined, extratosPendentes: undefined };
  const ids = pendentes(estado);
  if (ids.length) return etapaExtrato(pronto, { texto: null, documento: true }, deps, ids);
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
  if (sugerida) {
    // Mês maior que 12 ("12/25/1966"): dia e mês vieram trocados. Senão, foi o ano.
    const trocada = /\b\d{1,2}\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]/.exec(texto);
    const texto_ = trocada && Number(trocada[1]) > 12 ? TEXTOS.confirmaDataTrocada(dataBr(sugerida)) : TEXTOS.confirmaData(dataBr(sugerida));
    return ir(estado, "nascimento", [texto_], "nascimento_sugerido", [], { dataSugerida: sugerida });
  }
  // "31/02/1966": diz qual data não existe, em vez de "não entendi".
  const inexistente = dataInexistente(texto);
  if (inexistente) return tentarDeNovo(estado, TEXTOS.dataInexistente(inexistente), "data_inexistente");
  // Sem número nenhum, é conversa: responde antes de pedir a data de novo.
  if (!/\d/.test(texto)) return ouvirCliente(estado, texto, deps);
  return tentarDeNovo(estado, TEXTOS.nascimentoInvalido, "nascimento_invalido");
}

// Chegou um PDF ou foto: lê como extrato e simula. Texto: explica como tirar o extrato.
async function etapaExtrato(
  estado: EstadoMaisa,
  entrada: { texto: string | null; documento?: boolean },
  deps: Dependencias,
  documentoIds?: string | string[],
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
  // Vários arquivos antes da hora: lê do mais novo ao mais antigo e fica com a primeira
  // leitura conclusiva. Inválido, erro ou margem zerada com dúvida: tenta o próximo.
  const ids = documentoIds === undefined ? [undefined] : Array.isArray(documentoIds) ? [...documentoIds].reverse() : [documentoIds];
  const peso = (r: ResultadoExtrato) => (r.tipo === "extrato_invalido" ? 0 : r.tipo === "erro" ? 1 : r.tipo === "sem_saldo" && r.revisar ? 2 : 3);
  let resultado: (ResultadoExtrato & { siape?: InfoSiape }) | null = null;
  let idUsado: string | undefined;

  // SIAPE com a simulação do extrato guardada: este arquivo deve ser o contracheque.
  if (estado.extratoSiapePendente && deps.lerVinculoSiape) {
    const info = await deps.lerVinculoSiape(ids[0]).catch(() => null);
    if (!info || info.documento !== "contracheque") return tentarDeNovo(estado, TEXTOS.naoEhContracheque, "contracheque_invalido", "sem_extrato");
    const vinculo = info.vinculo ?? "nao_informado";
    if (VINCULOS_SEM_CONSIGNADO.has(vinculo)) {
      return transferir({ ...estado, vinculoSiape: vinculo, extratoSiapePendente: undefined }, `vínculo lido no contracheque: ${vinculo.replace(/_/g, " ")}. Conferir no contracheque: se for mesmo esse vínculo, não há consignado; se a leitura errou, seguir o atendimento`, TEXTOS.vinculoConferir, "vinculo_siape", [], "vinculo_siape");
    }
    resultado = comRendaDoContracheque(estado.extratoSiapePendente, info.renda);
    estado = { ...estado, vinculoSiape: vinculo, extratoSiapePendente: undefined };
  }

  for (const id of resultado ? [] : ids) {
    let r: ResultadoExtrato;
    try {
      r = await deps.simularPorExtrato(produtoExtrato(estado), estado.dataNascimento ?? "", id);
    } catch (err) {
      r = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na leitura do extrato" };
    }
    if (!resultado || peso(r) > peso(resultado)) {
      resultado = r;
      idUsado = id;
    }
    if (peso(r) === 3) break;
  }
  if (!resultado) resultado = { tipo: "erro", banco: "desconhecido", motivo: "nenhum arquivo para ler" };

  // SIAPE: antes de ofertar ou passar para a equipe, confere o vínculo no contracheque.
  if (estado.produto === "siape" && deps.lerVinculoSiape && !estado.vinculoSiape && precisaVinculo(resultado)) {
    const doDoc = resultado.siape;
    let vinculo: string | undefined = doDoc?.documento === "contracheque" ? doDoc.vinculo ?? "nao_informado" : undefined;
    // Outro arquivo que já chegou pode ser o contracheque.
    for (const id of ids) {
      if (vinculo || id === idUsado || id === undefined) continue;
      const info = await deps.lerVinculoSiape(id).catch(() => null);
      if (info?.documento === "contracheque") {
        vinculo = info.vinculo ?? "nao_informado";
        resultado = comRendaDoContracheque(resultado, info.renda);
      }
    }
    if (vinculo && VINCULOS_SEM_CONSIGNADO.has(vinculo)) {
      return transferir({ ...estado, vinculoSiape: vinculo }, `vínculo lido no contracheque: ${vinculo.replace(/_/g, " ")}. Conferir no contracheque: se for mesmo esse vínculo, não há consignado; se a leitura errou, seguir o atendimento`, TEXTOS.vinculoConferir, "vinculo_siape", [], "vinculo_siape");
    }
    if (!vinculo) {
      const { siape: _s, ...guardado } = resultado;
      return { estado: { ...estado, extratoSiapePendente: guardado as ResultadoExtrato, tentativas: 0 }, respostas: [TEXTOS.pedeContracheque], efeitos: [], rotulo: "pede_contracheque" };
    }
    estado = { ...estado, vinculoSiape: vinculo };
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
    // Port pura (sem refin): não é ofertada nem vai para a equipe. Encerra o atendimento.
    // Só a port com refin é ofertada.
    if (operacao === "portabilidade") {
      const comAlternativa: EstadoMaisa = { ...estado, alternativa: { operacao, trocoCentavos, motivo, ...(digitacao ? { digitacao } : {}), ...(reducoes?.length ? { reducoes } : {}), ...lidos } };
      return encerrar(comAlternativa, `sem margem para novo; ${motivo}; port pura não é ofertada`, TEXTOS.semMargemFim, "port_pura", [], "port_pura");
    }
    // SIAPE com port + refin aberta na Facta: a equipe tenta outro banco.
    if (configFluxo.siapeOutrosBancos && estado.produto === "siape") {
      const comAlternativa: EstadoMaisa = { ...estado, alternativa: { operacao, trocoCentavos, motivo, ...(digitacao ? { digitacao } : {}), ...(reducoes?.length ? { reducoes } : {}), ...lidos } };
      return transferir(comAlternativa, `SIAPE passou na Facta (${motivo}): tentar outro banco, comissão da Facta baixa`, TEXTOS.siapeOutrosBancos, "siape_outros_bancos", [], "siape_outros_bancos");
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
        return iniciarColetaPort(comAlternativa, digitacao.numeroContrato, "retoma_contrato", [TEXTOS.retomaSemNumero(ganho)], deps.agora());
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
            estado.produto,
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
  // "Não quero mexer no Sicredi, só no BRB", "e o do BRB, dá pra fazer?": o pedido do cliente
  // entra na oferta. Contrato simulado com troco que a Facta digita: a oferta passa a ser ele.
  const pedido = contratosPedidos(texto, estado);
  if (pedido) return ofertarContratoPedido(estado, pedido, deps);
  return tratarOferta(estado, texto, deps);
}

type ContratoPedido = { nomes: string[]; simulados: DigitacaoPort[] };

// Como o cliente chama o banco e como ele aparece no extrato.
const APELIDOS_BANCO: [RegExp, RegExp][] = [
  [/\bsicredi\b/, /sicredi/], [/\b(caixa|cef)\b/, /\b(cef|caixa)\b/], [/\b(bb|banco do brasil)\b/, /\b(bb|brasil)\b/], [/\bqi\b/, /\bqi\b/],
  [/\bbrb\b/, /\bbrb\b/], [/\bc6\b/, /\bc6\b/], [/\bpan\b/, /\bpan\b/], [/\bbmg\b/, /\bbmg\b/], [/\bitau\b/, /\bitau\b/], [/\bbradesco\b/, /bradesco/],
  [/\bsantander\b/, /santander/], [/\bdaycoval\b/, /daycoval/], [/\bsafra\b/, /safra/], [/\binter(medium)?\b/, /\binter/], [/\bsicoob\b/, /sicoob/],
  [/\bbanrisul\b/, /banrisul/], [/\bmercantil\b/, /mercantil/], [/\bagibank\b/, /agibank/], [/\bole\b/, /\bole\b/], [/\bdigio\b/, /digio/], [/\balfa\b/, /\balfa\b/],
  [/\bparana\b/, /parana/],
];
const PERGUNTA_CONTRATO = /\b(da pra|consegue|pode|tem como|e o|e a|e os|e as|fazer|faz|portar|trazer)\b/;

// Contratos que o cliente pede, diferentes do ofertado. null: não pediu outro contrato.
export function contratosPedidos(texto: string, estado: EstadoMaisa): ContratoPedido | null {
  const t = normalizar(texto);
  if (!PEDE_OUTRO.test(t) && !(t.includes("?") && PERGUNTA_CONTRATO.test(t))) return null;
  const ofertado = estado.alternativa?.digitacao;
  const numeroOfertado = estado.alternativa?.numeroContrato ?? ofertado?.numeroContrato ?? null;
  const sims = (estado.alternativa?.simulacoes ?? []).filter((s) => !(numeroOfertado && s.numeroContrato === numeroOfertado));
  const nomes: string[] = [];
  const simulados: DigitacaoPort[] = [];
  // "Não quero mexer no Sicredi, só no BRB": vale o que vem depois de "só"; banco negado sai.
  const marcas = [...t.matchAll(/\b(so|somente|apenas)\b/g)];
  const so = marcas.length ? t.slice(marcas.at(-1)!.index) : t;
  const negado = (re: RegExp) => new RegExp(`\\bnao\\s+(\\w+\\s+){0,3}${re.source}`).test(t) && !re.test(so === t ? "" : so);
  for (const [doCliente, doExtrato] of APELIDOS_BANCO) {
    if (!doCliente.test(so) || negado(doCliente)) continue;
    if (ofertado && doExtrato.test(normalizar(ofertado.banco))) continue; // é o próprio ofertado ("não quero mexer no Sicredi")
    const achados = sims.filter((s) => doExtrato.test(normalizar(s.banco)));
    // Nome como está no extrato; sem contrato simulado, como o cliente escreveu.
    nomes.push(achados[0]?.banco ?? t.match(doCliente)![0].toUpperCase());
    simulados.push(...achados.filter((s) => !simulados.includes(s)));
  }
  return nomes.length ? { nomes, simulados } : null;
}

async function ofertarContratoPedido(estado: EstadoMaisa, p: ContratoPedido, deps: Dependencias): Promise<Passo> {
  const comTroco = p.simulados.filter((s) => (s.refin?.liquido ?? 0) > 0);
  const digitaveis = comTroco.filter((s) => s.digitavel === true).sort((a, b) => (b.refin!.liquido ?? 0) - (a.refin!.liquido ?? 0));
  const avisos = p.simulados.filter((s) => !(s.refin?.liquido ?? 0)).map((s) => TEXTOS.contratoSemTroco(s.banco));
  const naoSimulados = p.nomes.filter((n) => !p.simulados.some((s) => s.banco === n));
  const escolhido = digitaveis[0];
  if (escolhido) {
    const troco = Math.round((escolhido.refin!.liquido ?? 0) * 100);
    const alternativa = { ...estado.alternativa!, operacao: "port_refin" as const, trocoCentavos: troco, digitacao: escolhido, numeroContrato: escolhido.numeroContrato ?? undefined,
      motivo: `cliente pediu o contrato do ${escolhido.banco}: port + refin ${escolhido.refin!.nome ?? ""}, troco ${escolhido.refin!.liquido}` };
    return ir(estado, "oferta_port", [...avisos, TEXTOS.trocaContratoPort(escolhido.banco), TEXTOS.ofertaPort({ operacao: "port_refin", trocoCentavos: troco, digitacao: escolhido })], "contrato_pedido_ofertado", [], {
      alternativa, ofertaEm: deps.agora().toISOString(), followupEnviado: false,
    });
  }
  // Troco em contrato que a API não digita, ou contrato que não foi simulado: a equipe confere.
  const paraEquipe = [...comTroco.map((s) => `${s.banco}${s.numeroContrato ? ` nº ${s.numeroContrato}` : ""} (troco ${r$(s.refin!.liquido ?? 0)} na simulação, digitar no portal)`), ...naoSimulados.map((n) => `${n} (não simulado)`)];
  if (paraEquipe.length) {
    const nome = comTroco[0]?.banco ?? naoSimulados[0];
    return transferir(estado, `pediu para portar outro contrato: ${paraEquipe.join("; ")}`, comTroco.length ? TEXTOS.outroContratoPort(nome) : TEXTOS.contratoNaoSimulado(nome), "outro_contrato", [], "objecao");
  }
  // Só contrato sem troco: explica e mantém a oferta de agora.
  const atual = estado.alternativa?.digitacao?.banco;
  const pergunta = atual ? `Quer seguir com o contrato do ${atual}, como te mostrei? É só me responder SIM.` : PERGUNTA_DA_ETAPA[estado.etapa];
  return { estado, respostas: [...avisos, pergunta], efeitos: [], rotulo: "contrato_pedido_sem_troco" };
}

// Bancos como o cliente escreve, e como a Maisa repete.
const BANCOS_CITADOS: [RegExp, string][] = [
  [/\bbrb\b/, "BRB"], [/\b(bb|banco do brasil)\b/, "Banco do Brasil"], [/\b(caixa|cef)\b/, "Caixa"], [/\bbradesco\b/, "Bradesco"],
  [/\bitau\b/, "Itaú"], [/\bsantander\b/, "Santander"], [/\bsicredi\b/, "Sicredi"], [/\bsicoob\b/, "Sicoob"], [/\bbanco inter\b|\binter\b/, "Inter"],
  [/\bpan\b/, "PAN"], [/\bbmg\b/, "BMG"], [/\bdaycoval\b/, "Daycoval"], [/\bsafra\b/, "Safra"], [/\bc6\b/, "C6"], [/\bbanrisul\b/, "Banrisul"],
  [/\bmercantil\b/, "Mercantil"], [/\bagibank\b/, "Agibank"], [/\bole\b/, "Olé"], [/\bdigio\b/, "Digio"], [/\bnossacoop\b/, "Nossacoop"],
];
const PEDE_OUTRO = /\b(so|somente|apenas|quero|prefiro|queria|gostaria|trazer|portar|mexer|outro contrato|o outro)\b/;

// O cliente cita um banco que não é o do contrato ofertado, pedindo para mexer nele: devolve o nome.
export function outroContratoPedido(texto: string, bancoOfertado?: string): string | null {
  const t = normalizar(texto);
  if (!PEDE_OUTRO.test(t) || t.includes("?")) return null;
  const ofertado = normalizar(bancoOfertado ?? "");
  for (const [re, nome] of BANCOS_CITADOS) {
    if (!re.test(t)) continue;
    const chave = normalizar(nome).split(" ")[0].slice(0, 4);
    if (ofertado && (ofertado.includes(chave) || re.test(ofertado))) continue; // é o próprio ofertado
    return nome;
  }
  return null;
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

  // Várias opções da Facta: o número escolhe. "sim" sem número pergunta qual.
  const opcoes = !port && estado.oferta?.opcoes && estado.oferta.opcoes.length > 1 && !estado.oferta.escolhida ? estado.oferta.opcoes : null;
  if (opcoes) {
    const n = escolhaDeOpcao(texto, opcoes.length);
    if (n) {
      const o = opcoes[n - 1];
      const escolhido: EstadoMaisa = {
        ...estado,
        oferta: { ...estado.oferta!, valorCentavos: o.valorCentavos, parcelaCentavos: o.parcelaCentavos, prazoMeses: o.prazoMeses, tabela: o.tabela, escolhida: n },
      };
      return seguirComAceite(escolhido, deps, texto, [TEXTOS.opcaoEscolhida(n, formatarReais(o.valorCentavos), o.prazoMeses, formatarReais(o.parcelaCentavos))]);
    }
  }

  if (PEDE_EXPLICACAO.test(t)) return duvida([explicarOferta(estado), pergunta], "explicacao_oferta");

  const social = mensagemSocial(texto);
  if (social) {
    if (pediuConfirmacao && socialPositivo(social, texto)) return opcoes ? fica([TEXTOS.qualOpcao(opcoes.length)], "qual_opcao") : seguirComAceite(estado, deps, texto);
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
    if (opcoes) return fica([...antes, TEXTOS.qualOpcao(opcoes.length)], "qual_opcao");
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
    // Responde com o que a simulação mostrou (banco, contrato, valores) e repete a pergunta da oferta.
    const livre = await respostaLivre(estado, texto, deps, PERGUNTA_DA_ETAPA[estado.etapa]);
    if (livre) return { estado, respostas: [livre, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "oferta_duvida_respondida" };
    return transferir(estado, `dúvida sem resposta pronta na oferta: ${texto.slice(0, 120)}`, TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
  }
  return duvida([TEXTOS.naoSeiSeEntendi], "oferta_nao_entendida");
}

// "2", "opção 2", "quero a 2", "a segunda": o número da opção escolhida. null: não escolheu.
const ORDINAIS = ["primeira", "segunda", "terceira", "quarta", "quinta"];
const VERBO_ESCOLHA = "(?:(?:quero|prefiro|escolho|vou de|fico com|pode ser)\\s+)?";
export function escolhaDeOpcao(texto: string, total: number): number | null {
  const t = normalizar(texto).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const num = t.match(new RegExp(`^${VERBO_ESCOLHA}(?:(?:a|o)\\s+)?(?:opcao\\s*|numero\\s*)?(\\d)(?:\\s+(?:por favor|pfv|pf))?$`));
  const ord = ORDINAIS.findIndex((o) => new RegExp(`^${VERBO_ESCOLHA}(?:a\\s+)?${o}(?:\\s+opcao)?$`).test(t));
  const n = num ? Number(num[1]) : ord >= 0 ? ord + 1 : null;
  return n && n >= 1 && n <= total ? n : null;
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
      if (numero) return iniciarColetaPort(limpo, numero, "aceitou_port", [...antes, TEXTOS.inicioContrato], deps.agora());
      return ir(limpo, "numero_contrato", [...antes, TEXTOS.pedeNumeroContrato(dig.banco, formatarReais(Math.round(dig.parcela * 100)), limpo.produto)], "aceitou_port");
    }
    return transferir(limpo, `aceitou: ${estado.alternativa?.motivo ?? "portabilidade"}`, TEXTOS.aceitouPort, "aceitou_port", [], "alternativa");
  }
  // CLT com a digitação do CLT ligada e o vínculo completo: ela mesma faz o contrato. Renda,
  // matrícula e sexo vêm da Dataprev. Sem a trava ou sem o vínculo, vai para a equipe.
  if (estado.produto === "clt" && deps.digitacaoAtiva && deps.digitaClt && estado.oferta?.tabela && cltDigitavel(estado.oferta.clt)) {
    const v = estado.oferta.clt!;
    const dados: DadosContrato = {};
    if (v.renda) dados.renda = v.renda;
    if (v.matricula) dados.matricula = v.matricula;
    if (v.sexo) dados.sexo = v.sexo;
    return iniciarCadastro(limpo, dados, "aceitou_contrato", [...antes, TEXTOS.inicioContrato], deps.agora(), { ofertaEm: undefined, followupEnviado: undefined });
  }
  // INSS e SIAPE com a digitação ligada: ela mesma faz o contrato.
  if (porExtrato(estado.produto) && deps.digitacaoAtiva && estado.oferta?.tabela) {
    const dados: DadosContrato = {};
    if (estado.oferta.renda) dados.renda = estado.oferta.renda;
    if (estado.oferta.matricula) dados.matricula = estado.oferta.matricula;
    if (estado.produto === "siape" && estado.oferta.contaSalario) Object.assign(dados, estado.oferta.contaSalario);
    if (estado.produto === "inss" && estado.oferta.especie) dados.tipoBeneficio = String(estado.oferta.especie);
    return iniciarCadastro(limpo, dados, "aceitou_contrato", [...antes, TEXTOS.inicioContrato], deps.agora(), { ofertaEm: undefined, followupEnviado: undefined });
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
      // Não quer esticar: a port sem refin não é ofertada pela Maisa. A equipe conversa.
      return transferir(estado, `${motivo}; quer port sem refin, a equipe avalia`, TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
    case "oferta_melhor":
      if (l.outraOferta) return transferir(estado, motivo, TEXTOS.ofertaMelhorEquipe, "objecao", [], "objecao");
      return fica([TEXTOS.perguntaOutraOferta]);
  }
  return transferir(estado, motivo, l.tipo === "recusa" ? TEXTOS.recusaValor : TEXTOS.duvidaParaEquipe, "objecao", [], "objecao");
}

// Número do contrato no banco de origem: a Facta precisa dele para comprar a dívida.
// confirmarAntes (camada conversacional ligada): número vindo de áudio ou de arquivo nunca vale
// sem o "sim" explícito do cliente, porque o número compra um contrato do cliente.
async function etapaNumeroContrato(estado: EstadoMaisa, texto: string, deps: Dependencias, viaAudio = false): Promise<Passo> {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const confirmarAntes = Boolean(deps.conversa?.etapas.has("numero_contrato"));
  const prop = estado.memoria?.contratoProposto;
  if (prop) {
    const sim = (SIM_FORTE.test(t) || /^(sim+|s|isso|isso mesmo|esse mesmo|correto|certo|exato|ta certo|pode ser esse)\b/.test(t)) && !NAO_QUERO.test(t) && !texto.includes("?");
    const semProposta = { ...estado, memoria: { ...estado.memoria!, contratoProposto: undefined } };
    if (sim) return iniciarColetaPort(semProposta, prop.numero, "numero_contrato_confirmado", [TEXTOS.inicioContrato], deps.agora());
    estado = semProposta; // "não", outro número ou outra coisa: descarta a proposta e segue com a mensagem
  }
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
    // Mandou o CPF: explica que o pedido é o número do contrato e não avança.
    if (trouxeCpfNoLugarDoContrato(texto)) return tentarDeNovo(estado, TEXTOS.cpfNoLugarDoContrato(banco || "do banco"), "cpf_no_lugar_do_contrato", "alternativa");
    return tentarDeNovo(estado, TEXTOS.numeroContratoInvalido, "numero_contrato_invalido", "alternativa");
  }
  if (viaAudio && confirmarAntes) {
    const memoria = { ...(estado.memoria ?? emMemoriaVazia()), contratoProposto: { numero, banco: null, origem: "audio" as const, em: deps.agora().toISOString() } };
    return { estado: { ...estado, memoria, tentativas: 0 }, respostas: [TEXTOS.contratoDoAudio(numero)], efeitos: [], rotulo: "contrato_do_audio_confirmar" };
  }
  return iniciarColetaPort(estado, numero, "numero_contrato", [TEXTOS.inicioContrato], deps.agora());
}

const emMemoriaVazia = (): MemoriaConversa => ({ perguntas: {}, orientacoes: [], irritacoes: 0, reclamacoesRepeticao: 0, baixaConfianca: 0, falhasModelo: 0, ajudasSemProgresso: 0 });

// Arquivo no lugar do número: lê, valida e PEDE CONFIRMAÇÃO antes de aceitar. null: não deu para
// tratar e o arquivo segue o caminho de sempre (equipe).
async function etapaContratoPorArquivo(estado: EstadoMaisa, documentoId: string | undefined, deps: Dependencias): Promise<Passo | null> {
  const lido = await deps.conversa!.lerContratoDeArquivo!(documentoId).catch(() => null);
  if (!lido) return null;
  const banco = estado.alternativa?.digitacao?.banco ?? "o banco do contrato";
  const numero = lido.legivel && lido.numero ? extrairNumeroContrato(lido.numero) : null;
  if (numero) {
    const outro = lido.banco ? outroBancoCitado(normalizar(lido.banco), estado.alternativa?.digitacao?.banco ?? "") : null;
    if (outro) return tentarDeNovo(estado, TEXTOS.contratoArquivoOutroBanco(lido.banco ?? outro, banco), "contrato_arquivo_outro_banco", "alternativa");
    const memoria = { ...(estado.memoria ?? emMemoriaVazia()), contratoProposto: { numero, banco: lido.banco, origem: "arquivo" as const, em: deps.agora().toISOString() } };
    return { estado: { ...estado, memoria, tentativas: 0 }, respostas: [TEXTOS.contratoDoArquivo(numero, lido.banco)], efeitos: [], rotulo: "contrato_do_arquivo_confirmar" };
  }
  return tentarDeNovo(estado, estado.produto === "siape" ? TEXTOS.arquivoSemContratoSiape(banco) : TEXTOS.arquivoSemContrato(banco), "arquivo_sem_contrato", "alternativa");
}

// Começa o cadastro da port com o número do contrato em mãos. Renda, matrícula e conta
// salário já lidas do extrato entram preenchidas: ela não pergunta de novo.
function iniciarColetaPort(estado: EstadoMaisa, numero: string, rotulo: string, antes: string[], agora: Date = new Date()): Passo {
  const dados: DadosContrato = {};
  if (estado.alternativa?.renda) dados.renda = estado.alternativa.renda;
  if (estado.alternativa?.matricula) dados.matricula = estado.alternativa.matricula;
  if (estado.produto === "siape" && estado.alternativa?.contaSalario) Object.assign(dados, estado.alternativa.contaSalario);
  return iniciarCadastro({ ...estado, alternativa: { ...estado.alternativa!, numeroContrato: numero } }, dados, rotulo, antes, agora);
}

// Cadastro de um atendimento anterior, se ainda vale: mesmo produto e dentro do prazo.
function cadastroAnterior(estado: EstadoMaisa, agora: Date): ContratoSalvo | null {
  const s = estado.contratoSalvo;
  if (!configFluxo.cadastroAtivo || !s || configFluxo.reaproveitaDias <= 0) return null;
  if (s.produto && s.produto !== estado.produto) return null;
  const idadeMs = agora.getTime() - new Date(s.salvoEm).getTime();
  if (idadeMs > configFluxo.reaproveitaDias * 24 * 60 * 60_000) return null;
  return s;
}

// O ponto único de entrada do cadastro. dadosBase: o que veio do extrato (vale mais que o
// anterior). Dado de atendimento anterior entra marcado como "anterior", sem PIX nem qualquer
// autorização: o cliente confirma o cadastro inteiro de novo.
// Sexo claro pelo primeiro nome: não pergunta. O cliente confere no resumo.
function comSexoDoNome(d: DadosContrato): DadosContrato {
  if (d.sexo || !d.nome) return d;
  const s = sexoPeloNome(d.nome);
  return s ? { ...d, sexo: s } : d;
}

function iniciarCadastro(estado: EstadoMaisa, dadosBase: DadosContrato, rotulo: string, antes: string[], agora: Date, extra: Partial<EstadoMaisa> = {}): Passo {
  const produto = produtoCadastro(estado);
  const anterior = cadastroAnterior(estado, agora);
  const reaproveitados = anterior ? Object.fromEntries(Object.entries(anterior.dados).filter(([k, v]) => k !== "pixCpf" && v !== undefined && v !== null && v !== "" && !(k in dadosBase))) as DadosContrato : {};
  const dados: DadosContrato = comSexoDoNome({ ...reaproveitados, ...dadosBase });
  const origem: Partial<Record<CampoContrato, "extrato" | "anterior">> = {
    ...Object.fromEntries(Object.keys(reaproveitados).map((k) => [k, "anterior"])),
    ...origemExtrato(dadosBase),
  };
  const contrato = { dados, origem, correcoes: anterior?.correcoes };
  if (anterior && Object.keys(reaproveitados).length) {
    if (!camposFaltando(dados, produto).length) {
      // Tudo já tinha: vai direto para a confirmação, que é pedida de novo.
      return ir(estado, "confirmacao", [...antes, TEXTOS.cadastroAnterior, TEXTOS.confirmaDados(resumoDados(dados, true))], `${rotulo}_cadastro_anterior`, [], {
        ...extra,
        contrato: { ...contrato, pergunta: TEXTOS.perguntaConfirmacao },
      });
    }
    const pergunta = proximaPergunta(dados, produto)!;
    return ir(estado, "coleta", [...antes, TEXTOS.cadastroParcial, pergunta], `${rotulo}_cadastro_parcial`, [], { ...extra, contrato: { ...contrato, pergunta } });
  }
  const pergunta = proximaPergunta(dados, produto)!;
  return ir(estado, "coleta", [...antes, pergunta], rotulo, [], { ...extra, contrato: { dados, pergunta, origem: origemExtrato(dados) } });
}

// Campos lidos do extrato no início do cadastro: renda, matrícula, conta salário e espécie.
const CAMPOS_DO_EXTRATO: CampoContrato[] = ["renda", "matricula", "bancoConta", "agencia", "conta", "tipoBeneficio"];
function origemExtrato(dados: DadosContrato): Partial<Record<CampoContrato, "extrato">> {
  return Object.fromEntries(CAMPOS_DO_EXTRATO.filter((c) => dados[c] !== undefined && dados[c] !== null && dados[c] !== "").map((c) => [c, "extrato"]));
}

// Trechos que podem ser número de contrato: 5 a 30 caracteres com pelo menos 4 dígitos.
const trechosDeNumero = (texto: string) =>
  (texto.match(/[0-9A-Za-z.\-/]+/g) ?? [])
    .map((x) => x.replace(/[^0-9A-Za-z]/g, ""))
    .filter((x) => x.length >= 5 && x.length <= 30 && (x.match(/\d/g) ?? []).length >= 4);

// 11 dígitos com dígitos verificadores de CPF válidos: é CPF, não número de contrato.
const ehCpf = (x: string) => /^\d{11}$/.test(x) && cpfValido(x);

// O número do contrato: o maior trecho com pelo menos 4 dígitos ("Hoje 20250464573").
// Um CPF válido nunca vale como contrato. 11 dígitos que não fecham como CPF seguem como antes.
export function extrairNumeroContrato(texto: string): string | null {
  return trechosDeNumero(texto).filter((x) => !ehCpf(x)).sort((a, b) => b.length - a.length)[0] ?? null;
}

// A mensagem trouxe um CPF válido no lugar do número do contrato?
export const trouxeCpfNoLugarDoContrato = (texto: string) => trechosDeNumero(texto).some(ehCpf);

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
const ROTULO_ENDERECO: Record<string, string> = { cep: "CEP", numero: "número", complemento: "complemento" };
// Correção de endereço fora da pergunta do endereço precisa dizer do que fala.
const FALA_DE_ENDERECO = /\b(cep|numero|n[º°]|casa|endereco|apto|apartamento|bloco|complemento)\b/;

// A mensagem é endereço? Só com a pergunta do endereço na vez; depois dela, só uma correção que
// cite o endereço ou o complemento que faltou. Número solto pedindo o RG não vira número da casa.
function leituraDeEndereco(estado: EstadoMaisa, texto: string) {
  const dados = estado.contrato?.dados ?? {};
  const lido = lerEndereco(texto);
  if (!temAlgo(lido)) return null;
  const t = normalizar(texto);
  const naVez = grupoPendente(dados, produtoCadastro(estado)) === "endereco";
  const enderecoCompleto = Boolean(dados.cep && dados.numero);
  const correcao = enderecoCompleto && CORRECAO.test(t) && (FALA_DE_ENDERECO.test(t) || lido.cep !== undefined);
  const complementoDepois = enderecoCompleto && lido.cep === undefined && lido.numero === undefined && Boolean(lido.complemento) && !dados.complemento;
  return naVez || correcao || complementoDepois ? lido : null;
}

// Esperando o endereço (CEP ou número faltando), ou corrigindo um que já veio: lê CEP, número e
// complemento da mensagem, sem modelo. Acumula com o que já tinha, registra a correção e pergunta
// só o que falta. null: a mensagem não traz endereço, segue o caminho de sempre.
async function enderecoEmPedacos(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo | null> {
  if (!deps.consultarCep) return null;
  const produto = produtoCadastro(estado);
  const dados = estado.contrato?.dados ?? {};
  const faltaEndereco = !dados.cep || !dados.numero;
  const lido = leituraDeEndereco(estado, texto);
  if (!lido) return null;

  const novos: DadosContrato = {};
  const correcoes: Correcao[] = [];
  const repetidos: string[] = [];
  const agora = deps.agora().toISOString();
  const troca = (campo: "cep" | "numero" | "complemento", valor: string) => {
    const antes = dados[campo];
    if (antes !== undefined && antes !== "" && antes === valor) return repetidos.push(ROTULO_ENDERECO[campo]);
    if (antes !== undefined && antes !== "" && antes !== valor) correcoes.push({ campo, origem: "cliente", anterior: antes, novo: valor, em: agora, aplicada: true });
    novos[campo] = valor;
  };
  if (lido.cep !== undefined) {
    if (dados.cep !== lido.cep) {
      const achado = await deps.consultarCep(lido.cep).catch(() => null);
      if (!achado) return tentarDeNovo(estado, TEXTOS.cepNaoEncontrado, "cep_nao_encontrado", "dados_contrato");
      troca("cep", lido.cep);
      Object.assign(novos, { cidade: achado.cidade, cidadeNome: achado.cidadeNome, estado: achado.estado });
      // CEP novo: rua e bairro são do CEP novo (ou perguntados de novo, se o CEP for geral).
      novos.endereco = achado.endereco ?? "";
      novos.bairro = achado.bairro ?? "";
    } else repetidos.push("CEP");
  }
  if (lido.numero !== undefined) troca("numero", lido.numero);
  if (lido.complemento !== undefined) troca("complemento", lido.complemento);

  const junto = { ...dados, ...novos };
  const contrato = { ...estado.contrato!, dados: junto, correcoes: [...(estado.contrato?.correcoes ?? []), ...correcoes] };
  const proxima = proximaPergunta(junto, produto);
  const antes: string[] = [];
  if (correcoes.length) antes.push(TEXTOS.enderecoCorrigido(correcoes.map((c) => ROTULO_ENDERECO[c.campo]).join(" e ")));
  else if (repetidos.length && !Object.keys(novos).length) antes.push(TEXTOS.enderecoJaTenho(repetidos.join(" e ")));
  if (!proxima) {
    return ir(estado, "confirmacao", [...antes, TEXTOS.confirmaDados(resumoDados(junto, true))], "endereco_completo", [], {
      contrato: { ...contrato, pergunta: TEXTOS.perguntaConfirmacao },
    });
  }
  // Endereço acabou de ficar completo: diz que recebeu e segue para a próxima pergunta.
  const completou = Boolean(junto.cep && junto.numero) && faltaEndereco;
  if (completou && !antes.length) antes.push(TEXTOS.enderecoRecebido);
  else if (!antes.length) antes.push("Obrigada!");
  return { estado: { ...estado, contrato: { ...contrato, pergunta: proxima }, tentativas: 0 }, respostas: [`${antes.join(" ")} ${proxima}`], efeitos: [], rotulo: "endereco_em_pedacos" };
}

async function etapaColeta(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  const produto = produtoCadastro(estado);
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

  // Endereço em pedaços ("31320022", "Apto 102", "774"): junta o que chegou e pede só o que falta.
  const peloEndereco = !entrada.documento && texto ? await enderecoEmPedacos(estado, texto, deps) : null;
  if (peloEndereco) return peloEndereco;

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

  const junto = comSexoDoNome({ ...dados, ...novos });
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
        const r = deps.responderLivre ? await deps.responderLivre(texto, NOME_ETAPA.coleta, estado.produto, pergunta, fichaCliente(estado)) : null;
        if (r) return { estado: { ...estado, contrato: { ...estado.contrato, dados, pergunta }, tentativas: estado.tentativas + 1 }, respostas: [r, pergunta], efeitos: [], rotulo: "resposta_livre" };
      } catch (err) {
        console.error("Resposta livre falhou no cadastro:", err instanceof Error ? err.message : err);
      }
      return transferir(estado, `dúvida no cadastro: ${texto.slice(0, 120)}`, TEXTOS.duvidaParaEquipe, "duvida_cadastro", [], "dados_contrato");
    }
    const aviso = entrada.documento ? (pergunta === PERGUNTA_SEXO ? TEXTOS.fotoSemSexo : TEXTOS.fotoSemDado) : TEXTOS.naoEntendi;
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
  const portPuraDigitavel = estado.produto === "siape" && deps.digitaPortPura === true && Boolean(dig?.port);
  if (estado.alternativa && ((!dig?.refin && !portPuraDigitavel) || !dig?.bancoCodigo)) {
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
  let limpo: EstadoMaisa = { ...estado, confirmacaoPendente: undefined };
  // Mensagem relevante mandada depois do "sim": o "sim" não vale mais. A mensagem é (ou
  // já foi) lida e decide o que fazer; a digitação só volta com um "sim" novo.
  if (deps.mensagemDepoisDoSim && (await deps.mensagemDepoisDoSim(p.mensagemId, p.recebidoEm))) {
    return parado("digitacao_cancelada_mensagem_nova", limpo);
  }
  const trava = motivoTravaDigitacao(estado, { liberada: deps.digitacaoLiberada === true, clt: deps.digitaClt === true, portPura: deps.digitaPortPura === true });
  if (trava) {
    return transferir(limpo, `digitação automática não executada (${trava}): a equipe digita no portal com os dados da nota`, TEXTOS.digitacaoComEquipe, "digitacao_bloqueada", [], "dados_contrato");
  }

  // REDE: falha na digitação não vai para a equipe. O cliente ouve que o contrato está sendo
  // digitado, o erro vira nota e alerta, e a conversa fica parada até alguém olhar.
  const rede = (tipo: string, etapa: string, mensagem: string, aviso: string): Passo => ({
    estado: { ...limpo, digitacaoErro: { tipo, etapa, mensagem: mensagem.slice(0, 500), em: deps.agora().toISOString() }, redeAvisoEm: deps.agora().toISOString() },
    respostas: [TEXTOS.digitandoContrato],
    efeitos: [{ tipo: "rede", nota: `REDE: a digitação não passou (${tipo}). Etapa: ${etapa}. Erro da Facta: ${mensagem.slice(0, 500)}.\n${aviso}\nO cliente ouviu que o contrato está sendo digitado. A conversa continua com a Maisa, parada, sem refazer nada sozinha.` }],
    rotulo: `rede_${tipo}`,
  });

  // Port + refin: o coeficiente muda com o tempo. Confere a condição de agora antes de digitar.
  // Troco menor: não digita, mostra o valor novo e pede outro SIM. Troco igual ou maior: segue.
  const dig = estado.alternativa?.digitacao;
  if (estado.alternativa && dig?.refin && deps.revalidarPort) {
    let atual: Awaited<ReturnType<NonNullable<Dependencias["revalidarPort"]>>>;
    try {
      atual = await deps.revalidarPort(dig);
    } catch (err) {
      atual = { erro: err instanceof Error ? err.message : "falha na nova simulação" };
    }
    if ("erro" in atual) return rede("erro", "nova simulação antes de digitar", atual.erro, "A Facta não foi chamada para digitar: nenhuma proposta foi criada.");
    const antes = dig.refin.liquido ?? 0;
    const depois = atual.refin?.liquido ?? 0;
    const alternativa = { ...estado.alternativa, trocoCentavos: Math.round(depois * 100), digitacao: { ...dig, port: atual.port, refin: atual.refin } };
    if (depois + 0.01 < antes) {
      return {
        estado: { ...limpo, alternativa, ...(limpo.contrato ? { contrato: { ...limpo.contrato, pergunta: TEXTOS.perguntaConfirmacao } } : {}) },
        respostas: [TEXTOS.trocoMudou(r$(antes), r$(depois), r$(atual.refin?.parcela ?? dig.refin.parcela))],
        efeitos: [],
        rotulo: "troco_caiu",
      };
    }
    limpo = { ...limpo, alternativa };
  }

  let resultado: ResultadoDigitacao;
  try {
    resultado = await deps.digitar(estado.contrato?.dados ?? {}, limpo.alternativa);
  } catch (err) {
    // Exceção fora da Facta (banco de dados, código): sem saber se a Facta foi chamada,
    // trata como resultado desconhecido. Nunca como "pode tentar de novo".
    resultado = { tipo: "desconhecido", etapa: "sistema", mensagem: err instanceof Error ? err.message : "falha na digitação" };
  }
  if (resultado.tipo === "bloqueada" && (resultado.status === "concluida" || resultado.codigoAf)) {
    // Já existe proposta feita para esta oferta: não é erro, e "estou digitando" seria mentira.
    return transferir(
      limpo,
      `digitação NÃO feita: ${resultado.motivo}. Confira no portal Facta; para tentar de novo, a operação precisa ser liberada por alguém da equipe`,
      TEXTOS.digitacaoEmConferencia,
      "digitacao_bloqueada_cliente",
      [],
      "erro_digitacao",
    );
  }
  if (resultado.tipo === "bloqueada") {
    // A Facta não foi chamada. Nada antigo é apresentado como contrato novo.
    return rede("bloqueada", "reserva", resultado.motivo, "A Facta não foi chamada. Para tentar de novo, a operação precisa ser liberada.");
  }
  if (resultado.tipo === "abortada") {
    // O cliente mandou mensagem antes do ponto sem volta: nada foi criado. A mensagem dele
    // é lida em seguida.
    return parado("digitacao_abortada", limpo);
  }
  if (resultado.tipo === "desconhecido") {
    return rede("incerto", resultado.etapa, resultado.mensagem, "RESULTADO INCERTO: a proposta pode existir. Conferir no portal Facta antes de digitar de novo.");
  }
  if (resultado.tipo === "erro") {
    return rede("erro", resultado.etapa, resultado.mensagem, "Parou antes do cadastro da proposta: pela sequência da API, nenhuma proposta foi criada.");
  }
  const troco = limpo.alternativa?.trocoCentavos ?? null;
  return transferir(limpo, `proposta ${resultado.codigoAf} digitada na Facta`, TEXTOS.contratoEnviado(resultado.url, troco ? formatarReais(troco) : null), "contrato_enviado", [
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
      novos = await deps.extrairDados(TEXTOS.qualCorrigir, entrada, todosCampos(produtoCadastro(estado)));
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

// Cliente sumiu no meio dos dados: um lembrete só, 30 minutos depois da última mensagem
// dele. Depois de 22 horas não manda: a janela de 24h da Meta pode fechar.
const LEMBRETE_MS = 30 * 60_000;
const LEMBRETE_LIMITE_MS = 22 * 60 * 60_000;
const ETAPAS_LEMBRETE = new Set<Etapa>(["cpf", "nome", "nascimento", "extrato", "numero_contrato", "coleta"]);
export function verificarSilencio(estado: EstadoMaisa, agora: Date): Passo {
  const parado: Passo = { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
  if (!ETAPAS_LEMBRETE.has(estado.etapa) || estado.lembreteEnviado || !estado.ultimaMensagemEm) return parado;
  const passou = agora.getTime() - new Date(estado.ultimaMensagemEm).getTime();
  if (passou < LEMBRETE_MS || passou > LEMBRETE_LIMITE_MS) return parado;
  const pergunta = estado.etapa === "coleta" ? estado.contrato?.pergunta ?? PERGUNTA_DA_ETAPA.coleta : RETOMA_ETAPA[estado.etapa] ?? PERGUNTA_DA_ETAPA[estado.etapa];
  return { estado: { ...estado, lembreteEnviado: true }, respostas: [`${TEXTOS.lembreteSilencio} ${pergunta}`], efeitos: [], rotulo: "lembrete_silencio" };
}

export async function avancar(atual: EstadoMaisa | null, entrada: Entrada, deps: Dependencias): Promise<Passo> {
  let estado: EstadoMaisa = atual ?? { etapa: "inicio", tentativas: 0 };
  if (estado.etapa === "finalizada") return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };

  // Checagens automáticas do relógio.
  if ("evento" in entrada) {
    if (entrada.evento === "verificar_oferta") return verificarOferta(estado, deps.agora(), deps.followupPort === true);
    if (entrada.evento === "executar_digitacao") return executarDigitacao(estado, deps);
    if (entrada.evento === "verificar_silencio") return verificarSilencio(estado, deps.agora());
    if (estado.etapa !== "aguardando") return { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
    return consultarAgora(estado, deps, "verificacao_automatica", false);
  }

  // O cliente respondeu: um novo sumiço pode ganhar outro lembrete.
  if (estado.lembreteEnviado) estado = { ...estado, lembreteEnviado: undefined };
  if (!entrada.temMidia && entrada.texto && REACAO.test(entrada.texto)) return { estado, respostas: [], efeitos: [], rotulo: "reacao_ignorada" };
  if (estado.etapa === "inicio" && !estado.produto && !estado.convenioMarcado && deps.propostaRecente && !entrada.temMidia) {
    const p = await deps.propostaRecente().catch(() => null);
    if (p) return posProposta(estado, entrada.texto ?? "", p, deps);
  }
  // REDE: digitação com erro esperando alguém olhar. Não refaz nada; avisa no máximo a cada 30 min.
  if (estado.digitacaoErro && estado.etapa === "confirmacao") {
    const ultimo = estado.redeAvisoEm ? new Date(estado.redeAvisoEm).getTime() : 0;
    if (deps.agora().getTime() - ultimo < 30 * 60_000) return { estado, respostas: [], efeitos: [], rotulo: "rede_aguardando" };
    return { estado: { ...estado, redeAvisoEm: deps.agora().toISOString() }, respostas: [TEXTOS.digitacaoAindaEmAndamento], efeitos: [], rotulo: "rede_aguardando" };
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
      // Pergunta sobre o andamento (quanto cai, quando, parcela, link): responde e segue.
      const assunto = entrada.texto ? perguntaSobreAndamento(entrada.texto) : null;
      if (assunto) return { estado, respostas: [respostaAndamento(estado, assunto), TEXTOS.finalizandoContrato], efeitos: [], rotulo: "andamento_respondido" };
      const antes = s ? RESPOSTA_SOCIAL[s] : undefined;
      return { estado, respostas: antes ? [antes] : [], efeitos: [], rotulo: "confirmacao_mantida" };
    }
    estado = { ...estado, confirmacaoPendente: undefined };
  }

  // Na etapa do extrato, PDF ou foto é o que ela pediu. Fora dela, arquivo vai para a equipe.
  if (estado.etapa === "extrato" && entrada.documento) return etapaExtrato(estado, entrada, deps);
  // Extrato antes da hora (INSS ou SIAPE, ainda no CPF, nome ou data): guarda e pede o que falta.
  if (entrada.documento && entrada.documentoId && porExtrato(estado.produto) && ["cpf", "nome", "nascimento"].includes(estado.etapa)) {
    // Segundo arquivo seguido: guarda sem repetir o "Recebi o seu documento".
    const jaTinha = pendentes(estado).length > 0;
    return {
      estado: { ...estado, extratoPendenteId: undefined, extratosPendentes: guardarPendente(estado, entrada.documentoId) },
      respostas: jaTinha ? [] : [TEXTOS.extratoGuardado, PERGUNTA_DA_ETAPA[estado.etapa]],
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
    const jaTinha = pendentes(estado).length > 0;
    return ir(estado, "convenio", jaTinha && estado.etapa === "convenio" ? [] : respostas, "arquivo_no_inicio", [], { extratoPendenteId: undefined, extratosPendentes: guardarPendente(estado, entrada.documentoId) });
  }
  // Extrato de novo depois da oferta: a simulação já foi feita com ele.
  if (entrada.documento && (estado.etapa === "oferta" || estado.etapa === "oferta_port")) {
    return { estado, respostas: [TEXTOS.extratoRepetido, PERGUNTA_DA_ETAPA[estado.etapa]], efeitos: [], rotulo: "extrato_repetido" };
  }
  // Arquivo no lugar do número do contrato (camada conversacional): lê, valida e confirma.
  if (entrada.documento && estado.etapa === "numero_contrato" && deps.conversa?.etapas.has("numero_contrato") && deps.conversa.lerContratoDeArquivo) {
    const p = await etapaContratoPorArquivo(estado, entrada.documentoId, deps);
    if (p) return p;
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
  // "ok", "vou mandar", "pera aí", "depois eu mando" numa espera de dado ou arquivo: com a camada
  // conversacional ligada, ela reconhece o andamento em vez de repetir a pergunta da etapa.
  const pendTipo = descreverPendencia(estado).tipo;
  const andamento = Boolean(deps.conversa?.etapas.has(estado.etapa)) && (pendTipo === "dado" || pendTipo === "arquivo") && leituraCurta(texto) !== null;
  const social = ETAPAS_SOCIAIS.includes(estado.etapa) && !andamento ? mensagemSocial(texto) : null;
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

  // Camada conversacional (fase 7). Só age nas etapas configuradas e só conversa: responde,
  // orienta, reformula ou encaminha. O que muda estado financeiro segue no motor abaixo, que valida
  // tudo com as regras de sempre. Qualquer falha da camada: vale o fluxo de sempre.
  let decisao: SaidaMotor | null = null;
  if (deps.conversa?.etapas.has(estado.etapa) && !dadoDireto(estado, texto, deps.agora())) {
    decisao = await deps.conversa
      .decidir({ estado, texto, pendencia: descreverPendencia(estado), viaAudio: entrada.viaAudio === true, agora: deps.agora() })
      .catch(() => null);
    if (decisao?.tipo === "responder") {
      return { estado: { ...estado, memoria: decisao.memoria }, respostas: decisao.respostas, efeitos: [], rotulo: decisao.rotulo, interpretacao: decisao.registro };
    }
    if (decisao?.tipo === "encaminhar") {
      const p = transferir({ ...estado, memoria: decisao.memoria }, `conversa: ${decisao.motivo}`, decisao.respostas[0] ?? TEXTOS.transferindo, decisao.rotulo, [], "nao_entendeu");
      return { ...p, interpretacao: decisao.registro };
    }
  }
  const passo = await despachar(estado, entrada, texto, deps);
  if (!decisao) return passo;
  // Concordância obrigatória: num passo que aceita algo financeiro (consentimento, oferta,
  // confirmação dos dados, PIX), as regras de sempre e a interpretação precisam concordar.
  // Se a interpretação não leu um "confirmar" com confiança, vale a mais restritiva: nada avança.
  const pend = descreverPendencia(estado);
  if (decisao.tipo === "delegar" && decisao.interpretacao !== null && (pend.tipo === "confirmacao" || pend.tipo === "decisao") && aceitouAlgo(estado, passo) && !interpretacaoConfirma(decisao)) {
    return {
      estado: { ...estado, memoria: decisao.memoria },
      respostas: [TEXTOS.confirmeComSimOuNao],
      efeitos: [],
      rotulo: "conversa_veto_sem_concordancia",
      interpretacao: { ...decisao.registro, acao: "veto:sem_concordancia" },
    };
  }
  // A proposta de contrato (arquivo ou áudio) pertence ao motor operacional: vale o que ele deixou.
  let memoria: MemoriaConversa = { ...decisao.memoria, contratoProposto: passo.estado.memoria?.contratoProposto };
  if (passo.estado.etapa !== estado.etapa) memoria = { ...memoria, ajudasSemProgresso: 0 };
  // A Maisa de hoje não entendeu: em vez de repetir "não entendi", reformula com outra abordagem.
  if (decisao.tipo === "delegar" && FALHAS_DE_ENTENDIMENTO.has(passo.rotulo) && !passo.efeitos.length && deps.conversa?.reformular) {
    const alt = await deps.conversa.reformular({ estado, texto, pendencia: descreverPendencia(estado), agora: deps.agora(), memoria }).catch(() => null);
    if (alt) {
      return {
        ...passo,
        estado: { ...passo.estado, memoria: { ...alt.memoria, contratoProposto: passo.estado.memoria?.contratoProposto } },
        respostas: alt.respostas,
        rotulo: `${passo.rotulo}+${alt.rotulo}`,
        interpretacao: { ...decisao.registro, acao: `${decisao.registro.acao}>${alt.registro.acao}`, reformulou: true, fonteTexto: alt.registro.fonteTexto },
      };
    }
  }
  return { ...passo, estado: { ...passo.estado, memoria }, interpretacao: decisao.registro };
}

// CPF ou data reconhecidos pelas regras na etapa que pede esse dado: vão direto ao motor, que
// normaliza e valida. A interpretação não pode atrasar nem reformular um dado que já veio certo.
function dadoDireto(estado: EstadoMaisa, texto: string, agora: Date): boolean {
  if (estado.etapa === "cpf") return Boolean(extrairCpf(texto) || cpfComTamanhoErrado(texto));
  // Coleta esperando o endereço: CEP, número ou complemento lidos pelas regras.
  if (estado.etapa === "coleta") return leituraDeEndereco(estado, texto) !== null;
  // No extrato, a correção da data ("errei, é 12/12/1966") também é dado certo.
  if (estado.etapa === "extrato") return lerDataNascimento(texto, agora) !== null;
  // Data sugerida esperando o "sim": a confirmação é do motor, não vira "vou conseguir".
  if (estado.etapa === "nascimento" && estado.dataSugerida) return true;
  if (estado.etapa === "nascimento") return datasNoTexto(texto, agora).length > 0 || dataInexistente(texto) !== null || sugerirDataNascimento(texto, agora) !== null;
  return false;
}

const interpretacaoConfirma = (d: SaidaMotor) =>
  d.tipo === "delegar" && d.interpretacao !== null && d.interpretacao.intencao === "confirmar" && d.interpretacao.confianca >= configFluxo.confiancaMin;

// O passo das regras de sempre aceitou algo? Consentimento ou oferta que seguem, "sim" dos dados
// que abre a janela, PIX autorizado.
function aceitouAlgo(antes: EstadoMaisa, passo: Passo): boolean {
  const depois = passo.estado;
  if (depois.confirmacaoPendente && !antes.confirmacaoPendente) return true;
  if (depois.contrato?.dados.pixCpf === true && antes.contrato?.dados.pixCpf !== true) return true;
  return ["consentimento", "oferta", "oferta_port"].includes(antes.etapa) && depois.etapa !== antes.etapa && depois.etapa !== "finalizada";
}

const FALHAS_DE_ENTENDIMENTO = new Set(["nao_entendeu", "numero_contrato_invalido", "nascimento_invalido", "dado_nao_entendido", "cpf_invalido", "sem_extrato", "extrato_invalido"]);

const ROTULO_EXTRA: Partial<Record<CampoContrato, string>> = {
  sexo: "sexo", estadoCivil: "estado civil", email: "e-mail", renda: "salário bruto", matricula: "matrícula",
  tipoCreditoNb: "forma de recebimento do benefício", pixCpf: "autorização do PIX na chave CPF",
};
const rotuloDoCampo = (c: CampoContrato) => ROTULO_CAMPO[c] ?? ROTULO_EXTRA[c] ?? null;

// A pergunta que a Maisa deixou pendente, descrita para a camada conversacional.
export function descreverPendencia(estado: EstadoMaisa): Pendencia {
  const etapa = estado.etapa;
  const base = { etapa, faltando: [] as string[], coletados: [] as string[] };
  switch (etapa) {
    case "numero_contrato": {
      const d = estado.alternativa?.digitacao;
      const banco = d?.banco ?? "do banco";
      const prop = estado.memoria?.contratoProposto;
      // O número já foi lido de um arquivo ou áudio: a pergunta pendente é "é esse mesmo?".
      if (prop) {
        return {
          ...base, chave: "numero_contrato_confirmar", tipo: "confirmacao", topico: "numero_contrato",
          pergunta: prop.origem === "arquivo" ? TEXTOS.contratoDoArquivo(prop.numero, prop.banco) : TEXTOS.contratoDoAudio(prop.numero),
          dadoPedido: "a confirmação do número do contrato",
        };
      }
      return {
        ...base, chave: "numero_contrato", tipo: "dado", topico: "numero_contrato",
        pergunta: d ? TEXTOS.pedeNumeroContrato(d.banco, formatarReais(Math.round(d.parcela * 100)), estado.produto) : TEXTOS.numeroContratoInvalido,
        dadoPedido: `o número do contrato do ${banco}`,
      };
    }
    case "consentimento":
    case "oferta":
    case "oferta_port":
    case "confirmacao":
      return { ...base, chave: etapa, tipo: "confirmacao", topico: null, pergunta: estado.contrato?.pergunta ?? PERGUNTA_DA_ETAPA[etapa] ?? "", dadoPedido: "a sua confirmação" };
    case "extrato":
      return { ...base, chave: "extrato", tipo: "arquivo", topico: estado.produto === "inss" ? "extrato_inss" : "extrato_siape", pergunta: estado.extratoSiapePendente ? TEXTOS.pedeContracheque : TEXTOS.lembraExtrato, dadoPedido: estado.extratoSiapePendente ? "o último contracheque" : "o extrato" };
    case "cpf":
      return { ...base, chave: "cpf", tipo: "dado", topico: "cpf", pergunta: PERGUNTA_DA_ETAPA.cpf, dadoPedido: "o seu CPF" };
    case "nascimento":
      return { ...base, chave: "nascimento", tipo: "dado", topico: "data_nascimento", pergunta: PERGUNTA_DA_ETAPA.nascimento, dadoPedido: "a sua data de nascimento" };
    case "coleta": {
      const dados = estado.contrato?.dados ?? {};
      const produto = produtoCadastro(estado);
      const falta = camposFaltando(dados, produto);
      const faltando = falta.map(rotuloDoCampo).filter((x): x is string => Boolean(x));
      const coletados = (Object.keys(dados) as CampoContrato[]).map(rotuloDoCampo).filter((x): x is string => Boolean(x));
      const primeiro = falta[0];
      return {
        etapa, faltando, coletados, chave: `coleta:${primeiro ?? "resumo"}`, topico: null,
        tipo: primeiro === "pixCpf" ? "decisao" : "dado",
        pergunta: estado.contrato?.pergunta ?? TEXTOS.continuarCadastro,
        dadoPedido: primeiro && rotuloDoCampo(primeiro) ? `a informação de ${rotuloDoCampo(primeiro)}` : "os dados do cadastro",
      };
    }
    default:
      return { ...base, chave: etapa, tipo: "dado", topico: null, pergunta: PERGUNTA_DA_ETAPA[etapa] || "", dadoPedido: "a informação que eu pedi" };
  }
}

// Despacha a mensagem para a etapa em que a conversa está.
async function despachar(estado: EstadoMaisa, entrada: EntradaTexto, texto: string, deps: Dependencias): Promise<Passo> {
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
      return etapaNumeroContrato(estado, texto, deps, entrada.viaAudio === true);
    case "coleta":
      return etapaColeta(estado, { texto }, deps);
    case "confirmacao":
      return etapaConfirmacao(estado, texto, deps, entrada.mensagemId);
    case "finalizada":
      return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };
  }
}
