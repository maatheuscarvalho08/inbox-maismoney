// Cliente que diz que quer seguir depois de a conversa sair da Maisa (foi para o
// Carrinho, recusou e voltou atrás, ou passou para a equipe). A Maisa não faz nada
// sozinha: só avisa a equipe, que decide.
import { NAO_QUERO, SIM_FORTE, normalizar } from "./classificador.js";

const ACEITE_DIRETO = /^(sim+|s|ss|quero|quero sim|aceito|pode (fazer|seguir|mandar)|bora|fechado|fechou|vamos|vamos sim|topo)\b/;
const VOLTOU_ATRAS = /(pensando bem|mudei de ideia|reconsiderei|pensei melhor|decidi|resolvi)/;
const QUER = /\b(quero|aceito|vamos|pode (fazer|seguir)|topo|fazer sim|fechar|seguir)\b/;

export function ehAceiteTardio(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = normalizar(texto);
  if (!t || t.includes("?")) return false;
  if (NAO_QUERO.test(t) || /\bnao\s*[.!]*$/.test(t)) return false;
  if (VOLTOU_ATRAS.test(t) && QUER.test(t)) return true;
  return ACEITE_DIRETO.test(t) || SIM_FORTE.test(t);
}

// Um aviso por conversa a cada 6 horas, para a equipe não receber um por mensagem.
export const INTERVALO_AVISO_ACEITE_MS = 6 * 60 * 60_000;
