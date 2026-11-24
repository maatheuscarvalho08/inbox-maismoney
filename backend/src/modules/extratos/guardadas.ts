// Análises de extrato guardadas por mensagem. A Maisa e a equipe leem o mesmo arquivo
// uma vez só; quem abrir depois vê a análise salva e o motivo de não ter passado.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { emitNovaMensagem } from "../../ws/events.js";
import type { AnaliseExtrato } from "./analise.js";
import type { ExtratoLido } from "./leitor.js";

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

// Uma linha para o balão do arquivo: o que é o documento e o que há nele. Sem dizer se a simulação
// passa: quem simula é o banco, e isso aparece na nota da conversa.
export function resumoAnalise(g: Pick<AnaliseGuardada, "analise" | "recusa"> & { leitura?: unknown }): string {
  const l = (g.leitura ?? {}) as Partial<ExtratoLido>;
  const duvida = g.analise?.confiavel === false ? " · leitura com dúvida, confira os números" : "";
  if (g.recusa) return `Não é extrato: ${g.recusa}`;
  const tipo =
    l.tipo_documento === "inss"
      ? "Extrato do INSS"
      : l.tipo_documento === "siape"
        ? l.documento_siape === "contracheque"
          ? "Contracheque SIAPE"
          : l.documento_siape === "extrato_consignacoes"
            ? "Extrato de consignações SIAPE"
            : "Documento SIAPE"
        : "Documento";
  const partes: string[] = [];
  if (l.matricula) partes.push(`matrícula ${l.matricula}`);
  if (l.vinculo_siape && l.vinculo_siape !== "nao_informado") partes.push(`vínculo ${l.vinculo_siape.replace(/_/g, " ")}`);
  if (l.orgao) partes.push(l.orgao);
  const margem = l.margens_informadas?.emprestimo;
  if (margem != null) partes.push(`margem livre ${reais(margem)}`);
  else if (l.renda_bruta != null) partes.push(`bruto ${reais(l.renda_bruta)}`);
  const contratos = (l.contratos ?? []).filter((c) => c.situacao !== "excluido");
  if (contratos.length) {
    const lista = contratos.slice(0, 4).map((c) => [c.banco_nome ?? c.banco_codigo, c.parcela != null ? reais(c.parcela) : null].filter(Boolean).join(" "));
    partes.push(`${contratos.length} contrato(s): ${lista.join("; ")}${contratos.length > 4 ? "…" : ""}`);
  }
  if (l.conta_outras_banco) partes.push(`outras operações: ${l.conta_outras_banco}`);
  return `${tipo}${partes.length ? ` · ${partes.join(" · ")}` : ""}${duvida}`;
}

export async function analiseGuardada(mensagemId: string): Promise<AnaliseGuardada | null> {
  const linha = await prisma.analiseExtrato.findUnique({ where: { mensagemId } });
  const dados = linha?.dados as unknown as (AnaliseGuardada & { origem?: string }) | null | undefined;
  // Leitura geral de RG, contracheque etc. (origem "arquivo") não é análise de extrato.
  if (!dados || !dados.analise) return null;
  return dados;
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
    data: { analiseResumo: resumoAnalise({ ...dados, leitura: dados.leitura }) },
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
