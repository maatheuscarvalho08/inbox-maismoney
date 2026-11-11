// Análises de extrato guardadas por mensagem. A Maisa e a equipe leem o mesmo arquivo
// uma vez só; quem abrir depois vê a análise salva e o motivo de não ter passado.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { emitNovaMensagem } from "../../ws/events.js";
import type { AnaliseExtrato } from "./analise.js";

export interface AnaliseGuardada {
  leitura: unknown;
  analise: AnaliseExtrato;
  modelo: string;
  tokens: { entrada: number | null; saida: number | null };
  // Quem leu: "maisa" ou o id de quem pediu na tela.
  origem: string;
  lidoEm: string;
  // Quando a Maisa recusou antes da análise (documento errado ou ilegível).
  recusa?: string;
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Uma linha para o balão do arquivo: o que dá para fazer ou por que não passou.
export function resumoAnalise(g: Pick<AnaliseGuardada, "analise" | "recusa">): string {
  const duvida = g.analise.confiavel ? "" : " Leitura com dúvida, confira os números.";
  if (g.recusa) return `Não passou: ${g.recusa}.`;
  const novo = g.analise.possibilidades.find((p) => p.tipo === "novo");
  if (novo?.tipo === "novo" && novo.possivel) {
    return `Empréstimo novo com parcela até ${reais(novo.parcelaMaxima)}. ${g.analise.resumo}${duvida}`;
  }
  return `Não passou: ${novo?.motivo ?? g.analise.resumo}${duvida}`;
}

export async function analiseGuardada(mensagemId: string): Promise<AnaliseGuardada | null> {
  const linha = await prisma.analiseExtrato.findUnique({ where: { mensagemId } });
  return (linha?.dados as unknown as AnaliseGuardada) ?? null;
}

export async function guardarAnalise(mensagemId: string, dados: AnaliseGuardada) {
  const json = dados as unknown as Prisma.InputJsonValue;
  await prisma.analiseExtrato.upsert({
    where: { mensagemId },
    create: { mensagemId, dados: json, origem: dados.origem },
    update: { dados: json, origem: dados.origem, createdAt: new Date() },
  });
  // O balão do arquivo atualiza na hora para quem está com a conversa aberta.
  const mensagem = await prisma.mensagem.update({
    where: { id: mensagemId },
    data: { analiseResumo: resumoAnalise(dados) },
    include: {
      operador: { select: { id: true, nome: true, fotoPath: true } },
      respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
    },
  });
  // Fora do servidor (script de reprocessamento) não há socket: só grava.
  try {
    emitNovaMensagem(mensagem);
  } catch {
    /* sem socket */
  }
}
