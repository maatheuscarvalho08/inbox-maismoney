import path from "path";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { upload } from "../../middleware/upload.js";
import { prisma } from "../../db/prisma.js";
import { criarMensagem, listMensagensPorConversa } from "./mensagens.service.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { enviarTextoEvolution } from "../../integrations/evolutionApi.js";
import { enviarTextoMeta } from "../../integrations/metaCloudApi.js";

const router = Router();
router.use(authenticate);

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

    const { conversaId, conteudoTexto } = parsed.data;

    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      include: { contato: true, instancia: true },
    });
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    const midiaPath = req.file ? path.relative(process.cwd(), req.file.path).replace(/\\/g, "/") : null;
    const tipoMidia = req.file?.mimetype ?? null;

    const mensagem = await criarMensagem({
      conversaId,
      remetenteTipo: "operador",
      operadorId: req.user!.id,
      conteudoTexto: conteudoTexto ?? null,
      tipoMidia,
      midiaPath,
    });

    let entregue = false;
    let erroEntrega: string | undefined;

    try {
      if (conteudoTexto) {
        if (conversa.instancia.tipoConexao === "evolution" && conversa.instancia.evolutionInstanceId) {
          await enviarTextoEvolution(conversa.instancia.evolutionInstanceId, conversa.contato.numeroWhatsapp, conteudoTexto);
          entregue = true;
        } else if (conversa.instancia.tipoConexao === "meta_cloud" && conversa.instancia.metaPhoneNumberId) {
          await enviarTextoMeta(conversa.instancia.metaPhoneNumberId, conversa.contato.numeroWhatsapp, conteudoTexto);
          entregue = true;
        }
      }
      // Envio de mídia depende de uma URL assinada pública alcançável pelo provedor —
      // ver src/lib/signedUrl.ts. Só é exercitável com Evolution API / Meta Cloud API reais.
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
