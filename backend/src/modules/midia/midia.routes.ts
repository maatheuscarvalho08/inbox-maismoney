import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validarAssinaturaMidia } from "../../lib/signedUrl.js";
import { env } from "../../config/env.js";

const router = Router();

router.get(
  "/:mensagemId",
  asyncHandler(async (req, res) => {
    const { mensagemId } = req.params;
    const { exp, sig } = req.query;

    let autorizado =
      typeof exp === "string" && typeof sig === "string" && validarAssinaturaMidia(mensagemId, Number(exp), sig);

    if (!autorizado) {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      if (token) {
        try {
          jwt.verify(token, env.JWT_SECRET);
          autorizado = true;
        } catch {
          autorizado = false;
        }
      }
    }

    if (!autorizado) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
    if (!mensagem || !mensagem.midiaPath || mensagem.midiaDeleted) {
      return res.status(404).json({ error: "Mídia não disponível" });
    }

    const absPath = path.resolve(process.cwd(), mensagem.midiaPath);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }

    res.sendFile(absPath);
  }),
);

export default router;
