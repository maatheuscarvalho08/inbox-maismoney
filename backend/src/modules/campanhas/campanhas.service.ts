import { prisma } from "../../db/prisma.js";
import { emitCampanhaAtualizada } from "../../ws/events.js";

export async function listCampanhas() {
  return prisma.campanhaDiscadora.findMany({
    include: { template: true, instancia: true, criador: { select: { id: true, nome: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampanhaComResumo(id: string) {
  const campanha = await prisma.campanhaDiscadora.findUnique({
    where: { id },
    include: {
      template: true,
      instancia: true,
      criador: { select: { id: true, nome: true } },
      numeros: { orderBy: { id: "asc" } },
    },
  });
  if (!campanha) return null;

  return { ...campanha, resumo: calcularResumo(campanha.numeros) };
}

export function calcularResumo(numeros: { statusLigacao: string; apertou1: boolean }[]) {
  return {
    total: numeros.length,
    pendente: numeros.filter((n) => n.statusLigacao === "pendente").length,
    discando: numeros.filter((n) => n.statusLigacao === "discando").length,
    atendeu: numeros.filter((n) => n.statusLigacao === "atendeu").length,
    naoAtendeu: numeros.filter((n) => n.statusLigacao === "nao_atendeu").length,
    ocupado: numeros.filter((n) => n.statusLigacao === "ocupado").length,
    erro: numeros.filter((n) => n.statusLigacao === "erro").length,
    convertido: numeros.filter((n) => n.apertou1).length,
  };
}

interface CriarCampanhaInput {
  nome: string;
  audioPath: string;
  templateId: string;
  instanciaId: string;
  criadoPor: string;
  numeros: { numeroWhatsapp: string; nomeContato?: string }[];
}

export async function criarCampanha(input: CriarCampanhaInput) {
  return prisma.campanhaDiscadora.create({
    data: {
      nome: input.nome,
      audioPath: input.audioPath,
      templateId: input.templateId,
      instanciaId: input.instanciaId,
      criadoPor: input.criadoPor,
      totalNumeros: input.numeros.length,
      numeros: { createMany: { data: input.numeros } },
    },
    include: { numeros: true },
  });
}

export async function emitirAtualizacaoCampanha(campanhaId: string) {
  const campanha = await getCampanhaComResumo(campanhaId);
  if (campanha) emitCampanhaAtualizada(campanha);
}
