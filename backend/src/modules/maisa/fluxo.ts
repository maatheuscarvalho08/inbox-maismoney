import type { Convenio } from "@prisma/client";
import type { Classificador, ConvenioEntendido } from "./classificador.js";
import type { ResultadoAutorizacao, ResultadoBanco, ResultadoConsulta, ResultadoExtrato } from "./bancos.js";
import { cpfValido, extrairCpf } from "./cpf.js";
import { buscarFaq } from "./faq.js";
import { PRODUTOS_COM_SIMULACAO, ROTULO_CONVENIO, TEXTOS, formatarReais } from "./textos.js";
import { camposFaltando, proximaPergunta, resumoDados, type CampoContrato, type DadosContrato } from "./contrato.js";
import type { ResultadoContratacao } from "./facta.js";

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
  };
  // Port, port + refin ou refin que a Facta abriu, ofertado ao cliente.
  alternativa?: { operacao: "port_refin" | "portabilidade" | "refin"; trocoCentavos: number | null; motivo: string };
  // Cadastro para digitar a proposta. Sai do estado assim que ela passa para a equipe.
  contrato?: { dados: DadosContrato; pergunta: string };
  motivoTransferencia?: string;
  // Onde ela estava quando passou para a equipe, e por quê, num rótulo fechado.
  // A tela usa isso para dizer ao atendente o que fazer em seguida.
  paradaEm?: Etapa;
  saida?: string;
}

// Mensagem do cliente, ou uma checagem automática do relógio (sem texto).
// documento = PDF ou imagem, que pode ser o extrato. Áudio chega já transcrito em texto.
export type Entrada = { texto: string | null; temMidia: boolean; documento?: boolean } | { evento: "verificar_autorizacao" | "verificar_oferta" };

export interface Dependencias {
  classificador: Classificador;
  agora(): Date;
  // Quem chama já sabe o CPF e o celular do cliente. O fluxo não precisa vê-los.
  solicitarAutorizacao(nome: string): Promise<ResultadoAutorizacao>;
  consultar(): Promise<ResultadoConsulta>;
  statusProposta(): Promise<{ banco: string; status: string } | null>;
  // Lê o extrato que acabou de chegar e simula com a margem dele.
  simularPorExtrato(produto: ProdutoExtrato, dataNascimento: string): Promise<ResultadoExtrato>;
  // Digitação na Facta (INSS e SIAPE). Desligada, o "sim" vai para a equipe.
  digitacaoAtiva: boolean;
  extrairDados(pergunta: string, entrada: { texto: string | null; documento?: boolean }, faltando: CampoContrato[]): Promise<DadosContrato>;
  digitar(dados: DadosContrato): Promise<ResultadoContratacao>;
}

export type Efeito =
  | { tipo: "convenio"; convenio: Convenio }
  | { tipo: "cpf"; cpf: string }
  | { tipo: "simulacao"; convenio: Produto; resultado: ResultadoBanco }
  | { tipo: "transferir"; motivo: string }
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
  cpf: TEXTOS.pedeCpf,
  nome: TEXTOS.nomeInvalido,
  consentimento: TEXTOS.perguntaConsentimento,
  aguardando: TEXTOS.aindaNaoAutorizou,
  nascimento: TEXTOS.nascimentoInvalido,
  extrato: TEXTOS.lembraExtrato,
  oferta: TEXTOS.perguntaOferta,
  oferta_port: TEXTOS.perguntaOferta,
  coleta: TEXTOS.continuarCadastro,
  confirmacao: TEXTOS.perguntaConfirmacao,
  finalizada: "",
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
  coleta: "dados do contrato",
  confirmacao: "confirmação dos dados",
  finalizada: "fim",
};

function ir(estado: EstadoMaisa, etapa: Etapa, respostas: string[], rotulo: string, efeitos: Efeito[] = [], extra: Partial<EstadoMaisa> = {}): Passo {
  return { estado: { ...estado, ...extra, etapa, tentativas: 0 }, respostas, efeitos, rotulo };
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
    efeitos: [...efeitos, { tipo: "transferir", motivo }],
    rotulo,
  };
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

