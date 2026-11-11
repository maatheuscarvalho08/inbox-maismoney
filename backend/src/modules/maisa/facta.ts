// Cliente da API Facta. Manuais: "Consulta Dados CLT v2.0", "CRÉDITO DO TRABALHADOR v9.0",
// "INSS v11.0" e "SIAPE v1.0".
// CLT: pede a autorização, consulta a Dataprev e simula. INSS e SIAPE: simulam com a
// parcela do extrato e, quando o cliente aceita, digitam a proposta (etapas 1, 2 e 3)
// e mandam o link de assinatura.
import { env } from "../../config/env.js";
import { mascararCpf } from "./cpf.js";

// Constantes fixas do produto (manual v9.0, etapa 4).
const PRODUTO = "D";
const TIPO_OPERACAO = "13"; // NOVO DIGITAL
const AVERBADOR = "10010"; // CONSIGNADO DO TRABALHADOR
const CONVENIO = "3"; // FACTA FINANCEIRA

export class FactaErro extends Error {
  constructor(
    public endpoint: string,
    mensagem: string,
  ) {
    super(`[Facta ${endpoint}] ${mensagem}`);
  }
}

let tokenEmCache: { token: string; expiraEm: number } | null = null;

async function gerarToken(): Promise<string> {
  // Vale 1 hora. Renova com 5 minutos de folga.
  if (tokenEmCache && Date.now() < tokenEmCache.expiraEm - 5 * 60_000) return tokenEmCache.token;
  const basic = Buffer.from(`${env.FACTA_USER}:${env.FACTA_PASS}`).toString("base64");
  const r = await fetch(new URL("/gera-token", env.FACTA_BASE_URL), {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(30_000),
  });
  const j = await lerJson(r);
  if (j.erro || !j.token) throw new FactaErro("gera-token", String(j.mensagem ?? `HTTP ${r.status}`));
  tokenEmCache = { token: String(j.token), expiraEm: Date.now() + 60 * 60_000 };
  return tokenEmCache.token;
}

// A Facta devolve HTML quando o IP não está liberado (Cloudflare).
async function lerJson(r: Response): Promise<Record<string, any>> {
  const texto = await r.text();
  try {
    return JSON.parse(texto);
  } catch {
    const bloqueado = /<html/i.test(texto) ? "resposta em HTML, IP não liberado ou produção não ativada" : texto.slice(0, 200);
    return { erro: true, mensagem: bloqueado };
  }
}

