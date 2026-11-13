import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { prisma } from "../../db/prisma.js";
import { findOrCreateContato } from "../contatos/contatos.service.js";
import {
  adicionarEtiqueta,
  atualizarConversa,
  contarAbas,
  findOrCreateConversaAberta,
  getConversaById,
  listConversas,
  marcarConversaVisualizada,
  removerEtiqueta,
} from "./conversas.service.js";
import { emitConversaAtualizada } from "../../ws/events.js";
import { definirEtapa } from "../funil/funil.service.js";
import { retomarComMaisa } from "../maisa/maisa.service.js";

const router = Router();
router.use(authenticate);

const statusEnum = z.enum(["aberta", "em_atendimento", "aguardando", "encerrada"]);

const abaEnum = z.enum(["maisa", "sem_atendente", "atribuidas", "disparos", "carrinho"]);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const statusParsed = statusEnum.safeParse(req.query.status);
    const abaParsed = abaEnum.safeParse(req.query.aba);
    // limite=0: só as contagens (contador do Carrinho). limite=N: as N mais recentes (painel).
    const limiteParsed = z.coerce.number().int().min(0).max(500).safeParse(req.query.limite);
    const limite = req.query.limite !== undefined && limiteParsed.success ? limiteParsed.data : undefined;
    const [conversas, contagens] = await Promise.all([
      limite === 0
        ? []
        : listConversas(req.user!, statusParsed.success ? statusParsed.data : undefined, abaParsed.success ? abaParsed.data : undefined, limite),
      contarAbas(req.user!),
    ]);
    res.json({ conversas, contagens });
  }),
);

const CONVENIOS = ["inss", "clt", "siape", "servidor_prefeitura", "marinha", "militar", "conta_de_luz", "loas", "credito_pessoal", "fgts"] as const;

