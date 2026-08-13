import { prisma } from "../../db/prisma.js";

export async function findOrCreateContato(numeroWhatsapp: string, nome?: string) {
  return prisma.contato.upsert({
    where: { numeroWhatsapp },
    update: nome ? { nome } : {},
    create: { numeroWhatsapp, nome },
  });
}
