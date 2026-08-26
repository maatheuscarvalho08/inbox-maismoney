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

const router = Router();
router.use(authenticate);

const disparoSchema = z.object({
  instanciaId: z.string().uuid(),
  templateId: z.string().uuid(),
  numeroDestino: z.string().min(8),
  variaveis: z.array(z.string()).default([]),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = disparoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const { instanciaId, templateId, numeroDestino, variaveis } = parsed.data;

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
      conteudoTexto: `[Disparo · template "${template.nome}"] ${variaveis.join(", ")}`.trim(),
      externalId: idEnvio ?? null,
      statusEntrega: idEnvio ? "enviado" : "falhou",
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

export default router;