async function chamar(
  endpoint: string,
  cpf: string,
  init: { method: "GET" | "POST"; query?: Record<string, string>; form?: Record<string, string> },
) {
  const url = new URL(endpoint, env.FACTA_BASE_URL);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${await gerarToken()}` };
  let body: string | undefined;
  if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  let r: Response;
  try {
    r = await fetch(url, { method: init.method, headers, body, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new FactaErro(endpoint, `rede: ${err instanceof Error ? err.message : err}`);
  }
  const j = await lerJson(r);
  // Log sem dados pessoais: só o endpoint, o CPF mascarado e a mensagem da Facta.
  console.log(`Facta ${endpoint} cpf=${mascararCpf(cpf)} http=${r.status} erro=${j.erro} msg=${String(j.mensagem ?? "").slice(0, 120)}`);
  if (r.status >= 500 || r.status === 429) throw new FactaErro(endpoint, `HTTP ${r.status}`);
  return j;
}

const soDigitos = (s: string) => s.replace(/\D/g, "");
// CPF sempre como texto de 11 dígitos. O manual tipa como int, mas int perde o zero da frente.
const cpf11 = (c: string) => soDigitos(c).padStart(11, "0");
// Aceita 2345.67, "2345,67", "2.345,67" e "R$ 2.345,67". O que não der número vira null,
// para a regra do vínculo recusar em vez de mandar "NaN" para a Facta.
export function numero(v: unknown): number | null {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
const sim = (v: unknown) => /^(s|sim|true|1)$/i.test(String(v ?? "").trim());

function dataIso(d: unknown): string | null {
  const m = String(d ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return d ? String(d).slice(0, 10) : null;
}

// O número da conversa vem como 5521999998888. A Facta quer (21) 99999-8888.
export function formatarCelular(numeroWhatsapp: string) {
  const d = soDigitos(numeroWhatsapp).replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numeroWhatsapp;
}

// 1. Pede à Facta que mande o link de autorização ao cliente. A autorização vale 30 dias.
export type ResultadoAutorizacao = "enviada" | "ja_autorizado" | "telefone_de_outro_cpf" | "erro";

export async function solicitarAutorizacao(p: { cpf: string; nome: string; celular: string }) {
  const j = await chamar("/solicita-autorizacao-consulta", p.cpf, {
    method: "POST",
    form: {
      averbador: AVERBADOR,
      nome: p.nome,
      cpf: cpf11(p.cpf),
      celular: formatarCelular(p.celular),
      tipo_envio: "WHATSAPP",
    },
  });
  const mensagem = String(j.mensagem ?? "");
  // "Telefone já informado para outro cpf!" chega com erro:false.
  if (/outro cpf/i.test(mensagem)) return { resultado: "telefone_de_outro_cpf" as const, mensagem };
  if (/n[aã]o necessita/i.test(mensagem)) return { resultado: "ja_autorizado" as const, mensagem };
  if (j.erro) return { resultado: "erro" as const, mensagem };
  return { resultado: "enviada" as const, mensagem };
}

// 2. Dados da Dataprev. Só funciona depois que o cliente autorizou.
export interface Vinculo {
  matricula: string;
  dataNascimento: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  elegivel: boolean;
  renda: number | null;
  margemDisponivel: number | null;
  erroMensagem: string;
}

export type ResultadoConsulta =
  | { tipo: "autorizado"; vinculos: Vinculo[] }
  | { tipo: "nao_autorizado" }
  | { tipo: "link_expirado" }
  | { tipo: "indisponivel"; mensagem: string }
  | { tipo: "erro"; mensagem: string };

export async function consultarTrabalhador(cpf: string): Promise<ResultadoConsulta> {
  const j = await chamar("/consignado-trabalhador/autoriza-consulta", cpf, { method: "GET", query: { cpf: cpf11(cpf) } });
  const mensagem = String(j.mensagem ?? "");
  if (j.erro) {
    // O link ou a autorização venceu: só um pedido novo resolve.
    if (/token expirado/i.test(mensagem)) return { tipo: "link_expirado" };
    if (/solicita-autorizacao/i.test(mensagem)) return { tipo: "nao_autorizado" };
    // Virada de folha: indisponível por um tempo. Tenta de novo mais tarde.
    if (/virada de folha|indispon/i.test(mensagem)) return { tipo: "indisponivel", mensagem };
    return { tipo: "erro", mensagem };
  }
  const dados: Record<string, unknown>[] = j.dados_trabalhador?.dados ?? [];
  return {
    tipo: "autorizado",
    vinculos: dados.map((d) => ({
      matricula: String(d.matricula ?? ""),
      dataNascimento: dataIso(d.dataNascimento),
      dataAdmissao: dataIso(d.dataAdmissao),
      dataDesligamento: dataIso(d.dataDesligamento),
      elegivel: sim(d.elegivel),
      renda: numero(d.valorTotalVencimentos),
      margemDisponivel: numero(d.valorMargemDisponivel),
      erroMensagem: String(d.erro_mensagem ?? ""),
    })),
  };
}

// 3. Simulação. Só leitura, não cria nada na Facta.
export interface Tabela {
  tabela: string;
  codigoTabela: number;
  coeficiente: number;
  // Valor bruto do contrato. A etapa 1 da digitação pede este, não o líquido.
  contrato: number;
  prazo: number;
  taxa: number;
  parcela: number;
  valorLiquido: number;
  valorSeguro: number;
}

// INSS (manual INSS v11.0): mesmo endpoint, averbador 3 e sem renda. A Facta não
// consulta a margem do INSS; a parcela vem do extrato que o cliente manda.
// SIAPE (manual SIAPE v1.0): igual, com averbador 15.
const AVERBADOR_EXTRATO = { inss: "3", siape: "15" } as const;

export function simular(p: { cpf: string; dataNascimento: string; renda: number; valorParcela: number }) {
  return operacoesDisponiveis(p.cpf, p.dataNascimento, p.valorParcela, AVERBADOR, { valor_renda: p.renda.toFixed(2) });
}

export function simularConsignado(p: { convenio: "inss" | "siape"; cpf: string; dataNascimento: string; valorParcela: number }) {
  return operacoesDisponiveis(p.cpf, p.dataNascimento, p.valorParcela, AVERBADOR_EXTRATO[p.convenio]);
}

async function operacoesDisponiveis(cpf: string, dataNascimento: string, valorParcela: number, averbador: string, extra: Record<string, string> = {}) {
  const j = await chamar("/proposta/operacoes-disponiveis", cpf, {
    method: "GET",
    query: {
      produto: PRODUTO,
      tipo_operacao: TIPO_OPERACAO,
      averbador,
      convenio: CONVENIO,
      opcao_valor: "2", // pela parcela
      valor_parcela: valorParcela.toFixed(2),
      cpf: cpf11(cpf),
      data_nascimento: dataNascimento.split("-").reverse().join("/"),
      ...extra,
    },
  });
  if (j.erro) return { tabelas: [] as Tabela[], mensagem: String(j.mensagem ?? "") };
  return { tabelas: lerTabelas(j.tabelas), mensagem: String(j.mensagem ?? "") };
}

function lerTabelas(lista: unknown): Tabela[] {
  return (Array.isArray(lista) ? lista : []).map((t: Record<string, unknown>) => ({
    tabela: String(t.tabela ?? ""),
    codigoTabela: Number(t.codigoTabela),
    coeficiente: Number(t.coeficiente),
    contrato: Number(t.contrato),
    prazo: Number(t.prazo),
    taxa: Number(t.taxa),
    parcela: Number(t.parcela),
    valorLiquido: Number(t.valor_liquido ?? 0),
    valorSeguro: Number(t.valor_seguro ?? 0),
  }));
}

// Portabilidade CIP + refin da portabilidade do SIAPE (manual Portabilidade SIAPE v1.0,
// tipo de operação 003500). Só simula: devolve as tabelas da port e do refin, com o troco.
// O saldo devedor é estimado pelo extrato; o real vem da CIP na digitação.
export interface SimulacaoPortRefin {
  portabilidade: Tabela[];
  refin: Tabela[];
  mensagem: string;
}

export async function simularPortRefinSiape(p: {
  cpf: string;
  dataNascimento: string;
  parcela: number;
  prazoRestante: number;
  prazoOriginal: number;
  saldoDevedor: number;
  prazo: number;
}): Promise<SimulacaoPortRefin> {
  const j = await chamar("/proposta/operacoes-disponiveis", p.cpf, {
    method: "GET",
    query: {
      produto: PRODUTO,
      tipo_operacao: "003500",
      averbador: AVERBADOR_EXTRATO.siape,
      convenio: CONVENIO,
      opcao_valor: "2",
      valor_parcela: p.parcela.toFixed(2),
      prazo: String(p.prazo),
      cpf: cpf11(p.cpf),
      data_nascimento: dataBr(p.dataNascimento),
      prazo_restante: String(p.prazoRestante),
      saldo_devedor: p.saldoDevedor.toFixed(2),
      valor_parcela_original: p.parcela.toFixed(2),
      prazo_original: String(p.prazoOriginal),
    },
  });
  // A Facta marca erro:true quando só uma das partes não tem tabela. Nesse caso a parte
  // sem tabela vem como texto ("Não foram encontradas tabelas..."), e a outra vem normal.
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const mensagem = String(j.mensagem ?? "") || texto(j.tabelas_refin_portabilidade) || texto(j.tabelas_portabilidade);
  return { portabilidade: lerTabelas(j.tabelas_portabilidade), refin: lerTabelas(j.tabelas_refin_portabilidade), mensagem };
}

export const factaConfigurada = () => Boolean(env.FACTA_USER && env.FACTA_PASS);
export const digitacaoConfigurada = () => factaConfigurada() && Boolean(env.FACTA_LOGIN_CERTIFICADO);

// Listas auxiliares (proposta-combos). Mudam raramente: ficam em memória por 1 dia.
const combos = new Map<string, { valor: Record<string, unknown>; ate: number }>();

async function combo(nome: string, chave: string): Promise<Record<string, unknown>> {
  const guardado = combos.get(nome);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;
  const j = await chamar(`/proposta-combos/${nome}`, "", { method: "GET" });
  if (j.erro || !j[chave]) throw new FactaErro(nome, String(j.mensagem ?? "lista indisponível"));
  combos.set(nome, { valor: j[chave], ate: Date.now() + 24 * 60 * 60_000 });
  return j[chave];
}

export async function estadosCivis(): Promise<Record<string, string>> {
  return (await combo("estado-civil", "estado_civil")) as Record<string, string>;
}

export async function orgaosEmissores(): Promise<Record<string, string>> {
  return (await combo("orgao-emissor", "orgao_emissor")) as Record<string, string>;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

// Código da cidade na Facta. null quando não acha uma cidade com esse nome no estado.
export async function codigoCidade(uf: string, nome: string): Promise<string | null> {
  const j = await chamar("/proposta-combos/cidade", "", { method: "GET", query: { estado: uf, nome_cidade: nome } });
  const cidades = (j.cidade ?? {}) as Record<string, { nome: string; estado: string }>;
  const alvo = semAcento(nome);
  const exata = Object.entries(cidades).find(([, c]) => semAcento(c.nome) === alvo && c.estado === uf);
  return exata?.[0] ?? null;
}

// Celular no formato da etapa 2: (0DD) NNNNN-NNNN.
function celularEtapa2(numeroWhatsapp: string) {
  const d = soDigitos(numeroWhatsapp).replace(/^55(?=\d{10,11}$)/, "");
  return `(0${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export interface Contratacao {
  convenio: "inss" | "siape";
  cpf: string;
  dataNascimento: string; // AAAA-MM-DD
  celular: string;
  tabela: { codigoTabela: number; prazo: number; contrato: number; parcela: number; coeficiente: number };
  pessoa: {
    nome: string;
    sexo: "M" | "F";
    estadoCivil: string;
    rg: string;
    estadoRg: string;
    orgaoEmissor: string;
    dataExpedicao: string; // AAAA-MM-DD
    estadoNatural: string;
    cidadeNatural: string; // código Facta
    renda: number;
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string; // código Facta
    estado: string;
    nomeMae: string;
    nomePai: string;
    valorPatrimonio: string;
    matricula: string;
    email: string;
    // Só INSS.
    tipoCreditoNb?: string;
    tipoBeneficio?: string;
  };
}

export type ResultadoContratacao =
  | { tipo: "enviada"; codigoAf: string; url: string }
  | { tipo: "erro"; etapa: string; mensagem: string };

// Etapas 1, 2 e 3 e o envio do link de assinatura pelo WhatsApp. Para na primeira falha.
export async function contratar(c: Contratacao): Promise<ResultadoContratacao> {
  const averbador = AVERBADOR_EXTRATO[c.convenio];
  const cpf = cpf11(c.cpf);
  const p = c.pessoa;

  const e1 = await chamar("/proposta/etapa1-simulador", cpf, {
    method: "POST",
    form: {
      produto: PRODUTO,
      tipo_operacao: TIPO_OPERACAO,
      averbador,
      convenio: CONVENIO,
      cpf,
      data_nascimento: dataBr(c.dataNascimento),
      login_certificado: env.FACTA_LOGIN_CERTIFICADO,
      codigo_tabela: String(c.tabela.codigoTabela),
      prazo: String(c.tabela.prazo),
      valor_operacao: c.tabela.contrato.toFixed(2),
      valor_parcela: c.tabela.parcela.toFixed(2),
      coeficiente: String(c.tabela.coeficiente),
      ...(env.FACTA_CODIGO_MASTER ? { codigo_master: env.FACTA_CODIGO_MASTER } : {}),
    },
  });
  const idSimulador = String(e1.id_simulador ?? "");
  if (e1.erro || !idSimulador) return { tipo: "erro", etapa: "simulador", mensagem: String(e1.mensagem ?? "sem id_simulador") };

  const e2 = await chamar("/proposta/etapa2-dados-pessoais", cpf, {
    method: "POST",
    form: {
      id_simulador: idSimulador,
      cpf,
      nome: p.nome.toUpperCase(),
      sexo: p.sexo,
      estado_civil: p.estadoCivil,
      data_nascimento: dataBr(c.dataNascimento),
      rg: p.rg,
      estado_rg: p.estadoRg,
      orgao_emissor: p.orgaoEmissor,
      data_expedicao: dataBr(p.dataExpedicao),
      estado_natural: p.estadoNatural,
      cidade_natural: p.cidadeNatural,
      nacionalidade: "1",
      celular: celularEtapa2(c.celular),
      renda: p.renda.toFixed(2),
      cep: p.cep,
      endereco: p.endereco.toUpperCase(),
      numero: p.numero,
      complemento: p.complemento.toUpperCase(),
      bairro: p.bairro.toUpperCase(),
      cidade: p.cidade,
      estado: p.estado,
      nome_mae: p.nomeMae.toUpperCase(),
      nome_pai: p.nomePai.toUpperCase(),
      valor_patrimonio: p.valorPatrimonio,
      cliente_iletrado_impossibilitado: "N",
      matricula: p.matricula,
      email: p.email,
      // Crédito por PIX na chave CPF, que precisa ser o mesmo da proposta.
      tipo_chave_pix: "1",
      chave_pix: cpf,
      ...(c.convenio === "inss"
        ? { tipo_credito_nb: p.tipoCreditoNb ?? "1", tipo_beneficio: p.tipoBeneficio ?? "", estado_beneficio: p.estado }
        : {}),
    },
  });
  const codigoCliente = String(e2.codigo_cliente ?? "");
  if (e2.erro || !codigoCliente) return { tipo: "erro", etapa: "dados pessoais", mensagem: String(e2.mensagem ?? "sem codigo_cliente") };

  const e3 = await chamar("/proposta/etapa3-proposta-cadastro", cpf, {
    method: "POST",
    form: { codigo_cliente: codigoCliente, id_simulador: idSimulador, tipo_formalizacao: "DIG" },
  });
  const codigoAf = String(e3.codigo ?? "");
  if (e3.erro || !codigoAf) return { tipo: "erro", etapa: "cadastro da proposta", mensagem: String(e3.mensagem ?? "sem código da proposta") };

  const e4 = await chamar("/proposta/envio-link", cpf, { method: "POST", form: { codigo_af: codigoAf, tipo_envio: "whatsapp" } });
  // A proposta já existe. Se o envio falhar, o link ainda serve: a Maisa manda ela mesma.
  if (e4.erro) console.error(`Facta não enviou o link da proposta ${codigoAf}: ${String(e4.mensagem ?? "")}`);
  return { tipo: "enviada", codigoAf, url: String(e3.url_formalizacao ?? "") };
}
