import fs from "fs";
import path from "path";
import cron from "node-cron";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export async function limparMidiaExpirada() {
  const limite = new Date();
  limite.setDate(limite.getDate() - env.MEDIA_RETENTION_DIAS);

  const conversasInativas = await prisma.conversa.findMany({
    where: { lastMessageAt: { lt: limite } },
    select: { id: true },
  });

  if (conversasInativas.length === 0) {
    return { conversas: 0, arquivos: 0 };
  }

  const mensagensComMidia = await prisma.mensagem.findMany({
    where: {
      conversaId: { in: conversasInativas.map((c) => c.id) },
      midiaPath: { not: null },
      midiaDeleted: false,
    },
  });

  let arquivosRemovidos = 0;
  for (const mensagem of mensagensComMidia) {
    if (mensagem.midiaPath) {
      const absPath = path.resolve(process.cwd(), mensagem.midiaPath);
      try {
        await fs.promises.unlink(absPath);
        arquivosRemovidos++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`Falha ao remover mídia ${absPath}:`, err);
        }
      }
    }
  }

  await prisma.mensagem.updateMany({
    where: { id: { in: mensagensComMidia.map((m) => m.id) } },
    data: { midiaDeleted: true, midiaPath: null },
  });

  return { conversas: conversasInativas.length, arquivos: arquivosRemovidos };
}

export function startMediaCleanupJob() {
  // Roda todo dia às 03:00 — horário de baixo uso, evita concorrência com atendimento.
  cron.schedule("0 3 * * *", async () => {
    try {
      const resultado = await limparMidiaExpirada();
      console.log(`Limpeza de mídia: ${resultado.arquivos} arquivo(s) removido(s) de ${resultado.conversas} conversa(s) inativa(s).`);
    } catch (err) {
      console.error("Erro no job de limpeza de mídia:", err);
    }
  });
}
