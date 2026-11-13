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

export async function lerContratoDoArquivo(conteudo: Buffer, mimetype: string): Promise<{ lido: ContratoLido; meta: MetaChamada }> {
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
        { role: "system", content: INSTRUCOES },
        { role: "user", content: [{ type: "input_text", text: "Qual é o número do contrato e o banco neste documento?" }, parte] },
      ],
      text: { format: { type: "json_schema", name: "contrato_do_arquivo", schema: SCHEMA, strict: true } },
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
  const bruto = JSON.parse(texto) as { legivel?: unknown; numero_contrato?: unknown; banco?: unknown };
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
