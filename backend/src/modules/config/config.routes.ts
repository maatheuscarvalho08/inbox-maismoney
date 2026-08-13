import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { env } from "../../config/env.js";

const router = Router();
router.use(authenticate, requireRole("admin"));

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [totalUsuarios, usuariosAtivos, totalInstancias, instanciasConectadas] = await Promise.all([
      prisma.usuario.count(),
      prisma.usuario.count({ where: { ativo: true } }),
      prisma.instancia.count(),
      prisma.instancia.count({ where: { status: "conectado" } }),
    ]);

    res.json({
      empresa: {
        nome: "MAIS MONEY PROMOTORA DE VENDAS LTDA - ME",
        cnpj: "45.027.472/0001-76",
        setor: "Correspondente bancário / crédito consignado",
      },
      midia: {
        retencaoDias: env.MEDIA_RETENTION_DIAS,
      },
      contadores: {
        totalUsuarios,
        usuariosAtivos,
        totalInstancias,
        instanciasConectadas,
      },
    });
  }),
);

export default router;
