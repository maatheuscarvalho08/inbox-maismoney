import type { Contato, Instancia } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { normalizarNumeroBrasileiro } from "../../lib/telefone.js";
import { buscarFotoPerfilEvolution } from "../../integrations/evolutionApi.js";

export async function findOrCreateContato(numeroWhatsapp: string, nome?: string) {
  const numero = normalizarNumeroBrasileiro(numeroWhatsapp);
  return prisma.contato.upsert({
    where: { numeroWhatsapp: numero },
    update: nome ? { nome } : {},
    create: { numeroWhatsapp: numero, nome },
  });
}

const FOTO_TTL_MS = 24 * 60 * 60 * 1000;

// Só existe pra Evolution — a Meta Cloud API não expõe foto de contato por
// privacidade. A URL da Meta/WhatsApp expira, então recacheia depois de 24h.
// Retorna null sem fazer nada se já está em cache ou não é Evolution — quem
// chamar decide se quer aguardar ou disparar sem esperar (fire-and-forget).
export async function garantirFotoContato(contato: Contato, instancia: Instancia): Promise<Contato | null> {
  const jaAtualizada = contato.fotoAtualizadaEm && Date.now() - contato.fotoAtualizadaEm.getTime() < FOTO_TTL_MS;
  if (jaAtualizada || instancia.tipoConexao !== "evolution" || !instancia.evolutionInstanceId) {
    return null;
  }

  const fotoUrl = await buscarFotoPerfilEvolution(instancia.evolutionInstanceId, contato.numeroWhatsapp);
  return prisma.contato.update({
    where: { id: contato.id },
    data: { fotoUrl, fotoAtualizadaEm: new Date() },
  });
}
