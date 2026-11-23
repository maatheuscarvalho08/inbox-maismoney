// Lê o número do contrato e o banco em um arquivo que o cliente mandou no lugar do número.
// Saída estrita. O resultado nunca vale sozinho: o fluxo pede a confirmação do cliente.
import { env } from "../../../config/env.js";
import { modeloConversa, type MetaChamada } from "./interpretador.js";

export interface ContratoLido {
  legivel: boolean;
  numero: string | null;
  banco: string | null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["legivel", "numero_contrato", "banco"],
  properties: {
    legivel: { type: "boolean" },
    numero_contrato: { type: ["string", "null"] },
    banco: { type: ["string", "null"] },
  },
} as const;

const INSTRUCOES = `Você lê um documento de crédito consignado (extrato de empréstimo, contrato, tela de aplicativo de banco) e devolve o NÚMERO DO CONTRATO e o BANCO que aparecem nele.
Regras: copie o número exatamente como aparece, só dígitos. Se houver vários contratos, devolva numero_contrato null. Se não achar um número de contrato com clareza, devolva null. Nunca deduza nem complete. legivel é false se a imagem não permite ler.`;

async function lerComModelo(
  instrucoes: string,
  pergunta: string,
  nomeSchema: string,
  schema: object,
  conteudo: Buffer,
  mimetype: string,
): Promise<{ bruto: Record<string, unknown>; meta: MetaChamada }> {
  if (!env.OPENAI_API_KEY) throw new Error("sem_chave");
  const base64 = conteudo.toString("base64");
  const parte =
    mimetype === "application/pdf"
      ? { type: "input_file", filename: "documento.pdf", file_data: `data:application/pdf;base64,${base64}` }
      : { type: "input_image", image_url: `data:${mimetype};base64,${base64}`, detail: "high" };
  const inicio = Date.now();
  const modelo = modeloConversa();
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(Math.max(env.MAISA_CONVERSA_PRAZO_MS, 30_000)),
    body: JSON.stringify({
      model: modelo,
      store: false,
      input: [
        { role: "system", content: instrucoes },
        { role: "user", content: [{ type: "input_text", text: pergunta }, parte] },
      ],
      text: { format: { type: "json_schema", name: nomeSchema, schema, strict: true } },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    output_text?: string;
    output?: { content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const meta: MetaChamada = { latenciaMs: Date.now() - inicio, modelo: j.model ?? modelo, tokensEntrada: j.usage?.input_tokens ?? null, tokensSaida: j.usage?.output_tokens ?? null };
  if (!r.ok) throw new Error(`http_${r.status}`);
  const texto = j.output_text ?? (j.output ?? []).flatMap((o) => o.content ?? []).find((p) => p.type === "output_text")?.text;
  if (!texto) throw new Error("sem_texto");
  return { bruto: JSON.parse(texto) as Record<string, unknown>, meta };
}

export async function lerContratoDoArquivo(conteudo: Buffer, mimetype: string): Promise<{ lido: ContratoLido; meta: MetaChamada }> {
  const { bruto, meta } = await lerComModelo(INSTRUCOES, "Qual é o número do contrato e o banco neste documento?", "contrato_do_arquivo", SCHEMA, conteudo, mimetype);
  const numero = typeof bruto.numero_contrato === "string" ? bruto.numero_contrato.replace(/\D/g, "") : null;
  return {
    meta,
    lido: {
      legivel: bruto.legivel === true,
      // Número fora de 5 a 30 dígitos não é número de contrato.
      numero: numero && numero.length >= 5 && numero.length <= 30 ? numero : null,
      banco: typeof bruto.banco === "string" && bruto.banco.trim() ? bruto.banco.trim().slice(0, 60) : null,
    },
  };
}

export interface MargemLida {
  legivel: boolean;
  // true só quando a tela mostra a margem consignável claramente negativa.
  negativa: boolean;
  // Margem disponível para empréstimo consignado em reais, quando a tela mostra uma.
  valor: number | null;
}

const SCHEMA_MARGEM = {
  type: "object",
  additionalProperties: false,
  required: ["legivel", "margem_negativa", "valor"],
  properties: {
    legivel: { type: "boolean" },
    margem_negativa: { type: "boolean" },
    valor: { type: ["number", "null"] },
  },
} as const;

const INSTRUCOES_MARGEM = `Você lê um print do aplicativo SouGov.br ou Meu INSS e devolve a MARGEM CONSIGNÁVEL DISPONÍVEL para empréstimo consignado.
Regras: valor é o número em reais da margem disponível para empréstimo (não cartão, não a soma de contratos). margem_negativa é true só se a tela mostra essa margem claramente negativa (sinal de menos ou o aviso de margem negativa). Se o arquivo não for uma tela de margem, ou não der para ler com clareza, devolva valor null e margem_negativa false. Nunca deduza nem complete. legivel é false se a imagem não permite ler.`;

export async function lerMargemDoArquivo(conteudo: Buffer, mimetype: string): Promise<{ lida: MargemLida; meta: MetaChamada }> {
  const { bruto, meta } = await lerComModelo(INSTRUCOES_MARGEM, "Qual é a margem disponível para empréstimo consignado nesta tela?", "margem_do_print", SCHEMA_MARGEM, conteudo, mimetype);
  const valor = typeof bruto.valor === "number" && Number.isFinite(bruto.valor) ? bruto.valor : null;
  return { meta, lida: { legivel: bruto.legivel === true, negativa: bruto.margem_negativa === true || (valor !== null && valor < 0), valor } };
}