const DESCONTO: Record<Produto, string> = { clt: "no seu salário", inss: "no seu benefício", siape: "no seu contracheque" };

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
  const { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie } = resultado;
  const mensagem = TEXTOS.oferta(formatarReais(valorCentavos), prazoMeses, formatarReais(parcelaCentavos), DESCONTO[estado.produto ?? "clt"]);
  return ir(estado, "oferta", [mensagem], "com_saldo", [efeito], {
    oferta: { banco, valorCentavos, parcelaCentavos, prazoMeses, tabela, renda, especie },
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
  if (convenio && convenio !== "outro") return decidirConvenio(estado, convenio, [TEXTOS.apresentacao]);

  if (intencao === "duvida") {
    const faq = buscarFaq(texto);
    if (!faq) return transferir(estado, "dúvida sem resposta pronta", TEXTOS.transferindo, intencao);
    return ir(estado, "convenio", [faq, TEXTOS.saudacao], intencao);
  }

  return ir(estado, "convenio", [TEXTOS.saudacao], intencao);
}

async function etapaConvenio(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const convenio = await deps.classificador.convenio(texto);
  return convenio ? decidirConvenio(estado, convenio) : foraDaEtapa(estado, texto);
}

async function etapaCpf(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const cpf = extrairCpf(texto);
  if (cpf) {
    if (!cpfValido(cpf)) return tentarDeNovo(estado, TEXTOS.cpfInvalido, "cpf_invalido");
    if (porExtrato(estado.produto)) return ir(estado, "nascimento", [TEXTOS.pedeNascimento], "cpf_valido", [{ tipo: "cpf", cpf }]);
    return ir(estado, "nome", [TEXTOS.pedeNome], "cpf_valido", [{ tipo: "cpf", cpf }]);
  }
  if ((await deps.classificador.simNao(texto)) === "nao") {
    return transferir(estado, "não quis informar o CPF", TEXTOS.semConsentimento, "recusou_cpf");
  }
  return foraDaEtapa(estado, texto);
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

// "15/03/1958", "15-03-58", "15 03 1958" ou "15031958". Devolve AAAA-MM-DD.
export function lerDataNascimento(texto: string, agora: Date): string | null {
  const m = texto.match(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4}|\d{2})\b/) ?? texto.match(/\b(\d{2})(\d{2})(\d{4})\b/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano = Number(m[3]);
  if (m[3].length === 2) ano += ano > agora.getFullYear() % 100 ? 1900 : 2000;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCDate() !== dia || data.getUTCMonth() !== mes - 1) return null;
  const idade = (agora.getTime() - data.getTime()) / (365.25 * 24 * 60 * 60_000);
  if (idade < 18 || idade > 100) return null;
  return data.toISOString().slice(0, 10);
}

const produtoExtrato = (estado: EstadoMaisa): ProdutoExtrato => (porExtrato(estado.produto) ? estado.produto : "inss");

async function etapaNascimento(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const data = lerDataNascimento(texto, deps.agora());
  if (data) return ir(estado, "extrato", [TEXTOS.pedeExtrato(produtoExtrato(estado))], "nascimento_valido", [], { dataNascimento: data });
  if (texto.includes("?")) return foraDaEtapa(estado, texto);
  return tentarDeNovo(estado, TEXTOS.nascimentoInvalido, "nascimento_invalido");
}

