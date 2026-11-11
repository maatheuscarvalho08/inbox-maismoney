import fs from "fs/promises";
import path from "path";
import multer from "multer";
import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { uploadsRoot } from "../../middleware/upload.js";
import { prisma } from "../../db/prisma.js";
import { lerExtrato, leituraConfigurada } from "./leitor.js";
import { analisarExtrato } from "./analise.js";
import { analiseGuardada, guardarAnalise, type AnaliseGuardada } from "./guardadas.js";

const router = Router();
router.use(authenticate);

const FORMATOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

// Extrato enviado direto pelo atendente: fica só na memória, não é gravado em disco.
const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, FORMATOS.includes(file.mimetype)),
});

class ErroLeitura extends Error {}

// Transforma a falha de leitura em resposta clara, em vez de "Erro interno".
async function responder(res: import("express").Response, tarefa: () => Promise<unknown>) {
  try {
    res.json(await tarefa());
  } catch (err) {
    if (err instanceof ErroLeitura) return res.status(502).json({ error: err.message });
    throw err;
  }
}

async function analisar(conteudo: Buffer, mimetype: string, nome: string, usuarioId: string, origem: string) {
  const inicio = Date.now();
  let leitura: Awaited<ReturnType<typeof lerExtrato>>;
  try {
    leitura = await lerExtrato(conteudo, mimetype, nome);
  } catch (err) {
    // Falha da OpenAI (sem crédito, fora do ar, recusa): o atendente precisa ver o motivo.
    const motivo = err instanceof Error ? err.message : "falha desconhecida";
    console.error(`Leitura de extrato falhou (usuario=${usuarioId} origem=${origem}): ${motivo}`);
    throw new ErroLeitura(motivo.includes("no credits") ? "A conta da OpenAI está sem crédito." : `Não foi possível ler o extrato: ${motivo}`);
  }
  // Registro de acesso a documento sensível, sem dado pessoal.
  console.log(
    `Extrato lido por usuario=${usuarioId} origem=${origem} modelo=${leitura.modelo} tokens=${leitura.tokensEntrada}/${leitura.tokensSaida} ${Date.now() - inicio}ms`,
  );
  return { leitura: leitura.extrato, analise: analisarExtrato(leitura.extrato), modelo: leitura.modelo, tokens: { entrada: leitura.tokensEntrada, saida: leitura.tokensSaida } };
}

router.get("/config", (_req, res) => {
  res.json({ disponivel: leituraConfigurada() });
});

// Arquivo que o cliente mandou na conversa.
router.post(
  "/mensagens/:id",
  asyncHandler(async (req, res) => {
    if (!leituraConfigurada()) return res.status(503).json({ error: "Leitura de extrato não configurada" });

    const mensagem = await prisma.mensagem.findUnique({ where: { id: req.params.id } });
    if (!mensagem?.midiaPath || !mensagem.tipoMidia) return res.status(404).json({ error: "Arquivo não encontrado" });
    if (mensagem.midiaDeleted) return res.status(410).json({ error: "O arquivo já foi apagado pela regra dos 4 dias" });
    if (!FORMATOS.includes(mensagem.tipoMidia)) return res.status(400).json({ error: "Só dá para ler PDF ou imagem" });

    // Nunca ler fora da pasta de uploads.
    const caminho = path.resolve(process.cwd(), mensagem.midiaPath);
    if (!caminho.startsWith(uploadsRoot + path.sep)) return res.status(400).json({ error: "Caminho inválido" });

    // Já lido pela Maisa ou por alguém da equipe: mostra o que foi guardado, sem nova leitura.
    // ?refazer=1 lê de novo.
    if (req.query.refazer !== "1") {
      const guardada = await analiseGuardada(mensagem.id);
      if (guardada) return res.json(guardada);
    }

    const conteudo = await fs.readFile(caminho);
    const tipo = mensagem.tipoMidia;
    await responder(res, async () => {
      const r = await analisar(conteudo, tipo, path.basename(caminho), req.user!.id, `mensagem:${mensagem.id}`);
      const registro: AnaliseGuardada = { ...r, origem: req.user!.id, lidoEm: new Date().toISOString() };
      await guardarAnalise(mensagem.id, registro);
      return registro;
    });
  }),
);

// Extrato enviado direto na tela, sem passar pela conversa.
router.post(
  "/",
  uploadMemoria.single("arquivo"),
  asyncHandler(async (req, res) => {
    if (!leituraConfigurada()) return res.status(503).json({ error: "Leitura de extrato não configurada" });
    if (!req.file) return res.status(400).json({ error: "Envie um PDF ou uma imagem do extrato" });
    const arquivo = req.file;
    await responder(res, () => analisar(arquivo.buffer, arquivo.mimetype, arquivo.originalname, req.user!.id, "upload"));
  }),
);

export default router;
