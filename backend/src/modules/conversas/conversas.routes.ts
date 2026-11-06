import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import {
  adicionarEtiqueta,
  atualizarConversa,
  contarAbas,
  findOrCreateConversaAberta,
  getConversaById,
  listConversas,
  marcarConversaVisualizada,
  removerEtiqueta,
} from "./conversas.service.js";
import { emitConversaAtualizada } from "../../ws/events.js";

const router = Router();
router.use(authenticate);

const statusEnum = z.enum(["aberta", "em_atendimento", "aguardando", "encerrada"]);

const abaEnum = z.enum(["maisa", "sem_atendente", "atribuidas", "disparos"]);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const statusParsed = statusEnum.safeParse(req.query.status);
    const abaParsed = abaEnum.safeParse(req.query.aba);
    const [conversas, contagens] = await Promise.all([
      listConversas(statusParsed.success ? statusParsed.data : undefined, abaParsed.success ? abaParsed.data : undefined),
      contarAbas(),
    ]);
    res.json({ conversas, contagens });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const conversa = await getConversaById(req.params.id);
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    // Abrir a conversa é o próprio sinal de "eu vi" — sem isso a bolinha de "não
    // respondida" nunca sumiria pra quem está lendo agora mesmo.
    await marcarConversaVisualizada(req.params.id, req.user!.id);
    const atualizada = await getConversaById(req.params.id);
    emitConversaAtualizada(atualizada);

    res.json({ conversa: atualizada });
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
    // Mesma regra do frontend, reforçada aqui: a Meta Cloud API rejeita texto
    // livre pra um contato que nunca respondeu — só dá pra iniciar via Evolution.
    if (instancia.tipoConexao !== "evolution") {
      return res.status(400).json({ error: "Só é possível iniciar conversa nova pelos números de atendimento (Evolution API)" });
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
  comMaisa: z.boolean().optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const data = { ...parsed.data };
    if (data.comMaisa) {
      const atual = await prisma.conversa.findUnique({ where: { id: req.params.id }, include: { instancia: true } });
      if (!atual?.instancia.maisaAtiva) {
        return res.status(400).json({ error: "A Maisa não está ligada neste número" });
      }
      data.operadorId = null;
    } else if (data.operadorId) {
      // Atribuir a um operador tira a conversa da Maisa na hora.
      data.comMaisa = false;
    }

    const conversa = await atualizarConversa(req.params.id, data);
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
