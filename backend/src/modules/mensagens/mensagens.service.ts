import type { RemetenteTipo, StatusEntrega } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

const INCLUDE_RESPOSTA = {
  operador: { select: { id: true, nome: true } },
  respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
} as const;

export async function listMensagensPorConversa(conversaId: string) {
  return prisma.mensagem.findMany({
    where: { conversaId },
    orderBy: { timestamp: "asc" },
    include: INCLUDE_RESPOSTA,
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
  statusEntrega?: StatusEntrega | null;
  loteId?: string | null;
  templateNome?: string | null;
  respondeAId?: string | null;
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
    include: INCLUDE_RESPOSTA,
  });

  await prisma.conversa.update({
    where: { id: input.conversaId },
    data: { lastMessageAt: mensagem.timestamp },
  });

  return mensagem;
}
