import path from "path";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { upload } from "../../middleware/upload.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { assinarMidia } from "../../lib/signedUrl.js";
import { criarMensagem, listMensagensPorConversa } from "./mensagens.service.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { enviarMidiaEvolution, enviarTextoEvolution } from "../../integrations/evolutionApi.js";
import { enviarMidiaMeta, enviarTextoMeta } from "../../integrations/metaCloudApi.js";

const router = Router();
router.use(authenticate);

type TipoMidiaWhatsapp = "image" | "audio" | "video" | "document";

function tipoMidiaWhatsapp(mimetype: string): TipoMidiaWhatsapp {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype.startsWith("video/")) return "video";
  return "document";
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversaId = req.query.conversaId;
    if (typeof conversaId !== "string") {
      return res.status(400).json({ error: "conversaId é obrigatório" });
    }
    const mensagens = await listMensagensPorConversa(conversaId);
    res.json({ mensagens });
  }),
);

const enviarSchema = z.object({
  conversaId: z.string().uuid(),
  conteudoTexto: z.string().trim().min(1).optional(),
  audioGravado: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

router.post(
  "/",
  upload.single("midia"),
  asyncHandler(async (req, res) => {
    const parsed = enviarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }
    if (!parsed.data.conteudoTexto && !req.file) {
      return res.status(400).json({ error: "Envie um texto ou um arquivo de mídia" });
    }

    const { conversaId, conteudoTexto, audioGravado } = parsed.data;

    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      include: { contato: true, instancia: true },
    });
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    const midiaPath = req.file ? path.relative(process.cwd(), req.file.path).replace(/\\/g, "/") : null;
    const tipoMidia = req.file?.mimetype ?? null;

    // Mensagem de operador nunca carrega externalId, então criarMensagem nunca
    // retorna null aqui (isso só acontece pra reentrega de webhook).
    const mensagem = await criarMensagem({
      conversaId,
      remetenteTipo: "operador",
      operadorId: req.user!.id,
      conteudoTexto: conteudoTexto ?? null,
      tipoMidia,
      midiaPath,
    });
    if (!mensagem) {
      return res.status(500).json({ error: "Erro inesperado ao criar mensagem" });
    }

    let entregue = false;
    let erroEntrega: string | undefined;

    try {
      if (req.file) {
        // Mídia (e legenda, se houver) viajam juntas numa mensagem só — igual ao
        // comportamento normal do WhatsApp ao anexar arquivo com texto.
        const tipo = tipoMidiaWhatsapp(req.file.mimetype);
        const { exp, sig } = assinarMidia(mensagem.id, 600);
        const link = `${env.PUBLIC_API_URL}/midia/${mensagem.id}?exp=${exp}&sig=${sig}`;

        if (conversa.instancia.tipoConexao === "evolution" && conversa.instancia.evolutionInstanceId) {
          await enviarMidiaEvolution(conversa.instancia.evolutionInstanceId, conversa.contato.numeroWhatsapp, link, tipo, conteudoTexto);
          entregue = true;
        } else if (conversa.instancia.tipoConexao === "meta_cloud" && conversa.instancia.metaPhoneNumberId) {
          await enviarMidiaMeta(conversa.instancia.metaPhoneNumberId, conversa.contato.numeroWhatsapp, tipo, link, {
            caption: conteudoTexto,
            filename: req.file.originalname,
            voiceNote: audioGravado,
          });
          entregue = true;
        }
      } else if (conteudoTexto) {
        if (conversa.instancia.tipoConexao === "evolution" && conversa.instancia.evolutionInstanceId) {
          await enviarTextoEvolution(conversa.instancia.evolutionInstanceId, conversa.contato.numeroWhatsapp, conteudoTexto);
          entregue = true;
        } else if (conversa.instancia.tipoConexao === "meta_cloud" && conversa.instancia.metaPhoneNumberId) {
          await enviarTextoMeta(conversa.instancia.metaPhoneNumberId, conversa.contato.numeroWhatsapp, conteudoTexto);
          entregue = true;
        }
      }
    } catch (err) {
      erroEntrega = err instanceof Error ? err.message : "Falha ao enviar mensagem";
      console.error("Falha ao entregar mensagem via WhatsApp:", err);
    }

    const conversaAtualizada = await prisma.conversa.findUnique({
      where: { id: conversaId },
      include: {
        contato: true,
        instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
        operador: { select: { id: true, nome: true } },
      },
    });

    emitNovaMensagem(mensagem);
    if (conversaAtualizada) {
      emitConversaAtualizada(conversaAtualizada);
    }

    res.status(201).json({ mensagem, entregue, erroEntrega });
  }),
);

export default router;
