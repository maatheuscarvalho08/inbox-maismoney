import type { StatusConversa } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

const INCLUDE_PADRAO = {
  contato: true,
  instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true, status: true } },
  operador: { select: { id: true, nome: true } },
  etiquetas: { include: { etiqueta: true } },
} as const;

export async function listConversas(status?: StatusConversa) {
  return prisma.conversa.findMany({
    where: status ? { status } : undefined,
    orderBy: { lastMessageAt: "desc" },
    include: {
      ...INCLUDE_PADRAO,
      mensagens: { take: 1, orderBy: { timestamp: "desc" } },
    },
  });
}

export async function getConversaById(id: string) {
  return prisma.conversa.findUnique({
    where: { id },
    include: INCLUDE_PADRAO,
  });
}

export async function atualizarConversa(
  id: string,
  data: { status?: StatusConversa; operadorId?: string | null },
) {
  return prisma.conversa.update({
    where: { id },
    data,
    include: INCLUDE_PADRAO,
  });
}

export async function findOrCreateConversaAberta(instanciaId: string, contatoId: string) {
  const existente = await prisma.conversa.findFirst({
    where: { instanciaId, contatoId, status: { not: "encerrada" } },
    orderBy: { createdAt: "desc" },
  });
  if (existente) return existente;

  return prisma.conversa.create({
    data: { instanciaId, contatoId, status: "aberta" },
  });
}

export async function adicionarEtiqueta(conversaId: string, etiquetaId: string) {
  await prisma.conversaEtiqueta.upsert({
    where: { conversaId_etiquetaId: { conversaId, etiquetaId } },
    update: {},
    create: { conversaId, etiquetaId },
  });
  return getConversaById(conversaId);
}

export async function removerEtiqueta(conversaId: string, etiquetaId: string) {
  await prisma.conversaEtiqueta.deleteMany({ where: { conversaId, etiquetaId } });
  return getConversaById(conversaId);
}
