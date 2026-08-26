import type { RemetenteTipo } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

export async function listMensagensPorConversa(conversaId: string) {
  return prisma.mensagem.findMany({
    where: { conversaId },
    orderBy: { timestamp: "asc" },
    include: { operador: { select: { id: true, nome: true } } },
  });
}

interface CriarMensagemInput {
  conversaId: string;
  remetenteTipo: RemetenteTipo;
  operadorId?: string | null;
  conteudoTexto?: string | null;
  tipoMidia?: string | null;
  midiaPath?: string | null;
  externalId?: string | null;
  timestamp?: Date;
}

// Retorna null se a mensagem já existe (reentrega de webhook) — o chamador deve
// simplesmente não emitir evento nenhum nesse caso, já foi processada da primeira vez.
export async function criarMensagem(input: CriarMensagemInput) {
  if (input.externalId) {
    const existente = await prisma.mensagem.findUnique({ where: { externalId: input.externalId } });
    if (existente) return null;
  }

  const mensagem = await prisma.mensagem.create({
    data: input,
    include: { operador: { select: { id: true, nome: true } } },
  });

  await prisma.conversa.update({
    where: { id: input.conversaId },
    data: { lastMessageAt: mensagem.timestamp },
  });

  return mensagem;
}
