// Cliente que quer deixar para depois ("vou deixar para janeiro", "quando eu tiver margem"): a Maisa pede o
// dia, anota e a equipe é avisada no inbox quando a data chegar.
import { normalizar } from "./classificador.js";

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_RE = MESES.join("|");

// O cliente está adiando o contato. Texto já normalizado (sem acento, minúsculo). Perguntas ficam de fora.
export const QUER_ADIAR = new RegExp(
  [
    `\\bdeix(a|o|ar|ando)( isso| ela| ele| tudo| o resto)? (pra|para|pro) (depois|mais tarde|(${MES_RE})|o proximo mes|o mes que vem|a semana que vem|o ano que vem|o ano novo)`,
    "\\b(mes|ano|semana) que vem\\b",
    "\\bproximo mes\\b",
    "\\bproxima semana\\b",
    "\\bmais pra frente\\b",
    "\\bmais para frente\\b",
    "\\b(me )?(chama|chame|procura|procure|liga|ligue|fala|fale|volta|volte|retorna|retorne|chamar|procurar)( de novo| novamente| la)? (em|no|na|so|apenas|depois|daqui)\\b",
    "\\bso (em|no mes|depois de)\\b",
    "\\bquando (eu )?(tiver|tivermos|liberar|sair|voltar|cair|der)( a| uma| de| o)? (margem|folga|dinheiro|salario|13|decimo)",
    "\\bdepois (das festas|do natal|do ano novo|do carnaval)",
    `\\bem (${MES_RE})\\b`,
    "\\bdaqui (a )?\\d+ (dias?|semanas?|meses|mes)\\b",
  ].join("|"),
);

export function querAdiar(texto: string): boolean {
  if (texto.includes("?")) return false;
  return QUER_ADIAR.test(normalizar(texto));
}

const NUM = (s: string | undefined) => (s ? parseInt(s, 10) : NaN);

// Meio-dia UTC = 9h em Brasília: o aviso aparece quando a equipe começa o dia.
function dia(ano: number, mes0: number, d: number): Date | null {
  const data = new Date(Date.UTC(ano, mes0, d, 12, 0, 0));
  return data.getUTCMonth() === mes0 && data.getUTCDate() === d ? data : null;
}

// Lê o dia combinado. Só o mês: dia 5 ("início"), 15 ("meio") ou 25 ("final"). Sem ano, é a próxima vez que a
// data chega. Devolve null quando não entendeu ou quando a data já passou ou está longe demais (mais de 18 meses).
export function lerDataRetorno(texto: string, agora: Date): Date | null {
  const t = normalizar(texto);
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12, 0, 0);
  const ano = agora.getUTCFullYear();
  const mesHoje = agora.getUTCMonth();
  const aceitar = (d: Date | null): Date | null => (d && d.getTime() > hoje && d.getTime() <= hoje + 548 * 86_400_000 ? d : null);
  const proxima = (mes0: number, d: number): Date | null => aceitar(dia(ano, mes0, d)) ?? aceitar(dia(ano + 1, mes0, d));

  const dm = t.match(/\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?\b/);
  if (dm) {
    const d = NUM(dm[1]);
    const m = NUM(dm[2]) - 1;
    if (dm[3]) return aceitar(dia(dm[3].length === 2 ? 2000 + NUM(dm[3]) : NUM(dm[3]), m, d));
    return proxima(m, d);
  }

  const mes = t.match(new RegExp(`\\b(${MES_RE})\\b`));
  if (mes) {
    const m = MESES.indexOf(mes[1]);
    const dd = t.match(/\bdia (\d{1,2})\b/);
    const d = dd ? NUM(dd[1]) : /\b(final|fim)\b/.test(t) ? 25 : /\b(meio|metade)\b/.test(t) ? 15 : 5;
    return proxima(m, d);
  }

  const diaSo = t.match(/\bdia (\d{1,2})\b/);
  if (diaSo) {
    const d = NUM(diaSo[1]);
    return aceitar(dia(ano, mesHoje, d)) ?? aceitar(dia(mesHoje === 11 ? ano + 1 : ano, (mesHoje + 1) % 12, d));
  }

  const daqui = t.match(/\bdaqui (?:a )?(\d{1,3}) (dias?|semanas?|meses|mes)\b/);
  if (daqui) {
    const n = NUM(daqui[1]);
    const dias = daqui[2].startsWith("dia") ? n : daqui[2].startsWith("semana") ? n * 7 : n * 30;
    return aceitar(new Date(hoje + dias * 86_400_000));
  }
  if (/\b(semana que vem|proxima semana)\b/.test(t)) return aceitar(new Date(hoje + 7 * 86_400_000));
  if (/\b(mes que vem|proximo mes)\b/.test(t)) return proxima((mesHoje + 1) % 12, 5);
  if (/\b(ano que vem|ano novo|depois das festas|depois do natal)\b/.test(t)) return aceitar(dia(ano + 1, 0, 5));
  if (/\bdepois do carnaval\b/.test(t)) return proxima(1, 20);
  return null;
}

export const dataCurta = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
