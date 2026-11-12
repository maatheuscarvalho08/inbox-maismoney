// Leitura de mensagens que não são resposta à pergunta da etapa: cumprimento, agradecimento,
// "ok", emoji, riso, pedido de desculpa pela demora. Antes, cada uma delas virava
// "Desculpa, não entendi" (ou "Boa pergunta!" na oferta) e contava como erro.
// Também ficam aqui o pedido de explicação, a condição no aceite e as datas.
import { normalizar } from "./classificador.js";

export type Social = "cumprimento" | "agradecimento" | "confirmacao_curta" | "riso" | "emoji" | "atraso" | "reticencias" | "confuso";

const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u;
const EMOJI_POSITIVO = /[👍👌🙏✅🤝😊🙂😀😁]/u;

export function mensagemSocial(texto: string): Social | null {
  const bruto = texto.trim();
  if (!bruto) return null;
  if (SO_EMOJI.test(bruto)) return "emoji";
  const t = normalizar(bruto);
  if (/\d/.test(t)) return null;
  if (/^\?+$/.test(t)) return "confuso";
  if (/^[.!…\s]+$/.test(t)) return "reticencias";
  if (/^(k{2,}|rs+|(ha){2,}|(he){2,}|(hu){2,})[\s.!]*$/.test(t)) return "riso";
  const curta = t.length <= 45;
  if (curta && /^(muito )?(obrigad[oa]|obg|brigad[oa]|valeu|vlw|agradeco|grat[oa])\b/.test(t) && !/\b(mas|quero|sim|nao|pode)\b/.test(t)) return "agradecimento";
  if (curta && /^(oi+|ola|opa|oie|bom dia|boa tarde|boa noite|tudo bem|e ai|eai)\b[\s,!.?]*((tudo bem|td bem|tudo bom|como vai)[\s,!.?]*)?$/.test(t)) return "cumprimento";
  if (
    t.length <= 70 &&
    /(desculp|foi mal|perdao).{0,25}(demora|sumi|atraso)|sem internet|sem sinal|(to|estou|tava|estava) (no trabalho|ocupad|dirigindo|trabalhando)|ja ja (respondo|mando|te respondo|volto)/.test(t) &&
    !/\b(quero|sim|pode|nao quero|aceito)\b/.test(t) &&
    // "estava sem internet. tem troco?": tem pergunta junto, não é só desculpa.
    !t.includes("?")
  ) {
    return "atraso";
  }
  if (/^(ok+|okay|ah ok|blz|beleza|certo|ta|ta bom|ta certo|entendi|ah entendi|agora entendi|entendi sim|show|joia|combinado|uhum|aham|hum+|hmm+|ah+ ta|ah sim|sei|ata)[\s.!]*$/.test(t)) return "confirmacao_curta";
  return null;
}

// "👍" e "ok" depois de um pedido de confirmação contam como sim.
export const socialPositivo = (s: Social | null, texto: string) =>
  s === "confirmacao_curta" || (s === "emoji" && EMOJI_POSITIVO.test(texto));

export const RESPOSTA_SOCIAL: Partial<Record<Social, string>> = {
  cumprimento: "Oi! Tudo bem? 😊",
  agradecimento: "Por nada! 😊",
  atraso: "Sem problema!",
};

// "Não entendi" começa com "não", mas é pedido de explicação. Inclui grafias de áudio.
export const PEDE_EXPLICACAO =
  /\b(n|nao|num|nn)\s*(entendi|intendi|entendo|intendo|compreendi)\b|como assim|me explica|explica (melhor|direito|de novo|isso)|o que (e|significa) isso|como (funciona|e) isso|nao (to|estou) entendendo|quero (saber mais|entender)/;

