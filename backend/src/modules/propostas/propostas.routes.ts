import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { emitConversaAtualizada } from "../../ws/events.js";
import { getConversaById } from "../conversas/conversas.service.js";
import { avancarEtapa } from "../funil/funil.service.js";

const router = Router();
router.use(authenticate);

const statusEnum = z.enum(["digitada", "em_analise", "aprovada", "paga", "recusada", "cancelada"]);
const convenioEnum = z.enum(["inss", "clt", "siape", "servidor_prefeitura", "marinha", "militar", "conta_de_luz", "loas", "credito_pessoal", "fgts"]);

const LIMITE_LISTA = 200;

const INCLUDE_LISTA = {
  conversa: { select: { id: true, contato: { select: { id: true, nome: true, numeroWhatsapp: true } } } },
  operador: { select: { id: true, nome: true } },
} as const;

async function avisarFunil(conversaId: string, etapa: "proposta_digitada" | "proposta_paga") {
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId } });
  if (!conversa) return;
  await avancarEtapa(conversaId, etapa, conversa.etapaFunil);
  emitConversaAtualizada(await getConversaById(conversaId));
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = statusEnum.safeParse(req.query.status);
    const conversaId = typeof req.query.conversaId === "string" ? req.query.conversaId : undefined;

    const [propostas, totais] = await Promise.all([
      prisma.proposta.findMany({
        where: { ...(status.success ? { status: status.data } : {}), ...(conversaId ? { conversaId } : {}) },
        orderBy: { createdAt: "desc" },
        take: LIMITE_LISTA,
        include: INCLUDE_LISTA,
      }),
      prisma.proposta.groupBy({ by: ["status"], _count: { _all: true }, _sum: { valorCentavos: true } }),
    ]);

    res.json({
      propostas,
      totais: totais.map((t) => ({ status: t.status, quantidade: t._count._all, valorCentavos: t._sum.valorCentavos ?? 0 })),
    });
  }),
);

const criarSchema = z.object({
  conversaId: z.string().uuid(),
  banco: z.string().trim().min(1, "Informe o banco").max(80),
  convenio: convenioEnum.nullable().optional(),
  valorCentavos: z.number().int().positive("Informe o valor"),
  parcelaCentavos: z.number().int().positive().nullable().optional(),
  prazoMeses: z.number().int().positive().max(240).nullable().optional(),
  numeroContrato: z.string().trim().max(60).nullable().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const conversa = await prisma.conversa.findUnique({ where: { id: parsed.data.conversaId } });
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    const proposta = await prisma.proposta.create({
      data: { ...parsed.data, convenio: parsed.data.convenio ?? conversa.convenio, operadorId: req.user!.id },
      include: INCLUDE_LISTA,
    });
    await avisarFunil(conversa.id, "proposta_digitada");
    res.status(201).json({ proposta });
  }),
);

const atualizarSchema = z.object({
  status: statusEnum.optional(),
  motivoRecusa: z.string().trim().max(200).nullable().optional(),
  numeroContrato: z.string().trim().max(60).nullable().optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const atual = await prisma.proposta.findUnique({ where: { id: req.params.id } });
    if (!atual) {
      return res.status(404).json({ error: "Proposta não encontrada" });
    }

    const proposta = await prisma.proposta.update({
      where: { id: atual.id },
      // Motivo só faz sentido em proposta recusada: sair desse status limpa o campo.
      data: { ...parsed.data, ...(parsed.data.status && parsed.data.status !== "recusada" ? { motivoRecusa: null } : {}) },
      include: INCLUDE_LISTA,
    });
    if (parsed.data.status === "paga") await avisarFunil(atual.conversaId, "proposta_paga");
    res.json({ proposta });
  }),
);

export default router;
