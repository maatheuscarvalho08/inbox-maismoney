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

const resultadoEnum = z.enum(["com_saldo", "sem_saldo", "erro"]);
const LIMITE_LISTA = 200;

const INCLUDE_LISTA = {
  conversa: { select: { id: true, contato: { select: { id: true, nome: true, numeroWhatsapp: true } } } },
  operador: { select: { id: true, nome: true } },
} as const;

// Taxa de saldo por banco e principais motivos: é o que mostra onde vale insistir.
async function resumoSimulacoes() {
  const [porBanco, motivos] = await Promise.all([
    prisma.simulacao.groupBy({ by: ["banco", "resultado"], _count: { _all: true } }),
    prisma.simulacao.groupBy({
      by: ["motivo"],
      where: { resultado: "sem_saldo", motivo: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { motivo: "desc" } },
      take: 5,
    }),
  ]);

  const bancos = new Map<string, { banco: string; total: number; comSaldo: number }>();
  for (const g of porBanco) {
    const atual = bancos.get(g.banco) ?? { banco: g.banco, total: 0, comSaldo: 0 };
    atual.total += g._count._all;
    if (g.resultado === "com_saldo") atual.comSaldo += g._count._all;
    bancos.set(g.banco, atual);
  }

  return {
    bancos: [...bancos.values()].sort((a, b) => b.total - a.total),
    motivos: motivos.map((m) => ({ motivo: m.motivo as string, quantidade: m._count._all })),
  };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const resultado = resultadoEnum.safeParse(req.query.resultado);
    const conversaId = typeof req.query.conversaId === "string" ? req.query.conversaId : undefined;

    const [simulacoes, resumo] = await Promise.all([
      prisma.simulacao.findMany({
        where: { ...(resultado.success ? { resultado: resultado.data } : {}), ...(conversaId ? { conversaId } : {}) },
        orderBy: { createdAt: "desc" },
        take: LIMITE_LISTA,
        include: INCLUDE_LISTA,
      }),
      resumoSimulacoes(),
    ]);
    res.json({ simulacoes, resumo });
  }),
);

const criarSchema = z.object({
  conversaId: z.string().uuid(),
  banco: z.string().trim().min(1, "Informe o banco").max(80),
  resultado: resultadoEnum,
  valorCentavos: z.number().int().positive().nullable().optional(),
  motivo: z.string().trim().max(200).nullable().optional(),
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

    const { resultado, valorCentavos, motivo } = parsed.data;
    const simulacao = await prisma.simulacao.create({
      data: {
        ...parsed.data,
        convenio: conversa.convenio,
        operadorId: req.user!.id,
        valorCentavos: resultado === "com_saldo" ? valorCentavos : null,
        motivo: resultado === "com_saldo" ? null : motivo,
      },
      include: INCLUDE_LISTA,
    });

    // Erro na API do banco não é simulação concluída, então não move o funil.
    if (resultado !== "erro") {
      await avancarEtapa(conversa.id, resultado === "com_saldo" ? "simulacao_com_saldo" : "simulacao", conversa.etapaFunil);
      emitConversaAtualizada(await getConversaById(conversa.id));
    }
    res.status(201).json({ simulacao });
  }),
);

export default router;
