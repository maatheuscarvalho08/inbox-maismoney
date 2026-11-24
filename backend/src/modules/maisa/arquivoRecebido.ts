// Depois que a Maisa processou o arquivo do cliente, o balão ganha uma linha dizendo do que se trata e o que
// há nele (RG, contracheque, comprovante...). Só escreve se a análise de extrato não escreveu uma melhor.
import { prisma } from "../../db/prisma.js";
import { emitNovaMensagem } from "../../ws/events.js";
import { FORMATOS_EXTRATO, lerArquivo } from "./midia.js";
import { lerArquivoGeral, resumoDoArquivo } from "./arquivoGeral.js";
import { env } from "../../config/env.js";
import type { Prisma } from "@prisma/client";

export async function resumirArquivoRecebido(mensagemId: string) {
  if (!env.OPENAI_API_KEY) return;
  const m = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
  const tipo = m?.tipoMidia?.split(";")[0].trim();
  if (!m || m.remetenteTipo !== "cliente" || !m.midiaPath || m.midiaDeleted || !tipo || !FORMATOS_EXTRATO.includes(tipo)) return;
  // Uma leitura boa de extrato já está no balão.
  if (m.analiseResumo && !m.analiseResumo.startsWith("Não é extrato")) return;
  const lido = await lerArquivoGeral(await lerArquivo(m.midiaPath), tipo);
  const dados = { origem: "arquivo", arquivoGeral: lido, lidoEm: new Date().toISOString() } as unknown as Prisma.InputJsonValue;
  // Os dados pessoais ficam nesta linha, que o job de limpeza apaga junto com o arquivo.
  await prisma.analiseExtrato.upsert({
    where: { mensagemId },
    create: { mensagemId, dados, origem: "arquivo" },
    update: { dados, origem: "arquivo", createdAt: new Date() },
  });
  const atualizada = await prisma.mensagem.update({
    where: { id: mensagemId },
    data: { analiseResumo: resumoDoArquivo(lido) },
    include: {
      operador: { select: { id: true, nome: true, fotoPath: true } },
      respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
    },
  });
  try {
    emitNovaMensagem(atualizada);
  } catch {
    /* sem socket */
  }
}
