import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { emitConversaAtualizada } from "../../ws/events.js";
import { getConversaById } from "../conversas/conversas.service.js";

const router = Router();
router.use(authenticate);

const atualizarSchema = z.object({
  nome: z.string().trim().min(1).nullable().optional(),
  cpf: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 0 || v.length === 11, "CPF deve ter 11 dígitos")
    .nullable()
    .optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = atualizarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const contato = await prisma.contato.findUnique({ where: { id: req.params.id } });
    if (!contato) {
      return res.status(404).json({ error: "Contato não encontrado" });
    }

    const atualizado = await prisma.contato.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.data.nome !== undefined ? { nome: parsed.data.nome } : {}),
        ...(parsed.data.cpf !== undefined ? { cpf: parsed.data.cpf || null } : {}),
      },
    });

    // Um contato pode ter conversas em mais de uma instância — avisa todas por
    // socket pra quem estiver com a tela aberta ver o nome/CPF novo na hora.
    const conversas = await prisma.conversa.findMany({ where: { contatoId: req.params.id }, select: { id: true } });
    for (const c of conversas) {
      const atualizada = await getConversaById(c.id);
      if (atualizada) emitConversaAtualizada(atualizada);
    }

    res.json({ contato: atualizado });
  }),
);

export default router;
