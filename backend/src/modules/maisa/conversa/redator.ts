// Redator: escreve a mensagem da Maisa a partir de um PLANO (ação, fatos permitidos,
// orientação da base de conhecimento). Não decide nada. A saída do modelo é validada pelo
// código (números só dos fatos, nenhum passo de aplicativo fora da base, nenhuma promessa,
// nenhuma ação "feita", nenhuma repetição). Reprovou ou falhou: texto de reserva determinístico.
import { chamarModeloEstruturado, type MetaChamada } from "./interpretador.js";
import type { AcaoResposta, Estrategia, Tom } from "./tipos.js";

export interface PlanoMensagem {
  acao: AcaoResposta;
  estrategia: Estrategia;
  dadoPedido: string; // "o número do contrato do CEF"
  pergunta: string; // o que a Maisa pediu por último
  faltando: string[];
  coletados: string[];
  orientacao: string | null; // texto aprovado da base de conhecimento
  fatos: string[]; // fatos já simulados que podem ser citados
  tom: Tom;
  ultimasMaisa: string[]; // últimas mensagens da Maisa, para não repetir
}

export interface RedacaoPronta {
  texto: string;
  fonte: "modelo" | "reserva";
  motivoReserva: string | null;
  meta: MetaChamada | null;
}

export interface Redator {
  redigir(plano: PlanoMensagem): Promise<{ texto: string; meta: MetaChamada }>;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const palavras = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const digitosDe = (s: string) => new Set(s.match(/\d+/g) ?? []);

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum++;
  return comum / (a.size + b.size - comum);
}

const NAVEGACAO = /\b(aplicativo|app|menu|botao|clique|clicar|toque|tocar|aba|tela|opcao|site|link|pagina)\b/;

// Devolve o motivo da reprovação, ou null se a mensagem pode ir.
export function validarSaida(texto: string, plano: PlanoMensagem): string | null {
  const t = texto.trim();
  if (t.length < 15) return "curta_demais";
  if (t.length > 520) return "longa_demais";
  const n = norm(t);
  if (/https?:|www\.|@\w+\.\w+|\b\d{4,5}[- ]?\d{4}\b/.test(n)) return "contato_ou_link";
  if (/\b(garant\w*|aprovad\w*|sem juros|juros zero|prometo|com certeza vai)\b/.test(n)) return "promessa";
  if (/\b(anotei|salvei|cadastrei|enviei|corrigi|digitei|criei|ja fiz|ja esta feito)\b/.test(n)) return "diz_que_fez";
  // Passo de aplicativo, menu ou tela só pode aparecer se a base de conhecimento trouxe.
  const aprovado = norm([plano.orientacao ?? "", plano.pergunta].join(" "));
  const citada = n.match(NAVEGACAO)?.[0];
  if (citada && !aprovado.includes(citada)) return "passo_fora_da_base";
  // Número só dos fatos permitidos.
  const permitidos = digitosDe([plano.pergunta, plano.orientacao ?? "", ...plano.fatos, ...plano.faltando, ...plano.coletados, plano.dadoPedido].join(" "));
  for (const d of digitosDe(t)) if (!permitidos.has(d)) return "numero_fora_dos_fatos";
  // Não repete a Maisa.
  const p = palavras(t);
  for (const antes of plano.ultimasMaisa) if (jaccard(p, palavras(antes)) >= 0.8) return "repete_mensagem_anterior";
  return null;
}