// Aceite que traz condição ("sim, mas…", "só se…") ou outro valor/prazo ("só 3 mil", "em 48x").
export const CONDICAO = /\b(mas|porem|so se|somente se|se for|desde que|contanto|so que|com a condicao)\b/;
// "mas quero sim", "mas tudo bem, pode fazer": o "mas" não traz condição. Só no fim da frase:
// "sim, mas quero receber em outra conta" continua sendo condição.
const MAS_SIM = /\b(mas|porem) (quero( sim)?|aceito|tudo bem|tudo certo|ta bom|vamos|bora)\b[\s,.!]*(pode (fazer|seguir|mandar)|quero( sim)?)?[\s.!]*$/;
export const temCondicao = (t: string) => CONDICAO.test(t) && !MAS_SIM.test(t);
// Aceite no fim da frase: "não tenho dúvida, quero", "então sim", "tá, sim", "mas quero".
export const ACEITE_NO_FIM = /(^|[,.!;?]\s*|\b(entao|enfim|bom|ta|tudo bem|beleza|mas)\s+)(quero|quero sim|sim+|aceito|pode fazer|pode seguir|vamos|bora|fechado)\s*[.!]*$/;
// Hesitação não é aceite: "pode ser que sim", "talvez", "acho que sim".
export const HESITACAO = /(pode ser que|talvez|acho que (sim|quero)|quem sabe|vou ver|nao sei ainda)/;
// Na port + refin, quer só a portabilidade: oferece a port sem refin, nunca segue com o refin.
export const SEM_REFIN = /(so a portabilidade|sem (o )?troco|sem refin|nao quero (o )?(troco|refin)|sem refinanciar|nao quero refinanciar)/;
export const OUTRO_VALOR =
  /(\b\d+[.,]?\d*\s*(mil|k)\b|r\$\s?\d|\bmetade\b|\bmenos dinheiro\b|\bmais dinheiro\b|\b\d{1,3}\s*(x|vezes|parcelas|meses)\b|\bem \d{1,3}\b|\b\d+ (reais|conto)\b)/;
export const RECOMECAR = /(comecar de novo|recomecar|do zero|refazer|outra simulacao|comecar tudo)/;
// "o cpf certo é…", "a data correta é…": correção, mesmo com o nome do dado no meio.
export const CORRECAO = /\b(errei|errado|errada|corrig|na verdade|alias|o certo|a certa|o correto|a correta|me enganei|nao e (esse|essa)|cert[oa] (e|eh)|corret[oa] (e|eh))\b/;

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6,
  jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12,
};

// Todas as datas do texto, na ordem em que aparecem: dd/mm/aaaa (barra, ponto, traço ou
// espaço), ddmmaaaa, ddmmaa, aaaa-mm-dd e "15 de março de 1958". Ano de 2 dígitos vira 19xx
// ou 20xx. Não confere idade nem se a data existe: isso é com quem chama.
export function datasNoTexto(texto: string, agora: Date): { iso: string; pos: number }[] {
  const t = normalizar(texto);
  const achadas: { d: number; m: number; a: string; pos: number }[] = [];
  const add = (d: string, m: number | string, a: string, pos: number) => achadas.push({ d: Number(d), m: Number(m), a, pos });
  for (const x of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(x[3], x[2], x[1], x.index!);
  for (const x of t.matchAll(/\b(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4}|\d{2})\b/g)) {
    if (!achadas.some((a) => Math.abs(a.pos - x.index!) < 3)) add(x[1], x[2], x[3], x.index!);
  }
  for (const x of t.matchAll(/(?<![\d/.\-])\b(\d{2})(\d{2})(\d{4}|\d{2})\b(?![\d/.\-])/g)) add(x[1], x[2], x[3], x.index!);
  for (const x of t.matchAll(/\b(\d{1,2})\s*(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(?:de\s+)?(\d{4}|\d{2})\b/g)) {
    add(x[1], MESES[x[2]], x[3], x.index!);
  }
  return achadas
    .sort((a, b) => a.pos - b.pos)
    .map(({ d, m, a, pos }) => {
      let ano = Number(a);
      if (a.length === 2) ano += ano > agora.getFullYear() % 100 ? 1900 : 2000;
      const data = new Date(Date.UTC(ano, m - 1, d));
      if (data.getUTCDate() !== d || data.getUTCMonth() !== m - 1) return null;
      return { iso: data.toISOString().slice(0, 10), pos };
    })
    .filter((x): x is { iso: string; pos: number } => x !== null);
}

export function idadeEm(iso: string, agora: Date): number {
  return (agora.getTime() - new Date(iso).getTime()) / (365.25 * 24 * 60 * 60_000);
}