// Aspas para a planilha, e apóstrofo antes de =, +, - e @ para o Excel não executar
// como fórmula um nome digitado pelo próprio cliente no WhatsApp.
function celulaCsv(valor: string | null | undefined) {
  const texto = valor ?? "";
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

// Sem CPF de propósito: planilha circula fora do sistema. Precisa vir antes de /:id.
router.get(
  "/exportar",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const dias = z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.dias);
    const convenio = z.enum(CONVENIOS).safeParse(req.query.convenio);
    const conversas = await prisma.conversa.findMany({
      where: {
        lastMessageAt: { gte: new Date(Date.now() - dias * 24 * 60 * 60 * 1000) },
        ...(convenio.success ? { convenio: convenio.data } : {}),
      },
      orderBy: { lastMessageAt: "desc" },
      include: { contato: true, instancia: { select: { nome: true } }, operador: { select: { nome: true } } },
    });

    console.info(`Exportação de atendimentos: usuário ${req.user!.id}, ${conversas.length} linhas`);

    const linhas = conversas.map((c) =>
      [
        c.contato.nome,
        c.contato.numeroWhatsapp,
        c.instancia.nome,
        c.convenio,
        c.etapaFunil,
        c.status,
        c.operador?.nome,
        c.lastMessageAt.toISOString(),
      ]
        .map(celulaCsv)
        .join(";"),
    );
    const cabecalho = "Nome;WhatsApp;Número;Convênio;Etapa;Status;Responsável;Última mensagem";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="atendimentos-${dias}-dias.csv"`);
    // BOM para o Excel abrir os acentos corretamente.
    res.send(`\uFEFF${[cabecalho, ...linhas].join("\r\n")}`);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const conversa = await getConversaById(req.params.id);
    if (!conversa) {
      return res.status(404).json({ error: "Conversa não encontrada" });
    }

    // Abrir a conversa é o próprio sinal de "eu vi" — sem isso a bolinha de "não
    // respondida" nunca sumiria pra quem está lendo agora mesmo.
    await marcarConversaVisualizada(req.params.id, req.user!.id);
    const atualizada = await getConversaById(req.params.id);
    emitConversaAtualizada(atualizada);

    res.json({ conversa: atualizada });
  }),
);

const novaConversaSchema = z.object({
  instanciaId: z.string().uuid(),
  numeroWhatsapp: z.string().trim().min(8),
  nomeContato: z.string().trim().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = novaConversaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const instancia = await prisma.instancia.findUnique({ where: { id: parsed.data.instanciaId } });
    if (!instancia) {
      return res.status(404).json({ error: "Instância não encontrada" });
    }
    // Mesma regra do frontend, reforçada aqui: a Meta Cloud API rejeita texto
    // livre pra um contato que nunca respondeu — só dá pra iniciar via Evolution.
    if (instancia.tipoConexao !== "evolution") {
      return res.status(400).json({ error: "Só é possível iniciar conversa nova pelos números de atendimento (Evolution API)" });
    }

    const contato = await findOrCreateContato(parsed.data.numeroWhatsapp, parsed.data.nomeContato);
    // Reaproveita se já existir uma conversa aberta com esse contato nessa instância —
    // "chamar um número novo" não deve duplicar uma conversa em andamento.
    const conversa = await findOrCreateConversaAberta(instancia.id, contato.id);
    const conversaCompleta = await getConversaById(conversa.id);
    emitConversaAtualizada(conversaCompleta);

    res.status(201).json({ conversa: conversaCompleta });
  }),
);

const updateSchema = z.object({
  status: statusEnum.optional(),
  operadorId: z.string().uuid().nullable().optional(),
  comMaisa: z.boolean().optional(),
  convenio: z
    .enum(["inss", "clt", "siape", "servidor_prefeitura", "marinha", "militar", "conta_de_luz", "loas", "credito_pessoal", "fgts"])
    .nullable()
    .optional(),
  etapaFunil: z
    .enum(["lead", "dados_coletados", "simulacao", "simulacao_com_saldo", "proposta_digitada", "proposta_paga"])
    .optional(),
  // false = a equipe já tratou: tira do Carrinho.
  carrinho: z.literal(false).optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const { etapaFunil, carrinho, ...campos } = parsed.data;
    const data: Parameters<typeof atualizarConversa>[1] = campos;
    // Tirar do Carrinho, ou encerrar a conversa, limpa a marca.
    if (carrinho === false || campos.status === "encerrada") data.carrinhoEm = null;
    if (etapaFunil) await definirEtapa(req.params.id, etapaFunil);
    if (data.convenio !== undefined) Object.assign(data, { convenioOrigem: "operador" });
    if (data.comMaisa) {
      const atual = await prisma.conversa.findUnique({ where: { id: req.params.id }, include: { instancia: true } });
      if (!atual?.instancia.maisaAtiva) {
        return res.status(400).json({ error: "A Maisa não está ligada neste número" });
      }
      data.operadorId = null;
      // Devolvida para a Maisa: ela recomeça o fluxo do início. O que já foi
      // gravado no contato e na conversa, como CPF e convênio, continua lá.
      // A versão sobe: um processamento da Maisa em andamento não grava por cima.
      await prisma.conversa.update({ where: { id: req.params.id }, data: { maisaEstado: Prisma.DbNull, maisaVersao: { increment: 1 } } });
    } else if (data.operadorId) {
      // Atribuir a um operador tira a conversa da Maisa na hora.
      data.comMaisa = false;
    }

    const conversa = await atualizarConversa(req.params.id, data);
    emitConversaAtualizada(conversa);
    // Devolvida: a Maisa já manda a lista de produtos, sem esperar o cliente.
    if (data.comMaisa) void retomarComMaisa(req.params.id);
    res.json({ conversa });
  }),
);

router.post(
  "/:id/etiquetas",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ etiquetaId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    const conversa = await adicionarEtiqueta(req.params.id, parsed.data.etiquetaId);
    emitConversaAtualizada(conversa);
    res.status(201).json({ conversa });
  }),
);

router.delete(
  "/:id/etiquetas/:etiquetaId",
  asyncHandler(async (req, res) => {
    const conversa = await removerEtiqueta(req.params.id, req.params.etiquetaId);
    emitConversaAtualizada(conversa);
    res.json({ conversa });
  }),
);

export default router;
