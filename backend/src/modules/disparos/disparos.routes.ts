import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import { findOrCreateConversaAberta } from "../conversas/conversas.service.js";
import { criarMensagem } from "../mensagens/mensagens.service.js";
import { enviarTemplateMeta, mensagemErroMeta } from "../../integrations/metaCloudApi.js";
import { emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { disparoLoteQueue } from "../../queues/disparoLoteQueue.js";
import { montarTextoDisparo } from "../../lib/template.js";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const mensagens = await prisma.mensagem.findMany({
      // templateNome preenchido = é um disparo (independente do texto, que agora é a
      // mensagem real enviada, não mais um marcador "[Disparo..." fixo).
      where: { OR: [{ templateNome: { not: null } }, { conteudoTexto: { startsWith: "[Disparo" } }] },
      orderBy: { timestamp: "desc" },
      take: 500,
      include: {
        operador: { select: { id: true, nome: true } },
        conversa: {
          select: {
            id: true,
            contato: { select: { nome: true, numeroWhatsapp: true } },
            instancia: { select: { id: true, nome: true, numero: true } },
          },
        },
      },
    });

    // Disparos de um mesmo CSV em massa compartilham loteId — agrupa numa linha só
    // em vez de uma por número (um envio de 50 não deveria virar 50 linhas soltas).
    const grupos = new Map<string, typeof mensagens>();
    for (const m of mensagens) {
      const chave = m.loteId ?? m.id;
      const grupo = grupos.get(chave) ?? [];
      grupo.push(m);
      grupos.set(chave, grupo);
    }

    const disparos = Array.from(grupos.entries()).map(([chave, msgs]) => {
      const primeira = msgs[0];
      const resumoStatus = {
        enviado: msgs.filter((m) => m.statusEntrega === "enviado").length,
        entregue: msgs.filter((m) => m.statusEntrega === "entregue").length,
        lido: msgs.filter((m) => m.statusEntrega === "lido").length,
        falhou: msgs.filter((m) => m.statusEntrega === "falhou").length,
      };
      return {
        id: chave,
        totalNumeros: msgs.length,
        contato: msgs.length === 1 ? primeira.conversa.contato : null,
        conteudoTexto: primeira.conteudoTexto,
        templateNome: primeira.templateNome,
        instancia: primeira.conversa.instancia,
        operador: primeira.operador,
        timestamp: primeira.timestamp,
        statusEntrega: msgs.length === 1 ? primeira.statusEntrega : null,
        resumoStatus,
      };
    });

    disparos.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ disparos });
  }),
);

const disparoSchema = z.object({
  instanciaId: z.string().uuid(),
  templateId: z.string().uuid(),
  numeroDestino: z.string().min(8),
  variaveis: z.array(z.string()).default([]),
  loteId: z.string().uuid().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = disparoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const { instanciaId, templateId, numeroDestino, variaveis, loteId } = parsed.data;

    const [instancia, template] = await Promise.all([
      prisma.instancia.findUnique({ where: { id: instanciaId } }),
      prisma.template.findUnique({ where: { id: templateId } }),
    ]);

    if (!instancia || instancia.tipoConexao !== "meta_cloud" || !instancia.metaPhoneNumberId) {
      return res.status(400).json({ error: "Instância inválida para disparos (precisa ser Meta Cloud API)" });
    }
    if (!template || template.instanciaId !== instanciaId) {
      return res.status(400).json({ error: "Template inválido para esta instância" });
    }

    const contato = await findOrCreateContato(numeroDestino);
    const conversa = await findOrCreateConversaAberta(instanciaId, contato.id);

    let entregue = false;
    let erroEntrega: string | undefined;
    let idEnvio: string | undefined;
    try {
      // A Meta identifica o template pelo NOME, não pelo ID numérico armazenado em
      // metaTemplateId (esse serve só pra referência/exclusão via API de gestão).
      idEnvio = await enviarTemplateMeta(instancia.metaPhoneNumberId, numeroDestino, template.nome, variaveis, template.idioma);
      entregue = true;
    } catch (err) {
      erroEntrega = mensagemErroMeta(err);
      console.error("Falha ao enviar disparo via Meta Cloud API:", erroEntrega);
    }

    const mensagem = await criarMensagem({
      conversaId: conversa.id,
      remetenteTipo: "operador",
      operadorId: req.user!.id,
      conteudoTexto: montarTextoDisparo(template.nome, template.corpo, variaveis),
      templateNome: template.nome,
      externalId: idEnvio ?? null,
      statusEntrega: idEnvio ? "enviado" : "falhou",
      loteId: loteId ?? null,
    });

    const conversaAtualizada = await prisma.conversa.findUnique({
      where: { id: conversa.id },
      include: {
        contato: true,
        instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true } },
        operador: { select: { id: true, nome: true } },
      },
    });

    emitNovaMensagem(mensagem);
    if (conversaAtualizada) emitConversaAtualizada(conversaAtualizada);

    res.status(201).json({ mensagem, entregue, erroEntrega });
  }),
);

const loteSchema = z.object({
  instanciaId: z.string().uuid(),
  templateId: z.string().uuid(),
  numeros: z.array(z.string().min(8)).min(1),
  variaveis: z.array(z.string()).default([]),
  intervaloMs: z.coerce.number().min(0).default(0),
});

// Envio em massa roda no backend (fila), não no navegador — sobrevive a fechar a
// aba/atualizar a página, diferente do loop que existia antes só no front-end.
router.post(
  "/lote",
  asyncHandler(async (req, res) => {
    const parsed = loteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const { instanciaId, templateId, numeros, variaveis, intervaloMs } = parsed.data;

    const [instancia, template] = await Promise.all([
      prisma.instancia.findUnique({ where: { id: instanciaId } }),
      prisma.template.findUnique({ where: { id: templateId } }),
    ]);
    if (!instancia || instancia.tipoConexao !== "meta_cloud" || !instancia.metaPhoneNumberId) {
      return res.status(400).json({ error: "Instância inválida para disparos (precisa ser Meta Cloud API)" });
    }
    if (!template || template.instanciaId !== instanciaId) {
      return res.status(400).json({ error: "Template inválido para esta instância" });
    }

    const loteId = crypto.randomUUID();
    await disparoLoteQueue.add("lote", {
      loteId,
      instanciaId,
      templateId,
      numeros,
      variaveis,
      intervaloMs,
      operadorId: req.user!.id,
    });

    res.status(202).json({ loteId, totalNumeros: numeros.length });
  }),
);

export default router;
