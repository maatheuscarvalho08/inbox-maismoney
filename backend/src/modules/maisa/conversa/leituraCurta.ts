// Leitura determinística de mensagens curtas de andamento ("ok", "vou mandar", "estou
// procurando", "pera aí", "depois eu mando"). Vale só quando a Maisa espera um dado ou um
// arquivo: nunca numa confirmação ou decisão, onde "ok" não autoriza nada. Não chama modelo.
import type { Intencao } from "./tipos.js";

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[!.,;]+/g, " ").replace(/\s+/g, " ").trim();

// Dígitos, "?" ou mensagem longa: não é andamento, segue para a leitura normal.
const PAUSA = /\b(depois (eu )?(mando|envio|vejo|te mando|procuro)|mais tarde|amanha (eu )?(mando|envio|vejo)?|quando (eu )?chegar em casa|agora nao (posso|consigo|da)|to (no|na) (trabalho|rua)|estou (no|na) (trabalho|rua)|outra hora|mais tardinha|a noite (eu )?(mando|envio))\b/;
const FAZENDO = /^(so um (momento|minuto|instante|pouquinho)|um (momento|minuto|instante)|pera( ai)?|espera( ai)?|peraí|aguarda( ai)?|aguarde|ja (estou|to|tou) (vendo|procurando|baixando|olhando|entrando|abrindo|pegando)|(estou|to|tou) (vendo|procurando|baixando|olhando|entrando|abrindo|tentando|pegando|tirando)|procurando|baixando|vendo aqui|vou ver aqui|deixa eu (ver|procurar|olhar|pegar|baixar))\b/;
const VAI_FAZER = /^(ok |certo |beleza |blz |ta |tá |ta bom |sim |claro |pode deixar |combinado )?(ja |entao )?(vou|irei|vo|ja vou|vou ja) (mandar|enviar|ver|procurar|baixar|tirar|pegar|tentar|fazer|passar)|^(ja )?(mando|envio) (ja|agora|sim|ja ja)|^(ja )?ja (mando|envio)|^pode deixar\b|^vou providenciar|^agora mesmo/;
const ENTENDEU = /^(ok+|okay|oky|certo|entendi|entendido|beleza|blz|ta bom|tá bom|ta|ok entendi|certo entendi|ok obrigad[oa]|perfeito|show|ok certo|combinado|tudo bem|ta certo|ah ta|ah ok|uhum|aham|sim entendi|👍)$/;
const VOLTOU = /^(voltei|estou de volta|to de volta|tou de volta|oi voltei|cheguei|pronto voltei)$/;

export function leituraCurta(texto: string): Intencao | null {
  const t = norm(texto);
  if (!t || t.length > 80 || /\d|\?/.test(texto)) return null;
  if (PAUSA.test(t)) return "pausa";
  if (VOLTOU.test(t)) return "aguardando_orientacao";
  if (FAZENDO.test(t)) return "fazendo";
  if (VAI_FAZER.test(t)) return "vai_fazer";
  if (ENTENDEU.test(t) || t === "👍") return "entendeu";
  return null;
}
