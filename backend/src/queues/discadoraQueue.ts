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

export const LIGACOES_SIMULTANEAS = 5;

// Teto de segurança: se o webhook de status do Twilio nunca chegar (rede, falha do
// lado deles), o slot não pode ficar preso pra sempre. Um robocall com gather de 6s
// não passa disso na prática.
const TIMEOUT_LIGACAO_MS = 3 * 60 * 1000;
const INTERVALO_CHECAGEM_MS = 3000;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Segura o slot do worker até a ligação terminar de verdade.
 *
 * discarNumero() só dispara a chamada na API do Twilio e volta em milissegundos — a
 * ligação continua acontecendo depois disso. Sem esperar aqui, "concurrency: 5"
 * limitaria apenas requisições HTTP simultâneas, e uma campanha de 50 números
 * discaria praticamente tudo de uma vez. Esperando o fim, os 5 slots do worker
 * passam a valer 5 ligações simultâneas de fato.
 */
async function aguardarFimDaLigacao(campanhaNumeroId: string) {
  const limite = Date.now() + TIMEOUT_LIGACAO_MS;

  while (Date.now() < limite) {
    await aguardar(INTERVALO_CHECAGEM_MS);

    const atual = await prisma.campanhaNumero.findUnique({
      where: { id: campanhaNumeroId },
      select: { finalizadoEm: true },
    });

    // finalizadoEm é gravado pelo webhook de status só em evento terminal do Twilio.
    if (!atual || atual.finalizadoEm) return;
  }

  console.warn(`Ligação ${campanhaNumeroId} sem status final do Twilio após 3min — liberando o slot.`);
}

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

      let discou = false;
      try {
        const callSid = await discarNumero(numero.numeroWhatsapp, twimlUrl, statusCallbackUrl);
        await prisma.campanhaNumero.update({
          where: { id: numero.id },
          data: { statusLigacao: "discando", twilioCallSid: callSid, iniciadoEm: new Date() },
        });
        discou = true;
      } catch (err) {
        await prisma.campanhaNumero.update({
          where: { id: numero.id },
          data: { statusLigacao: "erro", finalizadoEm: new Date() },
        });
        console.error("Erro ao discar número da campanha:", err);
      }

      await emitirAtualizacaoCampanha(job.data.campanhaId);

      // Mantém o slot ocupado enquanto a ligação acontece — é o que faz o limite de
      // simultâneas valer de verdade (ver aguardarFimDaLigacao).
      if (discou) {
        await aguardarFimDaLigacao(numero.id);
        await emitirAtualizacaoCampanha(job.data.campanhaId);
      }

      const restantes = await prisma.campanhaNumero.count({
        where: { campanhaId: job.data.campanhaId, statusLigacao: { in: ["pendente", "discando"] } },
      });
      if (restantes === 0) {
        await prisma.campanhaDiscadora.update({ where: { id: job.data.campanhaId }, data: { status: "concluida" } });
        await emitirAtualizacaoCampanha(job.data.campanhaId);
      }
    },
    { connection, concurrency: LIGACOES_SIMULTANEAS },
  );

  worker.on("error", (err) => console.error("Erro no worker da discadora:", err));

  return worker;
}
