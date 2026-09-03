import fs from "fs";
import path from "path";
import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import { findOrCreateConversaAberta, marcarConversaRespondida } from "../conversas/conversas.service.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { emitConversaAtualizada, emitInstanciaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { uploadsRoot } from "../../middleware/upload.js";

const router = Router();

// Chave dentro de data.message pra cada tipo de mídia que o Baileys/Evolution manda —
// cada uma carrega { mimetype, caption? } junto com os metadados de mídia de verdade.
const CAMPOS_MIDIA: Record<string, string> = {
  audioMessage: "audio",
  imageMessage: "image",
  videoMessage: "video",
  documentMessage: "document",
  stickerMessage: "sticker",
};

function extensaoDoMime(mime: string) {
  return mime.split("/")[1]?.split(";")[0] || "bin";
}

// Com webhook.base64:true (configurado em criarInstanciaEvolution), a Evolution
// embute o arquivo em base64 como campo irmão do tipo de mensagem dentro de
// data.message — sem isso, mensagem de mídia chegava totalmente vazia (sem
// texto, sem mídia, sem nada visível pro operador).
async function baixarEArmazenarMidiaEvolution(
  conversaId: string,
  tipo: string,
  mimetype: string,
  base64: string,
) {
  const dir = path.join(uploadsRoot, conversaId);
  fs.mkdirSync(dir, { recursive: true });
  const nomeArquivo = `${Date.now()}-whatsapp-${tipo}.${extensaoDoMime(mimetype)}`;
  const caminhoAbsoluto = path.join(dir, nomeArquivo);
  await fs.promises.writeFile(caminhoAbsoluto, Buffer.from(base64, "base64"));
  return { tipoMidia: mimetype, midiaPath: path.relative(process.cwd(), caminhoAbsoluto).replace(/\\/g, "/") };
}

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
          let texto: string | undefined =
            msg?.message?.conversation ??
            msg?.message?.extendedTextMessage?.text ??
            msg?.message?.imageMessage?.caption ??
            msg?.message?.videoMessage?.caption;

          let tipoMidia: string | null = null;
          let midiaPath: string | null = null;

          const instanciaDb = await prisma.instancia.findFirst({ where: { evolutionInstanceId: instance } });

          if (instanciaDb) {
            const contato = await findOrCreateContato(numero, msg?.pushName);
            const conversa = await findOrCreateConversaAberta(instanciaDb.id, contato.id);
            // Resposta do cliente tira a conversa da aba "Disparos" (se veio de lá) sem
            // apagar a etiqueta azul de origem — ver conversas.service.ts.
            await marcarConversaRespondida(conversa.id);

            const chaveMidia = Object.keys(CAMPOS_MIDIA).find((k) => msg?.message?.[k]);
            if (chaveMidia) {
              const tipo = CAMPOS_MIDIA[chaveMidia];
              const infoMidia = msg.message[chaveMidia];
              // Evolution embute o arquivo em base64 como campo irmão dentro de
              // data.message quando webhook.base64:true (ver criarInstanciaEvolution).
              const base64: string | undefined = msg.message.base64;
              if (base64) {
                try {
                  const baixada = await baixarEArmazenarMidiaEvolution(
                    conversa.id,
                    tipo,
                    infoMidia?.mimetype || `${tipo}/bin`,
                    base64,
                  );
                  tipoMidia = baixada.tipoMidia;
                  midiaPath = baixada.midiaPath;
                } catch (err) {
                  console.error("Falha ao salvar mídia recebida da Evolution API:", err);
                }
              } else {
                console.warn("Webhook Evolution: mensagem de mídia sem base64 no payload", JSON.stringify(msg?.message).slice(0, 500));
              }
            }

            // Rede de segurança: qualquer combinação sem texto nem mídia reconhecida
            // virava uma bolha completamente vazia e invisível pro operador.
            if (!texto && !tipoMidia) {
              console.warn("Webhook Evolution: mensagem sem conteúdo reconhecido", JSON.stringify(msg).slice(0, 800));
              texto = "[Mensagem recebida sem conteúdo legível]";
            }

            const mensagem = await criarMensagem({
              conversaId: conversa.id,
              remetenteTipo: "cliente",
              conteudoTexto: texto ?? null,
              tipoMidia,
              midiaPath,
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
