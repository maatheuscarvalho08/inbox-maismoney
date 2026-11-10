import { randomInt } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { entregarMensagem } from "../mensagens/entrega.js";
import { getConversaById, marcarConversaRespondida } from "../conversas/conversas.service.js";
import { PREFIXO_NUMERO_TESTE, bancoConfigurado, processarComMaisa, verificarAutorizacao } from "./maisa.service.js";
import { bancoSimulado } from "./bancos.js";

const router = Router();
router.use(authenticate);

router.get("/config", (_req, res) => {
  res.json({ modo: env.MAISA_MODO, simulador: env.MAISA_SIMULADOR, banco: bancoConfigurado() });
});

// Modo copiloto: a equipe aprova a sugestão da Maisa e ela sai pelo WhatsApp.
router.post(
  "/mensagens/:id/enviar",
  asyncHandler(async (req, res) => {
    const mensagem = await prisma.mensagem.findUnique({
      where: { id: req.params.id },
      include: { conversa: { include: { contato: true, instancia: true } } },
    });
    if (!mensagem || mensagem.remetenteTipo !== "maisa") {
      return res.status(404).json({ error: "Sugestão não encontrada" });
    }
    if (mensagem.externalId) {
      return res.status(400).json({ error: "Essa mensagem já foi enviada" });
    }
    if (mensagem.conversa.contato.numeroWhatsapp.startsWith(PREFIXO_NUMERO_TESTE)) {
      return res.status(400).json({ error: "Conversa de teste: nada é enviado pelo WhatsApp" });
    }

    const { conversa, ...resto } = mensagem;
    const { erroEntrega } = await entregarMensagem(resto, conversa, null);
    const atualizada = await prisma.mensagem.findUnique({
      where: { id: mensagem.id },
      include: { operador: { select: { id: true, nome: true, fotoPath: true } } },
    });
    emitNovaMensagem(atualizada);
    res.json({ mensagem: atualizada, erroEntrega });
  }),
);

// Daqui para baixo, só com o simulador ligado. Serve para testar o fluxo sem WhatsApp.
const simulador = Router();
simulador.use(requireRole("admin"), (_req, res, next) => {
  if (!env.MAISA_SIMULADOR) return res.status(404).json({ error: "Simulador desligado" });
  next();
});

simulador.post(
  "/conversas",
  asyncHandler(async (_req, res) => {
    const instancia = await prisma.instancia.findFirst({ where: { maisaAtiva: true }, orderBy: { createdAt: "asc" } });
    if (!instancia) {
      return res.status(400).json({ error: "Ligue a Maisa em algum número, na tela Números, antes de testar" });
    }

    const numero = `${PREFIXO_NUMERO_TESTE}${String(randomInt(0, 1e6)).padStart(6, "0")}`;
    const contato = await prisma.contato.create({
      data: { numeroWhatsapp: numero, nome: `Cliente de teste ${numero.slice(-4)}` },
    });
    const conversa = await prisma.conversa.create({
      data: { instanciaId: instancia.id, contatoId: contato.id, status: "aberta", comMaisa: true },
    });

    const completa = await getConversaById(conversa.id);
    emitConversaAtualizada(completa);
    res.status(201).json({ conversa: completa });
  }),
);

const mensagemSchema = z.object({
  conversaId: z.string().uuid(),
  texto: z.string().trim().min(1).max(1000),
});

// Faz o papel do webhook: grava a mensagem como se o cliente tivesse mandado.
simulador.post(
  "/mensagens",
  asyncHandler(async (req, res) => {
    const parsed = mensagemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const conversa = await prisma.conversa.findUnique({ where: { id: parsed.data.conversaId }, include: { contato: true } });
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }
    // Nunca deixa simular mensagem numa conversa de cliente de verdade.
    if (!conversa.contato.numeroWhatsapp.startsWith(PREFIXO_NUMERO_TESTE)) {
      return res.status(400).json({ error: "Só dá para simular em conversas de teste" });
    }

    await marcarConversaRespondida(conversa.id);
    const mensagem = await criarMensagem({ conversaId: conversa.id, remetenteTipo: "cliente", conteudoTexto: parsed.data.texto });
    if (!mensagem) return res.status(500).json({ error: "Erro inesperado ao criar mensagem" });
    emitNovaMensagem(mensagem);

    await processarComMaisa(conversa.id, mensagem.id);
    res.status(201).json({ mensagem });
  }),
);

// Faz o papel do cliente tocando no link de autorização do banco.
simulador.post(
  "/autorizar",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ conversaId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dados inválidos" });

    const conversa = await prisma.conversa.findUnique({ where: { id: parsed.data.conversaId }, include: { contato: true } });
    if (!conversa?.contato.numeroWhatsapp.startsWith(PREFIXO_NUMERO_TESTE)) {
      return res.status(400).json({ error: "Só dá para simular em conversas de teste" });
    }
    if (!conversa.contato.cpf) return res.status(400).json({ error: "A conversa ainda não tem CPF" });

    bancoSimulado.autorizar(conversa.contato.cpf);
    await verificarAutorizacao(conversa.id);
    res.status(204).end();
  }),
);

router.use("/simulador", simulador);

export default router;
