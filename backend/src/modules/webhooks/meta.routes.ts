import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { verifyMetaSignature } from "../../middleware/verifyMetaSignature.js";
import { env } from "../../config/env.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import { findOrCreateConversaAberta } from "../conversas/conversas.service.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import type { StatusEntrega } from "@prisma/client";

const router = Router();

const STATUS_META_MAP: Record<string, StatusEntrega> = {
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
};
// Impede que um evento fora de ordem (ex.: "delivered" reentregue depois de "read")
// regrida um status já mais avançado.
const STATUS_RANK: Record<StatusEntrega, number> = { enviado: 1, entregue: 2, lido: 3, falhou: 1 };

// Verificação inicial do webhook, exigida pela Meta ao configurar o endpoint.
router.get("/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/**
 * Payload segue o formato oficial da WhatsApp Cloud API (entry[].changes[].value).
 * Trata apenas mensagens de texto recebidas; outros tipos (imagem, áudio, status de
 * entrega) chegam no mesmo webhook e podem ser adicionados aqui depois.
 */
router.post(
  "/meta",
  verifyMetaSignature,
  asyncHandler(async (req, res) => {
    try {
      const entries = req.body?.entry ?? [];

      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
          const mensagens = value?.messages ?? [];
          const statuses = value?.statuses ?? [];
          if (!phoneNumberId || (mensagens.length === 0 && statuses.length === 0)) continue;

          const instanciaDb = await prisma.instancia.findFirst({ where: { metaPhoneNumberId: phoneNumberId } });
          if (!instanciaDb) continue;

          for (const status of statuses) {
            const novoStatus = STATUS_META_MAP[status.status];
            if (!novoStatus || !status.id) continue;

            const mensagem = await prisma.mensagem.findUnique({ where: { externalId: status.id } });
            if (!mensagem) continue;
            if (mensagem.statusEntrega && STATUS_RANK[mensagem.statusEntrega] >= STATUS_RANK[novoStatus]) continue;

            const atualizada = await prisma.mensagem.update({
              where: { id: mensagem.id },
              data: { statusEntrega: novoStatus },
              include: { operador: { select: { id: true, nome: true } } },
            });
            emitNovaMensagem(atualizada);
          }

          for (const msg of mensagens) {
            const numero: string = msg.from;
            const nomeContato: string | undefined = value?.contacts?.[0]?.profile?.name;
            const texto: string | undefined = msg.type === "text" ? msg.text?.body : undefined;

            const contato = await findOrCreateContato(numero, nomeContato);
            const conversa = await findOrCreateConversaAberta(instanciaDb.id, contato.id);

            const mensagem = await criarMensagem({
              conversaId: conversa.id,
              remetenteTipo: "cliente",
              conteudoTexto: texto ?? null,
              externalId: msg.id ?? null,
              timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
            });

            // null = a Meta reentregou um evento que já processamos (externalId duplicado);
            // não emite de novo, já foi tratado da primeira vez.
            if (!mensagem) continue;

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
    } catch (err) {
      console.error("Erro processando webhook Meta Cloud API:", err);
    }

    res.status(200).json({ ok: true });
  }),
);

export default router;
