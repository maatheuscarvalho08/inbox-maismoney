// Garante o código do país (55) em qualquer número de telefone que entra no sistema
// vindo de fonte externa (CSV, formulário) — mensagens recebidas de verdade (Meta/
// Evolution) sempre trazem o "from" completo, então sem isso o mesmo número vira dois
// registros diferentes, ou (no caso do Twilio) um número inválido ao prefixar "+".
export function normalizarNumeroBrasileiro(numero: string): string {
  const digitos = numero.replace(/\D/g, "");

  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }
  return digitos;
}
