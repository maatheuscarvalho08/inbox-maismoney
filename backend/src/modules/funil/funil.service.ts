import type { Convenio, EtapaFunil } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

const ORDEM: EtapaFunil[] = [
  "lead",
  "dados_coletados",
  "simulacao",
  "simulacao_com_saldo",
  "proposta_digitada",
  "proposta_paga",
];

// Grava a etapa e todas as anteriores, para o funil não ter buraco se alguém pular uma.
// Voltar uma etapa, corrigindo um engano, apaga os registros das etapas seguintes.
export async function definirEtapa(conversaId: string, etapa: EtapaFunil) {
  const indice = ORDEM.indexOf(etapa);
  await prisma.$transaction([
    prisma.funilEvento.createMany({
      data: ORDEM.slice(0, indice + 1).map((e) => ({ conversaId, etapa: e })),
      skipDuplicates: true,
    }),
    prisma.funilEvento.deleteMany({ where: { conversaId, etapa: { in: ORDEM.slice(indice + 1) } } }),
    prisma.conversa.update({ where: { id: conversaId }, data: { etapaFunil: etapa } }),
  ]);
}

// Avanço automático (cliente escreveu, CPF cadastrado): nunca faz a conversa voltar.
export async function avancarEtapa(conversaId: string, etapa: EtapaFunil, atual: EtapaFunil | null) {
  if (atual && ORDEM.indexOf(atual) >= ORDEM.indexOf(etapa)) return;
  await definirEtapa(conversaId, etapa);
}

async function contarPorEtapa(inicio: Date, fim: Date, convenio?: Convenio) {
  const grupos = await prisma.funilEvento.groupBy({
    by: ["etapa"],
    _count: { _all: true },
    where: {
      conversa: {
        ...(convenio ? { convenio } : {}),
        eventosFunil: { some: { etapa: "lead", createdAt: { gte: inicio, lt: fim } } },
      },
    },
  });
  return ORDEM.map((etapa) => grupos.find((g) => g.etapa === etapa)?._count._all ?? 0);
}

function conversao(totais: number[], i: number) {
  return i > 0 && totais[i - 1] > 0 ? (totais[i] / totais[i - 1]) * 100 : null;
}

// Acompanha os leads que entraram no período até onde eles chegaram, mesmo que a etapa
// tenha acontecido depois. A comparação é com o período anterior, de mesmo tamanho.
export async function relatorioFunil(dias: number, convenio?: Convenio) {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const inicioAnterior = new Date(inicio.getTime() - dias * 24 * 60 * 60 * 1000);

  const [atual, anterior] = await Promise.all([
    contarPorEtapa(inicio, fim, convenio),
    contarPorEtapa(inicioAnterior, inicio, convenio),
  ]);

  return ORDEM.map((etapa, i) => ({
    etapa,
    total: atual[i],
    pctDoTopo: atual[0] > 0 ? (atual[i] / atual[0]) * 100 : 0,
    conversao: conversao(atual, i),
    conversaoAnterior: conversao(anterior, i),
  }));
}
