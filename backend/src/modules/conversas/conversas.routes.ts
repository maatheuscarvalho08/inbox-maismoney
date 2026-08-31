import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  adicionarEtiqueta,
  atualizarConversa,
  getConversaById,
  listConversas,
  removerEtiqueta,
} from "./conversas.service.js";
import { emitConversaAtualizada } from "../../ws/events.js";

const router = Router();
router.use(authenticate);

const statusEnum = z.enum(["aberta", "em_atendimento", "aguardando", "encerrada"]);

const abaEnum = z.enum(["atendimento", "disparos"]);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const statusParsed = statusEnum.safeParse(req.query.status);
    const abaParsed = abaEnum.safeParse(req.query.aba);
    const conversas = await listConversas(
      statusParsed.success ? statusParsed.data : undefined,
      abaParsed.success ? abaParsed.data : undefined,
    );
    res.json({ conversas });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const conversa = await getConversaById(req.params.id);
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }
    res.json({ conversa });
  }),
);

const updateSchema = z.object({
  status: statusEnum.optional(),
  operadorId: z.string().uuid().nullable().optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const conversa = await atualizarConversa(req.params.id, parsed.data);
    emitConversaAtualizada(conversa);
    res.json({ conversa });
  }),
);

router.post(
  "/:id/etiquetas",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ etiquetaId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const conversa = await adicionarEtiqueta(req.params.id, parsed.data.etiquetaId);
    emitConversaAtualizada(conversa);
    res.status(201).json({ conversa });
  }),
);

router.delete(
  "/:id/etiquetas/:etiquetaId",
  asyncHandler(async (req, res) => {
    const conversa = await removerEtiqueta(req.params.id, req.params.etiquetaId);
    emitConversaAtualizada(conversa);
    res.json({ conversa });
  }),
);

export default router;
