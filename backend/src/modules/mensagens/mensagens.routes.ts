import path from "path";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { upload } from "../../middleware/upload.js";
import { prisma } from "../../db/prisma.js";
import { criarMensagem, listMensagensPorConversa } from "./mensagens.service.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { editarMensagemEvolution, mensagemErroEvolution } from "../../integrations/evolutionApi.js";
import { entregarMensagem } from "./entrega.js";
import { converterParaOgg, precisaConverterAudio } from "../../lib/audioConvert.js";

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
  audioGravado: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  respondeAId: z.string().uuid().optional(),
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

    const { conversaId, conteudoTexto, audioGravado, respondeAId } = parsed.data;

    const conversa = await prisma.conversa.findUnique({
      where: { id: conversaId },
      include: { contato: true, instancia: true },
    });
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    // A citação só é usada aqui pra montar o payload de envio pra Evolution/Meta —
    // respondeAId (sempre gravado se veio no body) é o que fica salvo de verdade.
    const original = respondeAId
      ? await prisma.mensagem.findFirst({ where: { id: respondeAId, conversaId } })
      : null;

    // Áudio gravado no navegador (webm/opus) não é aceito pela Meta como mensagem de
    // áudio — remuxa pra ogg/opus antes de salvar, pra já guardar o arquivo que vai
    // ser mandado de verdade (evita servir um arquivo diferente do que foi enviado).
    if (req.file && precisaConverterAudio(req.file.mimetype)) {
      const convertido = await converterParaOgg(req.file.path);
      req.file.path = convertido.path;
      req.file.mimetype = convertido.mimetype;
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
      respondeAId: original?.id ?? null,
    });
    if (!mensagem) {
      return res.status(500).json({ error: "Erro inesperado ao criar mensagem" });
    }

    // Operador respondeu: a Maisa para na hora, e quem respondeu vira o responsável
    // se a conversa ainda não tinha um.
    if (conversa.comMaisa || !conversa.operadorId) {
      await prisma.conversa.update({
        where: { id: conversaId },
        data: { comMaisa: false, operadorId: conversa.operadorId ?? req.user!.id },
      });
    }

    const { entregue, erroEntrega } = await entregarMensagem(mensagem, conversa, original, {
      filename: req.file?.originalname,
      voiceNote: audioGravado,
    });

    const conversaAtualizada = await prisma.conversa.findUnique({
      where: { id: conversaId },
      include: {
        contato: true,
        instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
        operador: { select: { id: true, nome: true, fotoPath: true } },
      },
    });

    emitNovaMensagem(mensagem);
    if (conversaAtualizada) {
      emitConversaAtualizada(conversaAtualizada);
    }

    res.status(201).json({ mensagem, entregue, erroEntrega });
  }),
);

// Tenta de novo a mesma mensagem que falhou, sem criar outra no histórico.
router.post(
  "/:id/reenviar",
  asyncHandler(async (req, res) => {
    const mensagem = await prisma.mensagem.findUnique({
      where: { id: req.params.id },
      include: {
        conversa: { include: { contato: true, instancia: true } },
        operador: { select: { id: true, nome: true, fotoPath: true } },
        respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
      },
    });
    if (!mensagem) {
      return res.status(404).json({ error: "Mensagem não encontrada" });
    }
    if (mensagem.remetenteTipo === "cliente" || mensagem.statusEntrega !== "falhou") {
      return res.status(400).json({ error: "Só mensagens que falharam podem ser reenviadas" });
    }
    if (mensagem.midiaDeleted) {
      return res.status(400).json({ error: "A mídia dessa mensagem já foi removida" });
    }

    const { conversa, ...resto } = mensagem;
    const original = mensagem.respondeAId
      ? await prisma.mensagem.findUnique({ where: { id: mensagem.respondeAId } })
      : null;

    const { erroEntrega } = await entregarMensagem(resto, conversa, original);

    emitNovaMensagem(resto);
    res.json({ mensagem: resto, erroEntrega });
  }),
);

const editarSchema = z.object({
  conteudoTexto: z.string().trim().min(1),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = editarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const mensagem = await prisma.mensagem.findUnique({
      where: { id: req.params.id },
      include: { conversa: { include: { contato: true, instancia: true } } },
    });
    if (!mensagem) {
      return res.status(404).json({ error: "Mensagem não encontrada" });
    }

    const { conversa } = mensagem;
    // Só dá pra editar mensagem enviada pelo próprio operador, sem mídia (edição
    // troca o texto, não o arquivo), e só via Evolution — a Meta Cloud API não tem
    // endpoint pra editar mensagem já entregue.
    if (mensagem.remetenteTipo !== "operador" || mensagem.tipoMidia || !mensagem.externalId) {
      return res.status(400).json({ error: "Essa mensagem não pode ser editada" });
    }
    if (conversa.instancia.tipoConexao !== "evolution" || !conversa.instancia.evolutionInstanceId) {
      return res.status(400).json({ error: "Edição só é possível em números conectados via Evolution API" });
    }

    try {
      await editarMensagemEvolution(
        conversa.instancia.evolutionInstanceId,
        conversa.contato.numeroWhatsapp,
        mensagem.externalId,
        parsed.data.conteudoTexto,
      );
    } catch (err) {
      return res.status(502).json({ error: "Não foi possível editar no WhatsApp", detalhe: mensagemErroEvolution(err) });
    }

    const atualizada = await prisma.mensagem.update({
      where: { id: mensagem.id },
      data: { conteudoTexto: parsed.data.conteudoTexto, editadaEm: new Date() },
      include: { operador: { select: { id: true, nome: true, fotoPath: true } } },
    });

    emitNovaMensagem(atualizada);
    res.json({ mensagem: atualizada });
  }),
);

export default router;