const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}` : (xs[0] ?? ""));

// Texto de reserva: poucas peças curtas, uma por ação. Nunca inventa nada.
export function textoReserva(p: PlanoMensagem): string {
  const orient = p.orientacao ? ` ${p.orientacao}` : "";
  const avisoEquipe = " Se preferir, é só pedir que um atendente da nossa equipe te ajuda.";
  switch (p.acao) {
    case "continuar_com_orientacao":
      return `Ótimo! Quando você conseguir ${p.dadoPedido}, é só me mandar por aqui.${orient} Se não souber onde achar, me avisa que eu te ajudo.`;
    case "explicar_proximo_passo":
      return `Pode deixar, estou aguardando. Do meu lado está tudo pronto: falta só ${p.dadoPedido}.${orient} Pode me mandar por aqui quando tiver.`;
    case "explicar_onde_achar":
      return `Sem problema, eu te ajudo a achar ${p.dadoPedido}.${orient} Conseguiu? Me conta como foi.`;
    case "reformular":
      return `Deixa eu perguntar de outro jeito: ${p.pergunta}`;
    case "confirmar_ambiguo":
      return `Não tenho certeza se entendi o que você quis dizer. Pode me explicar de outro jeito? Eu preciso de ${p.dadoPedido}.`;
    case "responder_duvida":
      return `${p.fatos.join(" ")} Quando puder, me manda ${p.dadoPedido} para eu seguir.`;
    case "reconhecer_e_mudar_abordagem":
      return `Desculpa a confusão, vamos resolver isso. ${p.faltando.length ? `Por enquanto só preciso de: ${lista(p.faltando)}.` : `Eu preciso de ${p.dadoPedido}.`}${avisoEquipe}`;
    case "aproveitar_dado":
      return `Você tem razão, desculpa. Já tenho: ${lista(p.coletados)}.${p.faltando.length ? ` Falta só: ${lista(p.faltando)}.` : ""}`;
    case "alternativa_sem_orientacao":
      return `Ainda não tenho uma instrução segura para te mostrar onde achar ${p.dadoPedido}. Se conseguir encontrar, me manda por aqui.${avisoEquipe}`;
    case "documento_sem_dado":
      return `Recebi o arquivo, mas não consegui achar ${p.dadoPedido} nele. Pode mandar uma foto mais nítida ou digitar por aqui?`;
  }
}

export const INSTRUCOES_REDATOR = `Você escreve UMA mensagem curta de WhatsApp em português simples, como a Maisa, assistente da Mais Money. Tom: acolhedor e direto, sem gírias, sem emojis, sem listas longas.
Você recebe um plano em JSON. Siga a ação e a estratégia do plano.
REGRAS:
- Use SÓ os fatos e a orientação do plano. Não invente números, valores, prazos, taxas, nomes de bancos, passos, telas, menus ou aplicativos.
- Se orientacao for null, NÃO diga onde achar nada. Se faltar orientação, diga com honestidade que não tem essa instrução e ofereça a equipe.
- Nunca diga que anotou, salvou, enviou, corrigiu ou fez algo. Nunca prometa aprovação, valor ou prazo.
- Não repita nenhuma das mensagens em ultimasMaisa: mude a abordagem (explique melhor, dê um exemplo, simplifique).
- Reconheça o que o cliente sentiu quando o tom for confuso ou irritado, em uma frase só.
- Termine dizendo claramente o que o cliente precisa fazer agora.
- Tamanho: até 3 frases.`;

const SCHEMA_REDATOR = {
  type: "object",
  additionalProperties: false,
  required: ["mensagem"],
  properties: { mensagem: { type: "string" } },
} as const;

export function criarRedatorOpenAI(): Redator {
  return {
    async redigir(plano) {
      const r = await chamarModeloEstruturado({ instrucoes: INSTRUCOES_REDATOR, entrada: JSON.stringify(plano), nome: "mensagem", schema: SCHEMA_REDATOR });
      const mensagem = (r.json as { mensagem?: unknown }).mensagem;
      if (typeof mensagem !== "string") throw Object.assign(new Error("schema_invalido"), { meta: r.meta });
      return { texto: mensagem.trim(), meta: r.meta };
    },
  };
}

// Redator só com texto de reserva: usado quando não há redator, nos testes determinísticos
// e quando o modelo falha.
export const redatorReserva: Redator = {
  async redigir(plano) {
    return { texto: textoReserva(plano), meta: { latenciaMs: 0, modelo: null, tokensEntrada: null, tokensSaida: null } };
  },
};

export async function redigir(plano: PlanoMensagem, redator: Redator): Promise<RedacaoPronta> {
  try {
    const r = await redator.redigir(plano);
    const motivo = validarSaida(r.texto, plano);
    if (!motivo) return { texto: r.texto, fonte: r.meta.modelo ? "modelo" : "reserva", motivoReserva: null, meta: r.meta };
    return reserva(plano, motivo, r.meta);
  } catch (err) {
    return reserva(plano, err instanceof Error ? err.message : "erro", (err as { meta?: MetaChamada })?.meta ?? null);
  }
}

function reserva(plano: PlanoMensagem, motivo: string, meta: MetaChamada | null): RedacaoPronta {
  let texto = textoReserva(plano);
  // A reserva também não pode repetir a mensagem anterior: se repetir, muda de abordagem de verdade.
  if (validarSaida(texto, plano) === "repete_mensagem_anterior") {
    texto = `Vou explicar de um jeito mais simples. ${textoReserva({ ...plano, acao: plano.acao === "reformular" ? "alternativa_sem_orientacao" : "reformular" })}`;
  }
  return { texto, fonte: "reserva", motivoReserva: motivo, meta };
}
