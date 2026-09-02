import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import {
  adicionarEtiqueta,
  atualizarConversa,
  findOrCreateConversaAberta,
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

const novaConversaSchema = z.object({
  instanciaId: z.string().uuid(),
  numeroWhatsapp: z.string().trim().min(8),
  nomeContato: z.string().trim().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = novaConversaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const instancia = await prisma.instancia.findUnique({ where: { id: parsed.data.instanciaId } });
    if (!instancia) {
      return res.status(404).json({ error: "Instância não encontrada" });
    }

    const contato = await findOrCreateContato(parsed.data.numeroWhatsapp, parsed.data.nomeContato);
    // Reaproveita se já existir uma conversa aberta com esse contato nessa instância —
    // "chamar um número novo" não deve duplicar uma conversa em andamento.
    const conversa = await findOrCreateConversaAberta(instancia.id, contato.id);
    const conversaCompleta = await getConversaById(conversa.id);
    emitConversaAtualizada(conversaCompleta);

    res.status(201).json({ conversa: conversaCompleta });
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
