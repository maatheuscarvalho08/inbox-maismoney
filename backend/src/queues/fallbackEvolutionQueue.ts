import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { findOrCreateConversaDisparo } from "../modules/conversas/conversas.service.js";
import { criarMensagem } from "../modules/mensagens/mensagens.service.js";
import { enviarTextoEvolution, mensagemErroEvolution } from "../integrations/evolutionApi.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../ws/events.js";

const connection = { url: env.REDIS_URL };

interface FallbackJob {
  mensagemOriginalId: string;
}

// Pedido do dono do negócio: disparo que falha por "healthy ecosystem engagement"
// (bloqueio de reputação da Meta, não número inválido) é reenviado como mensagem
// de WhatsApp normal por um dos dois números de atendimento (Evolution), pra não
// perder o lead. A conversa nasce marcada como disparo (findOrCreateConversaDisparo),
// então já ganha a etiqueta azul automaticamente.
export const fallbackEvolutionQueue = new Queue<FallbackJob>("fallback-evolution", { connection });

const INTERVALO_MS = 2 * 60 * 1000;

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let worker: Worker<FallbackJob> | undefined;
let proximoIndice = 0;

// Concorrência 1 + espera no fim de cada job = os reenvios saem espaçados de 2min
// entre si, na ordem em que os disparos foram falhando — não é 2min por job isolado,
// é 2min entre um envio e o próximo desse canal de fallback.
export function startFallbackEvolutionWorker() {
  if (worker) return worker;

  worker = new Worker<FallbackJob>(
    "fallback-evolution",
    async (job: Job<FallbackJob>) => {
      const original = await prisma.mensagem.findUnique({
        where: { id: job.data.mensagemOriginalId },
        include: { conversa: { include: { contato: true } } },
      });
      if (!original || !original.conteudoTexto) {
        console.error(`Fallback: mensagem original ${job.data.mensagemOriginalId} não encontrada ou sem texto`);
        return;
      }

      const atendimento = await prisma.instancia.findMany({
        where: { tipoConexao: "evolution" },
        orderBy: { createdAt: "asc" },
      });
      if (atendimento.length === 0) {
        console.error("Fallback: nenhum número de atendimento (Evolution) cadastrado");
        return;
      }

      // Alterna entre os números de atendimento a cada reenvio.
      const instancia = atendimento[proximoIndice % atendimento.length];
      proximoIndice++;

      if (!instancia.evolutionInstanceId) {
        console.error(`Fallback: instância ${instancia.nome} sem evolutionInstanceId`);
        return;
      }

      const numeroDestino = original.conversa.contato.numeroWhatsapp;
      let idEnvio: string | undefined;
      let erroEnvio: string | undefined;
      try {
        idEnvio = await enviarTextoEvolution(instancia.evolutionInstanceId, numeroDestino, original.conteudoTexto);
      } catch (err) {
        erroEnvio = mensagemErroEvolution(err);
        console.error(`Falha no reenvio de fallback pra ${numeroDestino}:`, erroEnvio);
      }

      const contatoId = original.conversa.contatoId;
      const conversa = await findOrCreateConversaDisparo(instancia.id, contatoId);

      const mensagem = await criarMensagem({
        conversaId: conversa.id,
        remetenteTipo: "operador",
        conteudoTexto: original.conteudoTexto,
        templateNome: original.templateNome,
        externalId: idEnvio ?? null,
        statusEntrega: idEnvio ? "enviado" : "falhou",
        erroEntrega: idEnvio ? null : (erroEnvio ?? "Falha no reenvio de fallback"),
      });

      if (mensagem) {
        emitNovaMensagem(mensagem);
        const conversaAtualizada = await prisma.conversa.findUnique({
          where: { id: conversa.id },
          include: {
            contato: true,
            instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
            operador: { select: { id: true, nome: true, fotoPath: true } },
          },
        });
        if (conversaAtualizada) emitConversaAtualizada(conversaAtualizada);
      }

      // Segura o slot até completar os 2min — só então o worker pega o próximo
      // job da fila, garantindo o espaçamento entre reenvios de fallback.
      await aguardar(INTERVALO_MS);
    },
    { connection, concurrency: 1 },
  );

  worker.on("error", (err) => console.error("Erro no worker de fallback Evolution:", err));

  return worker;
}
