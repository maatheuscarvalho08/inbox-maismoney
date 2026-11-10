// Cliente da API Facta, crédito do trabalhador (CLT).
// Manuais: "Consulta Dados CLT v2.0" e "CRÉDITO DO TRABALHADOR v9.0".
// Só leitura: pede a autorização, consulta a Dataprev e simula. A digitação da
// proposta fica com a equipe.
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
const numero = (v: unknown) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
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
  | { tipo: "indisponivel"; mensagem: string }
  | { tipo: "erro"; mensagem: string };

export async function consultarTrabalhador(cpf: string): Promise<ResultadoConsulta> {
  const j = await chamar("/consignado-trabalhador/autoriza-consulta", cpf, { method: "GET", query: { cpf: cpf11(cpf) } });
  const mensagem = String(j.mensagem ?? "");
  if (j.erro) {
    if (/solicita-autorizacao|token expirado/i.test(mensagem)) return { tipo: "nao_autorizado" };
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
  const tabelas: Tabela[] = (j.tabelas ?? []).map((t: Record<string, unknown>) => ({
    tabela: String(t.tabela ?? ""),
    prazo: Number(t.prazo),
    taxa: Number(t.taxa),
    parcela: Number(t.parcela),
    valorLiquido: Number(t.valor_liquido),
    valorSeguro: Number(t.valor_seguro ?? 0),
  }));
  return { tabelas, mensagem: String(j.mensagem ?? "") };
}

export const factaConfigurada = () => Boolean(env.FACTA_USER && env.FACTA_PASS);
