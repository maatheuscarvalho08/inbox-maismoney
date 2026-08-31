import fs from "fs";
import path from "path";
import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { verifyMetaSignature } from "../../middleware/verifyMetaSignature.js";
import { env } from "../../config/env.js";
import { uploadsRoot } from "../../middleware/upload.js";
import { baixarMidiaMeta } from "../../integrations/metaCloudApi.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import { findOrCreateConversaAberta, marcarConversaRespondida } from "../conversas/conversas.service.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import type { StatusEntrega } from "@prisma/client";

const router = Router();

const TIPOS_COM_MIDIA = ["image", "audio", "video", "document", "sticker"];

function extensaoDoMime(mime: string) {
  return mime.split("/")[1]?.split(";")[0] || "bin";
}

// Mensagem de mídia do cliente só traz um media id no webhook, não o arquivo — é
// preciso baixar da Meta e salvar localmente, igual mídia enviada pelo operador,
// senão a mensagem chega vazia (sem texto, sem mídia, sem nada visível).
async function baixarEArmazenarMidia(conversaId: string, tipo: string, mediaId: string) {
  const { buffer, mimetype } = await baixarMidiaMeta(mediaId);
  const dir = path.join(uploadsRoot, conversaId);
  fs.mkdirSync(dir, { recursive: true });
  const nomeArquivo = `${Date.now()}-whatsapp-${tipo}.${extensaoDoMime(mimetype)}`;
  const caminhoAbsoluto = path.join(dir, nomeArquivo);
  await fs.promises.writeFile(caminhoAbsoluto, buffer);
  return { tipoMidia: mimetype, midiaPath: path.relative(process.cwd(), caminhoAbsoluto).replace(/\\/g, "/") };
}

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
 * Trata texto e mídia (imagem/áudio/vídeo/documento/figurinha) recebidos, além de
 * status de entrega. Outros tipos (localização, contato, resposta interativa,
 * reação) ainda não têm tratamento dedicado — ficam registrados como texto genérico.
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
            // "falhou" precisa sempre passar, mesmo chegando depois de "enviado" — é o caso
            // real que travava aqui: mesmo rank (1) fazia esse evento ser descartado como
            // "regressão", deixando a mensagem presa em "enviado" para sempre.
            if (
              novoStatus !== "falhou" &&
              mensagem.statusEntrega &&
              STATUS_RANK[mensagem.statusEntrega] >= STATUS_RANK[novoStatus]
            ) {
              continue;
            }

            const erro = status.errors?.[0];
            if (novoStatus === "falhou" && erro) {
              console.error(`Falha de entrega reportada pela Meta (mensagem ${mensagem.id}): ${erro.title ?? erro.message ?? JSON.stringify(erro)}`);
            }

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

            const contato = await findOrCreateContato(numero, nomeContato);
            const conversa = await findOrCreateConversaAberta(instanciaDb.id, contato.id);
            // Resposta do cliente tira a conversa da aba "Disparos" (se veio de lá) sem
            // apagar a etiqueta azul de origem — ver conversas.service.ts.
            await marcarConversaRespondida(conversa.id);

            let texto: string | undefined;
            let tipoMidia: string | null = null;
            let midiaPath: string | null = null;

            if (msg.type === "text") {
              texto = msg.text?.body;
            } else if (TIPOS_COM_MIDIA.includes(msg.type)) {
              const midiaInfo = msg[msg.type as keyof typeof msg] as { id?: string; caption?: string } | undefined;
              texto = midiaInfo?.caption;
              if (midiaInfo?.id) {
                try {
                  const baixada = await baixarEArmazenarMidia(conversa.id, msg.type, midiaInfo.id);
                  tipoMidia = baixada.tipoMidia;
                  midiaPath = baixada.midiaPath;
                } catch (err) {
                  console.error("Falha ao baixar mídia recebida da Meta:", err);
                  texto = texto ?? "[Mídia recebida, mas não foi possível baixar a tempo]";
                }
              }
            } else if (msg.type === "button") {
              // Resposta a um botão de template HSM (quick reply) — o texto do botão
              // clicado vem em button.text, não em text.body.
              texto = msg.button?.text;
            } else if (msg.type === "interactive") {
              // Resposta a lista/botão interativo (fluxo mais novo da Cloud API).
              texto = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title;
            } else if (msg.type === "unsupported") {
              // A Meta manda esse tipo pra mensagens que o Cloud API não consegue
              // processar (enquete, mídia "visualização única", reação a mensagem
              // antiga, etc.) — ela mesma explica o motivo em msg.errors.
              const motivo = msg.errors?.[0]?.title || msg.errors?.[0]?.message;
              texto = motivo
                ? `[Mensagem não suportada pelo WhatsApp: ${motivo}]`
                : `[Mensagem não suportada pelo WhatsApp — tipo não identificado pela Meta]`;
              console.warn("Webhook Meta: mensagem 'unsupported' recebida", JSON.stringify(msg));
            } else {
              // Localização, contato, resposta interativa, etc. — ainda sem
              // tratamento dedicado, mas pelo menos fica visível que algo chegou.
              texto = `[Mensagem do tipo "${msg.type}" ainda não suportada]`;
            }

            const mensagem = await criarMensagem({
              conversaId: conversa.id,
              remetenteTipo: "cliente",
              conteudoTexto: texto ?? null,
              tipoMidia,
              midiaPath,
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
