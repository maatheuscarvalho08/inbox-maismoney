import type { StatusConversa } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

const INCLUDE_PADRAO = {
  contato: true,
  instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true, status: true } },
  operador: { select: { id: true, nome: true } },
  etiquetas: { include: { etiqueta: true } },
} as const;

export async function listConversas(status?: StatusConversa, aba?: "atendimento" | "disparos") {
  return prisma.conversa.findMany({
    // "disparos" = nasceu de um disparo e o lead ainda não respondeu — some dessa aba
    // assim que chega a primeira resposta (ver evolutionWebhook/metaWebhook marcando
    // respondida:true). "atendimento" é tudo o resto, pra não poluir com disparo em massa.
    where: {
      ...(status ? { status } : {}),
      ...(aba === "disparos" ? { origemDisparo: true, respondida: false } : {}),
      ...(aba === "atendimento" ? { OR: [{ origemDisparo: false }, { respondida: true }] } : {}),
    },
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

// Usado só pelo módulo de disparos — se a conversa já existe (já é atendimento em
// andamento, por exemplo), não mexe em origemDisparo/respondida, só reaproveita.
export async function findOrCreateConversaDisparo(instanciaId: string, contatoId: string) {
  const existente = await prisma.conversa.findFirst({
    where: { instanciaId, contatoId, status: { not: "encerrada" } },
    orderBy: { createdAt: "desc" },
  });
  if (existente) return existente;

  return prisma.conversa.create({
    data: { instanciaId, contatoId, status: "aberta", origemDisparo: true, respondida: false },
  });
}

// Chamado quando chega uma mensagem do cliente — tira a conversa da aba "Disparos"
// (se ela estava lá) sem apagar a etiqueta azul de origem.
export async function marcarConversaRespondida(conversaId: string) {
  await prisma.conversa.update({ where: { id: conversaId }, data: { respondida: true } });
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
