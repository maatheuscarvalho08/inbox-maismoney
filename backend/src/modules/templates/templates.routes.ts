import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { listarTemplatesMeta } from "../../integrations/metaCloudApi.js";

interface TemplateMeta {
  id: string;
  components?: { type: string; text?: string }[];
}

// Best-effort: busca o corpo aprovado na Meta pra guardar junto do template, pra
// mostrar a mensagem de verdade no histórico depois em vez de só o nome. Se falhar
// (rede, WABA sem permissão, etc.), segue sem corpo — não bloqueia o cadastro.
async function buscarCorpoTemplate(wabaId: string, metaTemplateId: string): Promise<string | null> {
  try {
    const resposta = await listarTemplatesMeta(wabaId);
    const encontrado = (resposta.data as TemplateMeta[] | undefined)?.find((t) => t.id === metaTemplateId);
    const corpo = encontrado?.components?.find((c) => c.type === "BODY")?.text;
    return corpo ?? null;
  } catch (err) {
    console.error("Falha ao buscar corpo do template na Meta:", err);
    return null;
  }
}

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.query.instanciaId);
    const templates = await prisma.template.findMany({
      where: parsed.success ? { instanciaId: parsed.data } : undefined,
      orderBy: { nome: "asc" },
    });
    res.json({ templates });
  }),
);

const criarSchema = z.object({
  instanciaId: z.string().uuid(),
  nome: z.string().trim().min(1),
  metaTemplateId: z.string().trim().min(1),
  idioma: z.string().trim().min(1).default("pt_BR"),
});

// Cadastro dos templates HSM aprovados pela Meta — admin only.
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const instancia = await prisma.instancia.findUnique({ where: { id: parsed.data.instanciaId } });
    if (!instancia || instancia.tipoConexao !== "meta_cloud") {
      return res.status(400).json({ error: "Templates só podem ser criados para instâncias Meta Cloud API" });
    }

    const corpo = instancia.metaWabaId
      ? await buscarCorpoTemplate(instancia.metaWabaId, parsed.data.metaTemplateId)
      : null;

    const template = await prisma.template.create({ data: { ...parsed.data, corpo } });
    res.status(201).json({ template });
  }),
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    await prisma.template.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

export default router;
