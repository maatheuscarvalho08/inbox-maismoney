// Retrato dos textos da Maisa que o cliente lê: mensagens fixas, respostas sociais e os
// textos de reserva do redator em cada situação. Sem rede, sem banco, sem API.
// Uso: npx tsx src/scripts/retratoNaturalidade.ts > retrato.json (antes e depois de mexer).
import { TEXTOS } from "../modules/maisa/textos.js";
import { RESPOSTA_SOCIAL } from "../modules/maisa/mensagens.js";
import { textoReserva, type PlanoMensagem } from "../modules/maisa/conversa/redator.js";
import type { AcaoResposta, Tom } from "../modules/maisa/conversa/tipos.js";

const fixos = [
  "saudacao", "pedeCpf", "cpfInvalido", "pedeNome", "pedeNascimento", "nomeInvalido", "avisoLink", "aindaNaoAutorizou",
  "pedeConsentimento", "perguntaConsentimento", "extratoGuardado", "lembraExtrato", "confirmaAceite", "relembraOferta",
  "confirmacaoRecebida", "inicioContrato", "semPressaConfirmacao", "confirmeComSimOuNao", "naoSeiSeEntendi", "cpfJaAnotado",
  "dataJaAnotada", "dadosCorrigidos", "qualCorrigir", "fotoSemDado", "recusou", "aceitou",
] as const;

const saida: Record<string, string> = {};
for (const k of fixos) {
  const v = (TEXTOS as Record<string, unknown>)[k];
  if (typeof v === "string") saida[`TEXTOS.${k}`] = v;
}
for (const [k, v] of Object.entries(RESPOSTA_SOCIAL)) saida[`RESPOSTA_SOCIAL.${k}`] = v as string;

const acoes: AcaoResposta[] = [
  "continuar_com_orientacao", "explicar_proximo_passo", "explicar_onde_achar", "reformular", "confirmar_ambiguo",
  "responder_duvida", "reconhecer_e_mudar_abordagem", "aproveitar_dado", "alternativa_sem_orientacao", "documento_sem_dado",
];
const tons: Tom[] = ["neutro", "confuso", "irritado", "satisfeito"];
const plano = (acao: AcaoResposta, tom: Tom): PlanoMensagem => ({
  acao, estrategia: "reformular", dadoPedido: "o número do contrato do CEF", pergunta: "Qual o número do contrato do CEF?",
  faltando: ["o número do contrato"], coletados: ["nome", "CPF"], orientacao: null, fatos: ["Na Facta a parcela continua R$ 390,47."], tom, ultimasMaisa: [],
});
for (const a of acoes) for (const t of tons) saida[`reserva.${a}.${t}`] = textoReserva(plano(a, t));

console.log(JSON.stringify(saida, null, 2));
