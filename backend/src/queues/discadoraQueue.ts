import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { discarNumero } from "../integrations/twilioClient.js";
import { emitirAtualizacaoCampanha } from "../modules/campanhas/campanhas.service.js";

const connection = { url: env.REDIS_URL };

interface DiscagemJob {
  campanhaNumeroId: string;
  campanhaId: string;
}

export const discadoraQueue = new Queue<DiscagemJob>("discadora", { connection });

export async function enfileirarCampanha(campanhaId: string) {
  const numeros = await prisma.campanhaNumero.findMany({
    where: { campanhaId, statusLigacao: "pendente" },
  });

  await discadoraQueue.addBulk(
    numeros.map((n) => ({
      name: "discar",
      data: { campanhaNumeroId: n.id, campanhaId },
    })),
  );
}

let worker: Worker<DiscagemJob> | undefined;

// Concorrência 5 conforme especificado — o worker também confere o status da campanha
// a cada job (não só ao enfileirar) para respeitar "pausar" sem precisar esvaziar a fila:
// jobs de uma campanha pausada simplesmente não discam, o número fica pendente pra retomar depois.
export function startDiscadoraWorker() {
  if (worker) return worker;

  worker = new Worker<DiscagemJob>(
    "discadora",
    async (job: Job<DiscagemJob>) => {
      const campanha = await prisma.campanhaDiscadora.findUnique({ where: { id: job.data.campanhaId } });
      if (!campanha || campanha.status !== "em_andamento") {
        return;
      }

      const numero = await prisma.campanhaNumero.findUnique({ where: { id: job.data.campanhaNumeroId } });
      if (!numero || numero.statusLigacao !== "pendente") return;

      const twimlUrl = `${env.PUBLIC_API_URL}/webhooks/twilio/voice?campanhaNumeroId=${numero.id}`;
      const statusCallbackUrl = `${env.PUBLIC_API_URL}/webhooks/twilio/status?campanhaNumeroId=${numero.id}`;

      try {
        const callSid = await discarNumero(numero.numeroWhatsapp, twimlUrl, statusCallbackUrl);
        await prisma.campanhaNumero.update({
          where: { id: numero.id },
          data: { statusLigacao: "discando", twilioCallSid: callSid, iniciadoEm: new Date() },
        });
      } catch (err) {
        await prisma.campanhaNumero.update({
          where: { id: numero.id },
          data: { statusLigacao: "erro", finalizadoEm: new Date() },
        });
        console.error("Erro ao discar número da campanha:", err);
      }

      await emitirAtualizacaoCampanha(job.data.campanhaId);

      const restantes = await prisma.campanhaNumero.count({
        where: { campanhaId: job.data.campanhaId, statusLigacao: { in: ["pendente", "discando"] } },
      });
      if (restantes === 0) {
        await prisma.campanhaDiscadora.update({ where: { id: job.data.campanhaId }, data: { status: "concluida" } });
        await emitirAtualizacaoCampanha(job.data.campanhaId);
      }
    },
    { connection, concurrency: 5 },
  );

  worker.on("error", (err) => console.error("Erro no worker da discadora:", err));

  return worker;
}
