import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  atendimentosPorOperador,
  distribuicaoPorStatus,
  historicoDiario,
  resumoMetricas,
  volumeMensagensPorMes,
} from "./metricas.service.js";

const router = Router();
router.use(authenticate);

// Resumo básico e histórico diário ficam visíveis para qualquer operador (usados no Dashboard).
router.get(
  "/resumo",
  asyncHandler(async (_req, res) => {
    res.json(await resumoMetricas());
  }),
);

router.get(
  "/historico-diario",
  asyncHandler(async (_req, res) => {
    res.json(await historicoDiario());
  }),
);

// Quebras detalhadas ficam restritas ao admin (tela /metricas, seção 9 do CLAUDE.md).
router.use(requireRole("admin"));

router.get(
  "/volume-mensagens",
  asyncHandler(async (_req, res) => {
    res.json({ volume: await volumeMensagensPorMes() });
  }),
);

router.get(
  "/atendimentos-por-operador",
  asyncHandler(async (_req, res) => {
    res.json({ operadores: await atendimentosPorOperador() });
  }),
);

router.get(
  "/distribuicao-status",
  asyncHandler(async (_req, res) => {
    res.json({ distribuicao: await distribuicaoPorStatus() });
  }),
);

export default router;
