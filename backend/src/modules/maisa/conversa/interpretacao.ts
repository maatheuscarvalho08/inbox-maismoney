// Esquema da interpretação e a conferência feita pelo backend. O modelo devolve JSON, mas
// JSON válido não é verdade: cada dado precisa estar dentro da mensagem do cliente e passar
// pelos validadores de sempre. Dado que o modelo "viu" e não está no texto é descartado.
import { z } from "zod";
import { cpfValido } from "../cpf.js";
import { datasNoTexto, idadeEm } from "../mensagens.js";
import { CAMPOS_DADO, INTENCOES, TONS, type DadoInterpretado, type Interpretacao } from "./tipos.js";

export const TOPICOS_AJUDA = ["numero_contrato", "extrato_siape", "extrato_inss", "cpf", "data_nascimento", "documento_rg", "outro"] as const;

export const InterpretacaoZod = z.object({
  intencao: z.enum(INTENCOES),
  secundarias: z.array(z.enum(INTENCOES)).max(3),
  respondeu_pergunta_pendente: z.enum(["sim", "nao", "parcial", "nao_se_aplica"]),
  dados: z
    .array(z.object({ campo: z.enum(CAMPOS_DADO), valor: z.string().max(120), evidencia: z.string().max(160), correcao: z.boolean() }))
    .max(12),
  topico_ajuda: z.enum(TOPICOS_AJUDA).nullable(),
  tom: z.enum(TONS),
  reclama_repeticao: z.boolean(),
  confianca: z.number().min(0).max(1),
});

// O mesmo contrato, no formato que a OpenAI exige (todos os campos obrigatórios, sem extras).
export const SCHEMA_INTERPRETACAO = {
  type: "object",
  additionalProperties: false,
  required: ["intencao", "secundarias", "respondeu_pergunta_pendente", "dados", "topico_ajuda", "tom", "reclama_repeticao", "confianca"],
  properties: {
    intencao: { type: "string", enum: [...INTENCOES] },
    secundarias: { type: "array", maxItems: 3, items: { type: "string", enum: [...INTENCOES] } },
    respondeu_pergunta_pendente: { type: "string", enum: ["sim", "nao", "parcial", "nao_se_aplica"] },
    dados: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["campo", "valor", "evidencia", "correcao"],
        properties: {
          campo: { type: "string", enum: [...CAMPOS_DADO] },
          valor: { type: "string" },
          evidencia: { type: "string" },
          correcao: { type: "boolean" },
        },
      },
    },
    topico_ajuda: { type: ["string", "null"], enum: [...TOPICOS_AJUDA, null] },
    tom: { type: "string", enum: [...TONS] },
    reclama_repeticao: { type: "boolean" },
    confianca: { type: "number" },
  },
} as const;

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const digitos = (s: string) => s.replace(/\D/g, "");

const NUMERICOS = new Set(["numero_contrato", "cpf", "renda", "agencia", "conta", "matricula", "cep", "numero_casa"]);

// O dado está na mensagem e passa no validador do seu tipo?
export function dadoConfere(d: DadoInterpretado, mensagem: string, agora: Date): boolean {
  const m = norm(mensagem);
  const ev = norm(d.evidencia);
  if (!ev || !m.includes(ev)) return false; // a evidência precisa ser trecho literal da mensagem
  if (NUMERICOS.has(d.campo)) {
    const v = digitos(d.valor);
    if (!v || !digitos(d.evidencia).includes(v) || !digitos(mensagem).includes(v)) return false;
  } else {
    const v = norm(d.valor);
    if (!v || !(ev.includes(v) || v.includes(ev))) return false;
  }
  switch (d.campo) {
    case "numero_contrato": {
      const n = digitos(d.valor);
      return n.length >= 5 && n.length <= 30;
    }
    case "cpf":
      return cpfValido(digitos(d.valor));
    case "data_nascimento": {
      const datas = datasNoTexto(d.evidencia, agora).filter((x) => idadeEm(x.iso, agora) >= 18 && idadeEm(x.iso, agora) <= 100);
      return datas.length > 0;
    }
    case "renda": {
      const n = Number(String(d.valor).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      return Number.isFinite(n) && n >= 100 && n <= 100_000;
    }
    default:
      return true;
  }
}

export interface Conferida {
  interpretacao: Interpretacao;
  descartados: number;
}

// JSON do modelo (já no formato do schema) -> Interpretacao conferida. Lança se o formato
// não bate: quem chama trata como falha do modelo.
export function conferirInterpretacao(bruto: unknown, mensagem: string, agora: Date): Conferida {
  const z1 = InterpretacaoZod.parse(bruto);
  const dados: DadoInterpretado[] = [];
  let descartados = 0;
  for (const d of z1.dados) {
    if (dadoConfere(d, mensagem, agora)) dados.push(d);
    else descartados++;
  }
  return {
    descartados,
    interpretacao: {
      intencao: z1.intencao,
      secundarias: z1.secundarias,
      respondeuPerguntaPendente: z1.respondeu_pergunta_pendente,
      dados,
      topicoAjuda: z1.topico_ajuda === "outro" ? null : z1.topico_ajuda,
      tom: z1.tom,
      reclamaRepeticao: z1.reclama_repeticao,
      confianca: Math.min(1, Math.max(0, z1.confianca)),
    },
  };
}
