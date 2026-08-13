import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const etiquetas = await prisma.etiqueta.findMany({ orderBy: { nome: "asc" } });
    res.json({ etiquetas });
  }),
);

const criarSchema = z.object({ nome: z.string().trim().min(1).max(40) });

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const etiqueta = await prisma.etiqueta.upsert({
      where: { nome: parsed.data.nome },
      update: {},
      create: { nome: parsed.data.nome },
    });

    res.status(201).json({ etiqueta });
  }),
);

export default router;
