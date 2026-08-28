import fs from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { uploadAudio } from "../../middleware/uploadAudio.js";
import { normalizarNumeroBrasileiro } from "../../lib/telefone.js";
import { criarCampanha, emitirAtualizacaoCampanha, getCampanhaComResumo, listCampanhas } from "./campanhas.service.js";
import { enfileirarCampanha } from "../../queues/discadoraQueue.js";

const router = Router();

// Rota pública (sem auth) — é o Twilio quem busca o áudio pra tocar na ligação, e ele
// não manda JWT nenhum. path.basename() já neutraliza qualquer tentativa de path traversal.
router.get(
  "/audio/:filename",
  asyncHandler(async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.resolve(process.cwd(), env.UPLOADS_DIR, "campanhas", filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).end();
    }
    res.sendFile(filePath);
  }),
);

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const campanhas = await listCampanhas();
    res.json({ campanhas });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const campanha = await getCampanhaComResumo(req.params.id);
    if (!campanha) {
      return res.status(404).json({ error: "Campanha não encontrada" });
    }
    res.json({ campanha });
  }),
);

const criarSchema = z.object({
  nome: z.string().trim().min(1),
  templateId: z.string().uuid(),
  instanciaId: z.string().uuid(),
});

router.post(
  "/",
  uploadAudio.single("audio"),
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Envie o arquivo de áudio da campanha" });
    }

    const instancia = await prisma.instancia.findUnique({ where: { id: parsed.data.instanciaId } });
    if (!instancia || instancia.tipoConexao !== "meta_cloud") {
      return res.status(400).json({ error: "Campanhas só podem usar instâncias Meta Cloud API" });
    }
    const template = await prisma.template.findUnique({ where: { id: parsed.data.templateId } });
    if (!template || template.instanciaId !== parsed.data.instanciaId) {
      return res.status(400).json({ error: "Template inválido para esta instância" });
    }

    const audioPath = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");

    const campanha = await criarCampanha({
      nome: parsed.data.nome,
      audioPath,
      templateId: parsed.data.templateId,
      instanciaId: parsed.data.instanciaId,
      criadoPor: req.user!.id,
      numeros: [],
    });

    res.status(201).json({ campanha });
  }),
);

const numerosSchema = z.object({
  numeros: z
    .array(
      z.object({
        numeroWhatsapp: z.string().trim().min(8),
        nomeContato: z.string().trim().optional(),
      }),
    )
    .min(1),
});

router.post(
  "/:id/numeros",
  asyncHandler(async (req, res) => {
    const parsed = numerosSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const campanha = await prisma.campanhaDiscadora.findUnique({ where: { id: req.params.id } });
    if (!campanha) {
      return res.status(404).json({ error: "Campanha não encontrada" });
    }
    if (campanha.status !== "rascunho") {
      return res.status(400).json({ error: "Só é possível adicionar números a uma campanha em rascunho" });
    }

    await prisma.campanhaNumero.createMany({
      data: parsed.data.numeros.map((n) => ({
        campanhaId: campanha.id,
        ...n,
        numeroWhatsapp: normalizarNumeroBrasileiro(n.numeroWhatsapp),
      })),
    });
    const total = await prisma.campanhaNumero.count({ where: { campanhaId: campanha.id } });
    await prisma.campanhaDiscadora.update({ where: { id: campanha.id }, data: { totalNumeros: total } });

    const atualizada = await getCampanhaComResumo(campanha.id);
    res.status(201).json({ campanha: atualizada });
  }),
);

router.post(
  "/:id/iniciar",
  asyncHandler(async (req, res) => {
    const campanha = await prisma.campanhaDiscadora.findUnique({ where: { id: req.params.id } });
    if (!campanha) {
      return res.status(404).json({ error: "Campanha não encontrada" });
    }
    if (campanha.status !== "rascunho" && campanha.status !== "pausada") {
      return res.status(400).json({ error: "Campanha não está em um estado que permita iniciar" });
    }
    if (campanha.totalNumeros === 0) {
      return res.status(400).json({ error: "Adicione ao menos um número antes de iniciar" });
    }

    await prisma.campanhaDiscadora.update({ where: { id: campanha.id }, data: { status: "em_andamento" } });
    await enfileirarCampanha(campanha.id);
    await emitirAtualizacaoCampanha(campanha.id);

    res.json({ ok: true });
  }),
);

router.post(
  "/:id/pausar",
  asyncHandler(async (req, res) => {
    const campanha = await prisma.campanhaDiscadora.findUnique({ where: { id: req.params.id } });
    if (!campanha) {
      return res.status(404).json({ error: "Campanha não encontrada" });
    }
    if (campanha.status !== "em_andamento") {
      return res.status(400).json({ error: "Só é possível pausar uma campanha em andamento" });
    }

    // Não cancela ligações já em curso — só impede que o worker inicie novas a partir daqui
    // (ver queues/discadoraQueue.ts, que confere o status da campanha a cada job).
    await prisma.campanhaDiscadora.update({ where: { id: campanha.id }, data: { status: "pausada" } });
    await emitirAtualizacaoCampanha(campanha.id);

    res.json({ ok: true });
  }),
);

export default router;
