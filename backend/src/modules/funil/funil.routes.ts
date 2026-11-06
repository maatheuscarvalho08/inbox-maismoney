import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { relatorioFunil } from "./funil.service.js";

const router = Router();
router.use(authenticate);
router.use(requireRole("admin"));

const querySchema = z.object({
  dias: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  convenio: z
    .enum(["inss", "clt", "siape", "servidor_prefeitura", "marinha", "militar", "conta_de_luz", "loas", "credito_pessoal", "fgts"])
    .optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }
    res.json({ etapas: await relatorioFunil(parsed.data.dias, parsed.data.convenio) });
  }),
);

export default router;
