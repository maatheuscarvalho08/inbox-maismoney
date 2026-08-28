import { prisma } from "../../db/prisma.js";
import { normalizarNumeroBrasileiro } from "../../lib/telefone.js";

export async function findOrCreateContato(numeroWhatsapp: string, nome?: string) {
  const numero = normalizarNumeroBrasileiro(numeroWhatsapp);
  return prisma.contato.upsert({
    where: { numeroWhatsapp: numero },
    update: nome ? { nome } : {},
    create: { numeroWhatsapp: numero, nome },
  });
}
