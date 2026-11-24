// Follow-up escrito pela Maisa para o cliente que parou de responder. Ela retoma como uma vendedora
// experiente: lembra o próximo passo, tira o medo mais provável e oferece ajuda no ponto em que o cliente
// travou. Nunca inventa valor, prazo nem aprovação. Qualquer falha ou resposta fora do combinado: vale o
// texto fixo do fluxo.
import { env } from "../../config/env.js";
import { FATOS } from "./intencao.js";

const INSTRUCOES = `Você é a Maisa, a melhor vendedora de crédito consignado da Mais Money, no WhatsApp. O cliente parou de responder no meio do atendimento e você vai retomar com UMA mensagem curta.

Como retomar:
- Tentativa 1: leve e simples. Lembre onde parou, mostre que é rápido e repita o próximo passo em uma frase.
- Tentativa 2: contorne a objeção mais provável do ponto em que ele parou: medo de golpe ou de passar dado (a Maisa só pede o que o banco exige e nunca pede senha), falta de tempo (é rápido), dificuldade com o aplicativo (você orienta passo a passo) ou dúvida sobre a condição (você explica). Ofereça ajuda concreta nesse ponto e, se ele preferir, uma pessoa da equipe.
- Se há oferta na ficha, retome a oferta com os valores exatos da ficha e pergunte se quer seguir ou se ficou alguma dúvida.

Regras sem exceção:
- 1 a 3 frases curtas, português simples, sem emoji, sem listas, sem se apresentar de novo.
- Valor, parcela, taxa, prazo ou troco só se estiverem na ficha. Nunca prometa aprovação, liberação ou data de pagamento. Não crie urgência falsa.
- Nunca mande o cliente "responder SIM" nem dê ordem de resposta: pergunte como uma pessoa pergunta. Uma aprovação do cliente já basta.
- Nunca peça senha. Nunca diga que fez algo (consultei, simulei, anotei): quem faz é o sistema.
- Não repita o que já está nas últimas mensagens com as mesmas palavras.
- Termine com uma pergunta simples ou um convite claro para responder.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["texto"],
  properties: { texto: { type: ["string", "null"] } },
};

export async function redigirFollowupComModelo(p: { etapa: string; produto?: string; pergunta: string; ficha: string; historico: string; tentativa: number }): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: env.OPENAI_MODELO_CONVERSA || env.OPENAI_MODELO_EXTRATO,
      store: false,
      input: [
        { role: "system", content: `${INSTRUCOES}\n\nFatos gerais:\n${FATOS}` },
        {
          role: "user",
          content: `Tentativa ${p.tentativa} de 2. Etapa: ${p.etapa}. Produto: ${p.produto ?? "ainda não definido"}.\nO que está pendente com o cliente: ${p.pergunta}\nFICHA DO CLIENTE:\n${p.ficha || "(nada simulado ainda)"}\nÚLTIMAS MENSAGENS (mais antigas primeiro):\n${p.historico || "(nenhuma)"}`,
        },
      ],
      text: { format: { type: "json_schema", name: "followup", schema: SCHEMA, strict: true } },
    }),
  });
  const j = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${j.error?.message ?? "erro desconhecido"}`);
  const partes: Record<string, any>[] = (j.output ?? []).flatMap((o: Record<string, any>) => o.content ?? []);
  const saida = j.output_text ?? partes.find((x) => x.type === "output_text")?.text;
  if (!saida) return null;
  return validarFollowup((JSON.parse(saida) as { texto: string | null }).texto, p);
}

// Texto vazio, longo, com senha ou com número que ela não leu: não vale.
export function validarFollowup(texto: string | null | undefined, p: { pergunta: string; ficha: string; historico: string }): string | null {
  const t = texto?.trim() ?? "";
  if (!t || t.length > 420) return null;
  if (/senha\s+(do|da|de)|me\s+(passe|mande|envie)\s+(a\s+)?senha/i.test(t)) return null;
  if (/(responda|responder|responde)\s+\"?sim/i.test(t)) return null;
  if (/(responda|responder|responde)\s+"?sim/i.test(t)) return null;
  if (/R\$|%/.test(t) && !p.ficha) return null;
  const permitidos = new Set(`${FATOS} ${p.pergunta} ${p.ficha} ${p.historico}`.match(/\d+/g) ?? []);
  if ((t.match(/\d+/g) ?? []).some((n) => !permitidos.has(n))) return null;
  return t;
}
