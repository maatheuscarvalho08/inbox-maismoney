import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
  criarInstanciaEvolution,
  instanciaExisteEvolution,
  mensagemErroEvolution,
  obterQrCodeEvolution,
} from "../../integrations/evolutionApi.js";

const router = Router();
router.use(authenticate);

// Listagem básica fica disponível para qualquer operador (usada nos filtros de Conversas).
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const instancias = await prisma.instancia.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ instancias });
  }),
);

const criarSchema = z.object({
  nome: z.string().trim().min(1),
  numero: z.string().trim().min(8),
  tipoConexao: z.enum(["evolution", "meta_cloud"]),
  evolutionInstanceId: z.string().trim().min(1).optional(),
  metaPhoneNumberId: z.string().trim().min(1).optional(),
  metaWabaId: z.string().trim().min(1).optional(),
});

// Cadastro de número/instância — admin only (tela /numeros, seção 9 do CLAUDE.md).
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    if (parsed.data.tipoConexao === "evolution" && !parsed.data.evolutionInstanceId) {
      return res.status(400).json({ error: "Informe o nome da instância Evolution API" });
    }
    if (parsed.data.tipoConexao === "meta_cloud" && (!parsed.data.metaPhoneNumberId || !parsed.data.metaWabaId)) {
      return res.status(400).json({ error: "Informe o Phone Number ID e o WABA ID da Meta Cloud API" });
    }

    const existente = await prisma.instancia.findUnique({ where: { numero: parsed.data.numero } });
    if (existente) {
      return res.status(409).json({ error: "Já existe uma instância cadastrada com este número" });
    }

    // Evolution API precisa da instância criada do lado dele antes de qualquer QR Code —
    // criar só a linha no banco deixaria o número inutilizável. Feito antes do insert
    // pra não gravar um registro que nunca vai conseguir conectar.
    if (parsed.data.tipoConexao === "evolution") {
      const nomeInstancia = parsed.data.evolutionInstanceId!;
      try {
        if (!(await instanciaExisteEvolution(nomeInstancia))) {
          await criarInstanciaEvolution(nomeInstancia);
        }
      } catch (err) {
        const detalhe = mensagemErroEvolution(err);
        console.error("Falha ao criar instância na Evolution API:", detalhe);
        return res.status(502).json({ error: `Não foi possível criar a instância na Evolution API: ${detalhe}` });
      }
    }

    const instancia = await prisma.instancia.create({ data: parsed.data });
    res.status(201).json({ instancia });
  }),
);

const atualizarSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  evolutionInstanceId: z.string().trim().min(1).optional(),
  metaPhoneNumberId: z.string().trim().min(1).optional(),
  metaWabaId: z.string().trim().min(1).optional(),
  status: z.enum(["conectado", "desconectado"]).optional(),
});

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const instancia = await prisma.instancia.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ instancia });
  }),
);

// QR Code / reconexão fica restrito ao admin (tela /numeros, seção 9 do CLAUDE.md).
router.get(
  "/:id/qrcode",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const instancia = await prisma.instancia.findUnique({ where: { id: req.params.id } });
    if (!instancia) {
      return res.status(404).json({ error: "Instância não encontrada" });
    }
    if (instancia.tipoConexao !== "evolution" || !instancia.evolutionInstanceId) {
      return res.status(400).json({ error: "QR Code disponível apenas para instâncias Evolution API" });
    }

    try {
      // Recria a instância se ela sumiu do lado do Evolution (registro antigo, volume
      // do container recriado) — sem isso o QR Code falharia sem explicação.
      if (!(await instanciaExisteEvolution(instancia.evolutionInstanceId))) {
        await criarInstanciaEvolution(instancia.evolutionInstanceId);
      }
      const qrcode = await obterQrCodeEvolution(instancia.evolutionInstanceId);
      res.json({ qrcode });
    } catch (err) {
      const detalhe = mensagemErroEvolution(err);
      console.error("Falha ao obter QR Code na Evolution API:", detalhe);
      res.status(502).json({ error: `Não foi possível obter o QR Code: ${detalhe}` });
    }
  }),
);

export default router;
