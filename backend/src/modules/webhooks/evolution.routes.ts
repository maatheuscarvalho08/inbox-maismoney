import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import { findOrCreateConversaAberta, marcarConversaRespondida } from "../conversas/conversas.service.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { emitConversaAtualizada, emitInstanciaAtualizada, emitNovaMensagem } from "../../ws/events.js";

const router = Router();

/**
 * Formato de payload segue a convenção Evolution API / Baileys (messages.upsert,
 * connection.update). A Evolution API tem variações entre versões — este parser
 * cobre os campos mais comuns e ignora silenciosamente o que não reconhece,
 * já que webhooks devem sempre responder 200 rápido.
 */
router.post(
  "/evolution",
  asyncHandler(async (req, res) => {
    try {
      const { event, instance, data } = req.body ?? {};

      if (event === "connection.update") {
        const status = data?.state === "open" ? "conectado" : "desconectado";
        const instancia = await prisma.instancia.findFirst({ where: { evolutionInstanceId: instance } });
        if (instancia) {
          const atualizada = await prisma.instancia.update({ where: { id: instancia.id }, data: { status } });
          emitInstanciaAtualizada(atualizada);
        }
      }

      if (event === "messages.upsert") {
        const msg = data;
        const fromMe = msg?.key?.fromMe;
        const remoteJid: string | undefined = msg?.key?.remoteJid;

        if (!fromMe && remoteJid && !remoteJid.endsWith("@g.us")) {
          const numero = remoteJid.split("@")[0];
          const texto: string | undefined =
            msg?.message?.conversation ??
            msg?.message?.extendedTextMessage?.text ??
            msg?.message?.imageMessage?.caption ??
            msg?.message?.videoMessage?.caption;

          const instanciaDb = await prisma.instancia.findFirst({ where: { evolutionInstanceId: instance } });

          if (instanciaDb && (texto || msg?.message)) {
            const contato = await findOrCreateContato(numero, msg?.pushName);
            const conversa = await findOrCreateConversaAberta(instanciaDb.id, contato.id);
            // Resposta do cliente tira a conversa da aba "Disparos" (se veio de lá) sem
            // apagar a etiqueta azul de origem — ver conversas.service.ts.
            await marcarConversaRespondida(conversa.id);

            const mensagem = await criarMensagem({
              conversaId: conversa.id,
              remetenteTipo: "cliente",
              conteudoTexto: texto ?? null,
              externalId: msg?.key?.id ?? null,
              timestamp: msg?.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : undefined,
            });

            if (mensagem) {
              const conversaAtualizada = await prisma.conversa.findUnique({
                where: { id: conversa.id },
                include: {
                  contato: true,
                  instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
                  operador: { select: { id: true, nome: true } },
                },
              });

              emitNovaMensagem(mensagem);
              if (conversaAtualizada) emitConversaAtualizada(conversaAtualizada);
            }
          }
        }
      }
    } catch (err) {
      console.error("Erro processando webhook Evolution API:", err);
    }

    // Webhooks devem sempre receber 200 rapidamente, mesmo em caso de payload inesperado.
    res.status(200).json({ ok: true });
  }),
);

export default router;
