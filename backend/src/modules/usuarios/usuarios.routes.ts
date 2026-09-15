import path from "path";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { upload } from "../../middleware/upload.js";

const router = Router();

// Precisa vir antes do authenticate: <img src> não manda o header Authorization,
// igual o áudio de campanha em campanhas.routes.ts. Equipe interna de 3 pessoas
// vendo foto uma da outra não tem o mesmo risco de privacidade de mídia de cliente.
router.get(
  "/:id/foto",
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!usuario?.fotoPath) {
      return res.status(404).end();
    }
    res.sendFile(path.resolve(process.cwd(), usuario.fotoPath));
  }),
);

router.use(authenticate);

const SELECT_PUBLICO = {
  id: true,
  nome: true,
  email: true,
  role: true,
  ativo: true,
  fotoPath: true,
  createdAt: true,
} as const;

// Listagem básica fica disponível para qualquer operador (usada nos filtros de Conversas
// e na atribuição de vendedor). Criar/editar usuário continua restrito ao admin.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const usuarios = await prisma.usuario.findMany({ select: SELECT_PUBLICO, orderBy: { createdAt: "asc" } });
    res.json({ usuarios });
  }),
);

const atualizarPerfilSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  senhaAtual: z.string().optional(),
  novaSenha: z.string().min(8, "Senha deve ter ao menos 8 caracteres").optional(),
});

// Autoatendimento: qualquer usuário pode editar o próprio nome/senha, sem precisar de admin.
router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const parsed = atualizarPerfilSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const { nome, senhaAtual, novaSenha } = parsed.data;
    const data: { nome?: string; senhaHash?: string } = {};
    if (nome) data.nome = nome;

    if (novaSenha) {
      if (!senhaAtual) {
        return res.status(400).json({ error: "Informe a senha atual para definir uma nova senha" });
      }
      const usuarioAtual = await prisma.usuario.findUnique({ where: { id: req.user!.id } });
      const senhaValida = usuarioAtual && (await bcrypt.compare(senhaAtual, usuarioAtual.senhaHash));
      if (!senhaValida) {
        return res.status(400).json({ error: "Senha atual incorreta" });
      }
      data.senhaHash = await bcrypt.hash(novaSenha, 10);
    }

    const usuario = await prisma.usuario.update({ where: { id: req.user!.id }, data, select: SELECT_PUBLICO });
    res.json({ usuario });
  }),
);

// Avatar próprio — mesmo espírito do nome/senha em /me, sem precisar de admin.
router.post(
  "/me/foto",
  upload.single("foto"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Envie um arquivo de imagem" });
    }
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "O avatar precisa ser uma imagem" });
    }

    const fotoPath = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");
    const usuario = await prisma.usuario.update({
      where: { id: req.user!.id },
      data: { fotoPath },
      select: SELECT_PUBLICO,
    });
    res.json({ usuario });
  }),
);

router.use(requireRole("admin"));

const criarSchema = z.object({
  nome: z.string().trim().min(1),
  email: z.string().email(),
  senha: z.string().min(8, "Senha deve ter ao menos 8 caracteres"),
  role: z.enum(["admin", "operador"]),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const existente = await prisma.usuario.findUnique({ where: { email: parsed.data.email } });
    if (existente) {
      return res.status(409).json({ error: "Já existe um usuário com este e-mail" });
    }

    const senhaHash = await bcrypt.hash(parsed.data.senha, 10);
    const usuario = await prisma.usuario.create({
      data: { nome: parsed.data.nome, email: parsed.data.email, senhaHash, role: parsed.data.role },
      select: SELECT_PUBLICO,
    });

    res.status(201).json({ usuario });
  }),
);

const atualizarSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(["admin", "operador"]).optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(8).optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    if (req.params.id === req.user!.id && parsed.data.ativo === false) {
      return res.status(400).json({ error: "Você não pode desativar sua própria conta" });
    }

    if (parsed.data.email) {
      const existente = await prisma.usuario.findUnique({ where: { email: parsed.data.email } });
      if (existente && existente.id !== req.params.id) {
        return res.status(409).json({ error: "Já existe um usuário com este e-mail" });
      }
    }

    const { senha, ...resto } = parsed.data;
    const data = senha ? { ...resto, senhaHash: await bcrypt.hash(senha, 10) } : resto;

    const usuario = await prisma.usuario.update({ where: { id: req.params.id }, data, select: SELECT_PUBLICO });
    res.json({ usuario });
  }),
);

export default router;
