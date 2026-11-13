// Ordem e relevância das mensagens do cliente, para decidir se um "sim" ainda vale.
//
// Ordem: vale o horário do WhatsApp (mensagem.timestamp, gravado pelo webhook a partir
// do messageTimestamp da Evolution ou do timestamp da Meta). Áudio e arquivo podem ser
// gravados no banco depois de um texto mandado mais tarde, porque a mídia é baixada
// antes; o horário do WhatsApp não muda com isso. O horário do WhatsApp vem em
// segundos: duas mensagens no mesmo segundo contam como "depois" uma da outra, o que é
// o lado seguro. Sem horário válido (ausente, no futuro ou muito antes do recebimento),
// vale o horário de recebimento no backend (createdAt).
import { normalizar } from "./classificador.js";
import { mensagemSocial, socialPositivo } from "./mensagens.js";

export interface MensagemOrdenavel {
  id: string;
  timestamp: Date | null;
  createdAt: Date;
}

// O WhatsApp não manda a mensagem depois de o backend receber: acima de 1 minuto (diferença
// de relógio), o horário é inválido e vale o recebimento.
const FUTURO_MAX_MS = 60_000;
const PASSADO_MAX_MS = 2 * 24 * 60 * 60_000;

// Instante em que o cliente mandou a mensagem.
export function instanteEnvio(m: { timestamp: Date | null; createdAt: Date }): Date {
  const t = m.timestamp?.getTime();
  const r = m.createdAt.getTime();
  if (t === undefined || !Number.isFinite(t)) return m.createdAt;
  if (t > r + FUTURO_MAX_MS || t < r - PASSADO_MAX_MS) return m.createdAt;
  return m.timestamp!;
}

// "a" foi mandada depois de "ref", ou no mesmo segundo (lado seguro).
export function mandadaDepoisOuJunto(a: MensagemOrdenavel, ref: MensagemOrdenavel): boolean {
  if (a.id === ref.id) return false;
  return Math.floor(instanteEnvio(a).getTime() / 1000) >= Math.floor(instanteEnvio(ref).getTime() / 1000);
}

// Mensagem que pode mudar a decisão do cliente. Só não é relevante o que é claramente
// neutro: agradecimento, riso, "ok" e emoji positivos. Áudio, foto e arquivo são sempre
// relevantes: o conteúdo só é conhecido depois de processar.
export function mensagemRelevante(m: { conteudoTexto: string | null; tipoMidia: string | null }): boolean {
  if (m.tipoMidia) return true;
  const texto = m.conteudoTexto?.trim();
  if (!texto) return false;
  const s = mensagemSocial(texto);
  if (s === "agradecimento" || s === "riso") return false;
  if (s && socialPositivo(s, texto)) return false;
  return true;
}

// Confirmação pura ("sim", "pode mandar", "confirmo"): repetir o "sim" não desfaz o "sim".
const CONFIRMACAO_PURA = /^(sim+|s|ss|sim sim|pode (mandar|seguir|fazer)|confirmo|confirmado|isso mesmo|correto|tudo certo|ta tudo certo|esta tudo certo|certinho|confere)[\s.!]*$/;

// Mensagem que tira a validade de um "sim" anterior (e invalida uma digitação ainda antes
// do ponto sem volta): relevante e não é outra confirmação pura.
export function invalidaConfirmacao(m: { conteudoTexto: string | null; tipoMidia: string | null }): boolean {
  if (!mensagemRelevante(m)) return false;
  if (!m.tipoMidia && m.conteudoTexto && CONFIRMACAO_PURA.test(normalizar(m.conteudoTexto))) return false;
  return true;
}
