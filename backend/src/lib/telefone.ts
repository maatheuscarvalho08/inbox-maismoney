// Garante o código do país (55) em qualquer número de telefone que entra no sistema
// vindo de fonte externa (CSV, formulário) — mensagens recebidas de verdade (Meta/
// Evolution) sempre trazem o "from" completo, então sem isso o mesmo número vira dois
// registros diferentes, ou (no caso do Twilio) um número inválido ao prefixar "+".
export function normalizarNumeroBrasileiro(numero: string): string {
  let digitos = numero.replace(/\D/g, "");

  if (digitos.length === 10 || digitos.length === 11) {
    digitos = `55${digitos}`;
  }

  // WhatsApp às vezes entrega/aceita o formato antigo de 12 dígitos
  // (55 + DDD + 8 dígitos), sem o "9" obrigatório em celular desde 2016.
  // Sem completar aqui, o mesmo cliente vira dois contatos diferentes
  // dependendo de qual formato chegou primeiro (webhook Evolution vs.
  // CSV de disparo, por exemplo) — mesmo bug que já existia só na exibição
  // (ver frontend/src/lib/telefone.ts), agora corrigido na origem.
  if (digitos.startsWith("55") && digitos.length === 12 && /^[6-9]/.test(digitos.slice(4))) {
    digitos = `${digitos.slice(0, 4)}9${digitos.slice(4)}`;
  }

  return digitos;
}
