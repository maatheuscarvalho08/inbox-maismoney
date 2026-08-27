import { prisma } from "../../db/prisma.js";

// Mensagens recebidas de verdade sempre chegam com o código do país (a Meta/Evolution
// mandam o "from" completo). Números vindos de CSV de disparo podem não ter o 55 —
// sem normalizar aqui, o mesmo cliente vira dois contatos/conversas diferentes assim
// que ele responder de verdade.
function normalizarNumeroWhatsapp(numero: string): string {
  const digitos = numero.replace(/\D/g, "");

  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }
  return digitos;
}

export async function findOrCreateContato(numeroWhatsapp: string, nome?: string) {
  const numero = normalizarNumeroWhatsapp(numeroWhatsapp);
  return prisma.contato.upsert({
    where: { numeroWhatsapp: numero },
    update: nome ? { nome } : {},
    create: { numeroWhatsapp: numero, nome },
  });
}
