// Monta o texto de fato enviado ao cliente a partir do corpo aprovado na Meta
// (com placeholders {{1}}, {{2}}...) substituindo pelas variáveis do disparo — assim
// o histórico mostra a mensagem real, não só "template X".
export function montarTextoDisparo(nomeTemplate: string, corpo: string | null, variaveis: string[]): string {
  if (!corpo) {
    return `[Disparo · template "${nomeTemplate}"] ${variaveis.join(", ")}`.trim();
  }
  return variaveis.reduce((texto, valor, i) => texto.replaceAll(`{{${i + 1}}}`, valor), corpo);
}