// Chegou um PDF ou foto: lê como extrato e simula. Texto: explica como tirar o extrato.
async function etapaExtrato(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  if (!entrada.documento) {
    const texto = entrada.texto?.trim() ?? "";
    if (texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);
    return tentarDeNovo(estado, TEXTOS.comoTirarExtrato(produtoExtrato(estado)), "sem_extrato", "sem_extrato");
  }
  let resultado: ResultadoExtrato;
  try {
    resultado = await deps.simularPorExtrato(produtoExtrato(estado), estado.dataNascimento ?? "");
  } catch (err) {
    resultado = { tipo: "erro", banco: "desconhecido", motivo: err instanceof Error ? err.message : "falha na leitura do extrato" };
  }
  if (resultado.tipo === "alternativa") {
    const troco = resultado.trocoCentavos ? formatarReais(resultado.trocoCentavos) : null;
    const { operacao, trocoCentavos, motivo } = resultado;
    // Sem simulação na Facta (INSS, refin ou simulação que falhou): pode passar, mas
    // ela não oferta o que não simulou. A equipe simula e mostra ao cliente.
    if (!resultado.simulada) {
      return transferir(estado, `sem margem para novo; ${motivo}`, TEXTOS.semMargemExtrato, "alternativa", [], "alternativa");
    }
    return ir(estado, "oferta_port", [TEXTOS.ofertaPort(operacao, troco)], "alternativa", [], { alternativa: { operacao, trocoCentavos, motivo } });
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
  if (resposta !== "sim") return foraDaEtapa(estado, texto);
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
  const resposta = await deps.classificador.simNao(texto);
  const motivo = estado.alternativa?.motivo ?? "portabilidade";
  if (resposta === "sim") return transferir(estado, `aceitou: ${motivo}`, TEXTOS.aceitouPort, "aceitou_port", [], "alternativa");
  if (resposta === "nao") return encerrar(estado, "recusou a portabilidade", TEXTOS.recusou, "recusou");
  return foraDaEtapa(estado, texto);
}

async function etapaOferta(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  // INSS e SIAPE com a digitação ligada: ela mesma faz o contrato.
  if (resposta === "sim" && porExtrato(estado.produto) && deps.digitacaoAtiva && estado.oferta?.tabela) {
    const dados: DadosContrato = {};
    if (estado.oferta.renda) dados.renda = estado.oferta.renda;
    if (estado.produto === "inss" && estado.oferta.especie) dados.tipoBeneficio = String(estado.oferta.especie);
    const pergunta = proximaPergunta(dados, estado.produto)!;
    return ir(estado, "coleta", [TEXTOS.inicioContrato, pergunta], "aceitou_contrato", [], {
      contrato: { dados, pergunta },
      ofertaEm: undefined,
      followupEnviado: undefined,
    });
  }
  if (resposta === "sim") return transferir(estado, "aceitou a oferta", TEXTOS.aceitou, "aceitou");
  if (resposta === "nao") return transferir(estado, "recusou a oferta", TEXTOS.recusou, "recusou");
  return foraDaEtapa(estado, texto);
}

// Cada resposta do cliente (texto, foto do documento ou áudio já transcrito) preenche
// o que der do cadastro. Falta algo: pergunta o próximo. Completo: mostra o resumo.
async function etapaColeta(estado: EstadoMaisa, entrada: { texto: string | null; documento?: boolean }, deps: Dependencias): Promise<Passo> {
  const produto = produtoExtrato(estado);
  const dados = estado.contrato?.dados ?? {};
  const pergunta = estado.contrato?.pergunta ?? proximaPergunta(dados, produto) ?? TEXTOS.continuarCadastro;
  const texto = entrada.texto?.trim() ?? "";
  if (!entrada.documento && texto.includes("?") && buscarFaq(texto)) return foraDaEtapa(estado, texto);

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
    return ir(estado, "confirmacao", [TEXTOS.confirmaDados(resumoDados(junto))], "dados_completos", [], {
      contrato: { dados: junto, pergunta: TEXTOS.perguntaConfirmacao },
    });
  }
  if (!Object.keys(novos).length) {
    return tentarDeNovo({ ...estado, contrato: { dados, pergunta } }, `${TEXTOS.naoEntendi} ${pergunta}`, "dado_nao_entendido", "dados_contrato");
  }
  return ir(estado, "coleta", [proxima], "dado_recebido", [], { contrato: { dados: junto, pergunta: proxima } });
}

