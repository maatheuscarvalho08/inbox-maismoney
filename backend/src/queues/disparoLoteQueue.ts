import { Queue, Worker, type Job } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { findOrCreateContato } from "../modules/contatos/contatos.service.js";
import { findOrCreateConversaDisparo } from "../modules/conversas/conversas.service.js";
import { criarMensagem } from "../modules/mensagens/mensagens.service.js";
import { enviarTemplateMeta, mensagemErroMeta } from "../integrations/metaCloudApi.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../ws/events.js";
import { montarTextoDisparo } from "../lib/template.js";
import { normalizarNumeroBrasileiro } from "../lib/telefone.js";

const connection = { url: env.REDIS_URL };

interface LoteDisparoJob {
  loteId: string;
  instanciaId: string;
  templateId: string;
  destinatarios: { numeroWhatsapp: string; numeroWhatsappAlternativo?: string; nomeContato?: string }[];
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
      const { loteId, instanciaId, templateId, destinatarios, variaveis, intervaloMs, operadorId } = job.data;

      const [instancia, template] = await Promise.all([
        prisma.instancia.findUnique({ where: { id: instanciaId } }),
        prisma.template.findUnique({ where: { id: templateId } }),
      ]);
      if (!instancia?.metaPhoneNumberId || !template) {
        console.error("Lote de disparo cancelado: instância ou template inválido", loteId);
        return;
      }

      // O front dedup a lista antes de mandar, mas com uma normalização mais simples
      // (só tira não-dígito, sem completar o "55") — um CSV com o mesmo número
      // escrito como "61991128608" numa linha e "5561991128608" noutra passa
      // batido de lá e vira dois disparos pro mesmo contato aqui. Normaliza igual
      // o resto do sistema (normalizarNumeroBrasileiro) e deduplica de novo, na
      // fonte da verdade, antes de processar — mantendo o primeiro nome visto
      // pra cada número.
      const porNumero = new Map<string, { nomeContato?: string; numeroWhatsappAlternativo?: string }>();
      for (const d of destinatarios) {
        const numero = normalizarNumeroBrasileiro(d.numeroWhatsapp);
        if (!porNumero.has(numero)) {
          porNumero.set(numero, {
            nomeContato: d.nomeContato,
            numeroWhatsappAlternativo: d.numeroWhatsappAlternativo
              ? normalizarNumeroBrasileiro(d.numeroWhatsappAlternativo)
              : undefined,
          });
        }
      }
      const destinatariosUnicos = Array.from(porNumero, ([numeroWhatsapp, dados]) => ({ numeroWhatsapp, ...dados }));
      if (destinatariosUnicos.length < destinatarios.length) {
        console.warn(`Lote ${loteId}: ${destinatarios.length - destinatariosUnicos.length} número(s) duplicado(s) removido(s) antes de disparar`);
      }

      for (let i = 0; i < destinatariosUnicos.length; i++) {
        const { numeroWhatsapp, numeroWhatsappAlternativo, nomeContato } = destinatariosUnicos[i];
        let numeroDestino = numeroWhatsapp;
        let idEnvio: string | undefined;
        let erroEnvio: string | undefined;
        try {
          idEnvio = await enviarTemplateMeta(instancia.metaPhoneNumberId, numeroDestino, template.nome, variaveis, template.idioma);
        } catch (err) {
          erroEnvio = mensagemErroMeta(err);
          console.error(`Falha ao enviar disparo do lote ${loteId} para ${numeroDestino}:`, erroEnvio);

          // Leads de bancos/promotoras às vezes chegam com um segundo WhatsApp
          // cadastrado — se o primeiro número falhar, tenta o alternativo antes
          // de desistir do lead.
          if (numeroWhatsappAlternativo) {
            try {
              idEnvio = await enviarTemplateMeta(
                instancia.metaPhoneNumberId,
                numeroWhatsappAlternativo,
                template.nome,
                variaveis,
                template.idioma,
              );
              numeroDestino = numeroWhatsappAlternativo;
              erroEnvio = undefined;
            } catch (err2) {
              const erroAlternativo = mensagemErroMeta(err2);
              console.error(
                `Falha ao enviar disparo do lote ${loteId} para número alternativo ${numeroWhatsappAlternativo}:`,
                erroAlternativo,
              );
              erroEnvio = `Principal: ${erroEnvio} | Alternativo: ${erroAlternativo}`;
            }
          }
        }

        const contato = await findOrCreateContato(numeroDestino, nomeContato);
        const conversa = await findOrCreateConversaDisparo(instanciaId, contato.id);

        const mensagem = await criarMensagem({
          conversaId: conversa.id,
          remetenteTipo: "operador",
          operadorId,
          conteudoTexto: montarTextoDisparo(template.nome, template.corpo, variaveis),
          templateNome: template.nome,
          externalId: idEnvio ?? null,
          statusEntrega: idEnvio ? "enviado" : "falhou",
          erroEntrega: idEnvio ? null : erroEnvio ?? null,
          loteId,
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

        await job.updateProgress(Math.round(((i + 1) / destinatariosUnicos.length) * 100));

        if (i < destinatariosUnicos.length - 1 && intervaloMs > 0) {
          await aguardar(intervaloMs);
        }
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on("error", (err) => console.error("Erro no worker de disparo em lote:", err));

  return worker;
}
