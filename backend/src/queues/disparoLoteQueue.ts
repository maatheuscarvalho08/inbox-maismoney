import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { findOrCreateContato } from "../modules/contatos/contatos.service.js";
import { findOrCreateConversaAberta } from "../modules/conversas/conversas.service.js";
import { criarMensagem } from "../modules/mensagens/mensagens.service.js";
import { enviarTemplateMeta, mensagemErroMeta } from "../integrations/metaCloudApi.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../ws/events.js";
import { montarTextoDisparo } from "../lib/template.js";

const connection = { url: env.REDIS_URL };

interface LoteDisparoJob {
  loteId: string;
  instanciaId: string;
  templateId: string;
  numeros: string[];
  variaveis: string[];
  intervaloMs: number;
  operadorId: string;
}

export const disparoLoteQueue = new Queue<LoteDisparoJob>("disparo-lote", { connection });

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let worker: Worker<LoteDisparoJob> | undefined;

// Roda inteiramente no backend — ao contrário do loop que existia no navegador antes,
// sobrevive a fechar a aba/atualizar a página. Concorrência 1: processa um lote de
// cada vez, respeitando o intervalo entre mensagens dentro dele.
export function startDisparoLoteWorker() {
  if (worker) return worker;

  worker = new Worker<LoteDisparoJob>(
    "disparo-lote",
    async (job: Job<LoteDisparoJob>) => {
      const { loteId, instanciaId, templateId, numeros, variaveis, intervaloMs, operadorId } = job.data;

      const [instancia, template] = await Promise.all([
        prisma.instancia.findUnique({ where: { id: instanciaId } }),
        prisma.template.findUnique({ where: { id: templateId } }),
      ]);
      if (!instancia?.metaPhoneNumberId || !template) {
        console.error("Lote de disparo cancelado: instância ou template inválido", loteId);
        return;
      }

      for (let i = 0; i < numeros.length; i++) {
        const numeroDestino = numeros[i];
        let idEnvio: string | undefined;
        try {
          idEnvio = await enviarTemplateMeta(instancia.metaPhoneNumberId, numeroDestino, template.nome, variaveis, template.idioma);
        } catch (err) {
          console.error(`Falha ao enviar disparo do lote ${loteId} para ${numeroDestino}:`, mensagemErroMeta(err));
        }

        const contato = await findOrCreateContato(numeroDestino);
        const conversa = await findOrCreateConversaAberta(instanciaId, contato.id);

        const mensagem = await criarMensagem({
          conversaId: conversa.id,
          remetenteTipo: "operador",
          operadorId,
          conteudoTexto: montarTextoDisparo(template.nome, template.corpo, variaveis),
          templateNome: template.nome,
          externalId: idEnvio ?? null,
          statusEntrega: idEnvio ? "enviado" : "falhou",
          loteId,
        });

        if (mensagem) {
          emitNovaMensagem(mensagem);
          const conversaAtualizada = await prisma.conversa.findUnique({
            where: { id: conversa.id },
            include: {
              contato: true,
              instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
              operador: { select: { id: true, nome: true } },
            },
          });
          if (conversaAtualizada) emitConversaAtualizada(conversaAtualizada);
        }

        await job.updateProgress(Math.round(((i + 1) / numeros.length) * 100));

        if (i < numeros.length - 1 && intervaloMs > 0) {
          await aguardar(intervaloMs);
        }
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on("error", (err) => console.error("Erro no worker de disparo em lote:", err));

  return worker;
}