async function etapaConfirmacao(estado: EstadoMaisa, texto: string, deps: Dependencias): Promise<Passo> {
  const resposta = await deps.classificador.simNao(texto);
  if (resposta === "nao") return transferir(estado, "cliente quer corrigir os dados", TEXTOS.corrigirDados, "corrigir_dados", [], "dados_contrato");
  if (resposta !== "sim") return foraDaEtapa(estado, texto);

  let resultado: ResultadoContratacao;
  try {
    resultado = await deps.digitar(estado.contrato?.dados ?? {});
  } catch (err) {
    resultado = { tipo: "erro", etapa: "sistema", mensagem: err instanceof Error ? err.message : "falha na digitação" };
  }
  if (resultado.tipo === "erro") {
    return transferir(estado, `erro na digitação (${resultado.etapa}): ${resultado.mensagem}`, TEXTOS.erroDigitacao, "erro_digitacao");
  }
  return transferir(estado, `proposta ${resultado.codigoAf} digitada na Facta`, TEXTOS.contratoEnviado(resultado.url), "contrato_enviado", [
    { tipo: "proposta", codigoAf: resultado.codigoAf },
  ]);
}

const FOLLOWUP_MS = 10 * 60_000;
const CARRINHO_MS = 24 * 60 * 60_000;

// Oferta sem resposta. 10 minutos: uma mensagem só, para retomar. 24 horas: sai da
// Maisa e entra no Carrinho, para alguém da equipe ligar. O relógio conta a partir da
// última mensagem do cliente, ou da oferta se ele não escreveu nada depois.
function verificarOferta(estado: EstadoMaisa, agora: Date): Passo {
  const parado: Passo = { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
  if (estado.etapa !== "oferta" || !estado.ofertaEm) return parado;
  const desde = Math.max(new Date(estado.ofertaEm).getTime(), estado.ultimoContatoCliente ? new Date(estado.ultimoContatoCliente).getTime() : 0);
  const passou = agora.getTime() - desde;
  if (passou >= CARRINHO_MS) {
    return transferir(estado, "não respondeu a oferta em 24 horas", null, "carrinho", [], "carrinho");
  }
  if (passou >= FOLLOWUP_MS && !estado.followupEnviado) {
    return { estado: { ...estado, followupEnviado: true }, respostas: [TEXTOS.followupOferta], efeitos: [], rotulo: "followup_oferta" };
  }
  return parado;
}

export async function avancar(atual: EstadoMaisa | null, entrada: Entrada, deps: Dependencias): Promise<Passo> {
  let estado: EstadoMaisa = atual ?? { etapa: "inicio", tentativas: 0 };
  if (estado.etapa === "finalizada") return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };

  // Checagens automáticas do relógio.
  if ("evento" in entrada) {
    if (entrada.evento === "verificar_oferta") return verificarOferta(estado, deps.agora());
    if (estado.etapa !== "aguardando") return { estado, respostas: [], efeitos: [], rotulo: "nada_a_verificar" };
    return consultarAgora(estado, deps, "verificacao_automatica", false);
  }

  // O cliente falou durante a oferta: o relógio do follow-up recomeça daqui.
  if (estado.etapa === "oferta") estado = { ...estado, ultimoContatoCliente: deps.agora().toISOString() };

  // Na etapa do extrato, PDF ou foto é o que ela pediu. Fora dela, arquivo vai para a equipe.
  if (estado.etapa === "extrato" && entrada.documento) return etapaExtrato(estado, entrada, deps);
  if (estado.etapa === "coleta" && entrada.documento) return etapaColeta(estado, entrada, deps);
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
    case "coleta":
      return etapaColeta(estado, { texto }, deps);
    case "confirmacao":
      return etapaConfirmacao(estado, texto, deps);
    case "finalizada":
      return { estado, respostas: [], efeitos: [], rotulo: "ja_finalizada" };
  }
}
