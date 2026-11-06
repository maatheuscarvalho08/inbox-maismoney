import type { Convenio, StatusConversa } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { avancarEtapa } from "../funil/funil.service.js";

const INCLUDE_PADRAO = {
  contato: true,
  instancia: { select: { id: true, nome: true, numero: true, tipoConexao: true, status: true, maisaAtiva: true } },
  operador: { select: { id: true, nome: true, fotoPath: true } },
  etiquetas: { include: { etiqueta: true } },
  // Ids de quem da equipe já abriu essa conversa desde a última mensagem do
  // cliente — o front decide, com o próprio usuário logado, se a bolinha de
  // "não respondida" já pode sumir pra ele especificamente.
  visualizacoes: { select: { usuarioId: true } },
} as const;

export type AbaConversas = "maisa" | "sem_atendente" | "atribuidas" | "disparos";

// "disparos" = nasceu de um disparo e o lead ainda não respondeu — some dessa aba
// assim que chega a primeira resposta (ver evolutionWebhook/metaWebhook marcando
// respondida:true). As outras três são tudo o resto, separadas por quem está atendendo.
const JA_EM_ATENDIMENTO = { OR: [{ origemDisparo: false }, { respondida: true }] };

function filtroDaAba(aba: AbaConversas) {
  switch (aba) {
    case "disparos":
      return { origemDisparo: true, respondida: false };
    case "maisa":
      return { ...JA_EM_ATENDIMENTO, comMaisa: true };
    case "sem_atendente":
      return { ...JA_EM_ATENDIMENTO, comMaisa: false, operadorId: null };
    case "atribuidas":
      return { ...JA_EM_ATENDIMENTO, comMaisa: false, operadorId: { not: null } };
  }
}

// Contagem das conversas ainda ativas em cada aba, mostrada no topo da lista.
export async function contarAbas() {
  const contar = (aba: AbaConversas) =>
    prisma.conversa.count({ where: { ...filtroDaAba(aba), status: { not: "encerrada" } } });
  const [maisa, sem_atendente, atribuidas, disparos] = await Promise.all([
    contar("maisa"),
    contar("sem_atendente"),
    contar("atribuidas"),
    contar("disparos"),
  ]);
  return { maisa, sem_atendente, atribuidas, disparos };
}

export async function listConversas(status?: StatusConversa, aba?: AbaConversas) {
  return prisma.conversa.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(aba ? filtroDaAba(aba) : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      ...INCLUDE_PADRAO,
      mensagens: { take: 1, orderBy: { timestamp: "desc" } },
    },
  });
}

export async function getConversaById(id: string) {
  return prisma.conversa.findUnique({
    where: { id },
    include: INCLUDE_PADRAO,
  });
}

export async function atualizarConversa(
  id: string,
  data: { status?: StatusConversa; operadorId?: string | null; comMaisa?: boolean; convenio?: Convenio | null; convenioOrigem?: string },
) {
  return prisma.conversa.update({
    where: { id },
    data,
    include: INCLUDE_PADRAO,
  });
}

// entradaDoCliente: conversa nova iniciada pelo cliente começa com a Maisa se ela
// estiver ligada no número. Conversa aberta por um operador nunca começa com ela.
export async function findOrCreateConversaAberta(instanciaId: string, contatoId: string, entradaDoCliente = false) {
  const existente = await prisma.conversa.findFirst({
    where: { instanciaId, contatoId, status: { not: "encerrada" } },
    orderBy: { createdAt: "desc" },
  });
  if (existente) return existente;

  const instancia = entradaDoCliente ? await prisma.instancia.findUnique({ where: { id: instanciaId } }) : null;
  return prisma.conversa.create({
    data: { instanciaId, contatoId, status: "aberta", comMaisa: Boolean(instancia?.maisaAtiva) },
  });
}

// Usado só pelo módulo de disparos — se a conversa já existe (já é atendimento em
// andamento, por exemplo), não mexe em origemDisparo/respondida, só reaproveita.
export async function findOrCreateConversaDisparo(instanciaId: string, contatoId: string) {
  const existente = await prisma.conversa.findFirst({
    where: { instanciaId, contatoId, status: { not: "encerrada" } },
    orderBy: { createdAt: "desc" },
  });
  if (existente) return existente;

  return prisma.conversa.create({
    data: { instanciaId, contatoId, status: "aberta", origemDisparo: true, respondida: false },
  });
}

// Chamado quando chega uma mensagem do cliente — tira a conversa da aba "Disparos"
// (se ela estava lá) sem apagar a etiqueta azul de origem, e zera quem já tinha
// visto a conversa (mensagem nova = todo mundo precisa olhar de novo).
export async function marcarConversaRespondida(conversaId: string) {
  // Primeira resposta a um disparo entra como conversa nova: vai para a Maisa se ela
  // estiver ligada. Depois disso nunca volta sozinha, senão desfaria uma transferência.
  const conversa = await prisma.conversa.findUnique({ where: { id: conversaId }, include: { instancia: true } });
  const entraComMaisa = Boolean(conversa && !conversa.respondida && !conversa.operadorId && conversa.instancia.maisaAtiva);
  await prisma.conversa.update({
    where: { id: conversaId },
    data: { respondida: true, ...(entraComMaisa ? { comMaisa: true } : {}) },
  });
  // Cliente escreveu: a conversa passa a contar como lead no funil.
  if (conversa) await avancarEtapa(conversaId, "lead", conversa.etapaFunil);
  await prisma.conversaVisualizacao.deleteMany({ where: { conversaId } });
}

// Chamado quando um operador abre a conversa — a bolinha de "não respondida" some
// só pra ele; continua acesa pros colegas que ainda não abriram, até alguém
// responder de verdade (aí a checagem de remetenteTipo já resolve sozinha).
export async function marcarConversaVisualizada(conversaId: string, usuarioId: string) {
  await prisma.conversaVisualizacao.upsert({
    where: { conversaId_usuarioId: { conversaId, usuarioId } },
    update: { vistoEm: new Date() },
    create: { conversaId, usuarioId },
  });
}

export async function adicionarEtiqueta(conversaId: string, etiquetaId: string) {
  await prisma.conversaEtiqueta.upsert({
    where: { conversaId_etiquetaId: { conversaId, etiquetaId } },
    update: {},
    create: { conversaId, etiquetaId },
  });
  return getConversaById(conversaId);
}

export async function removerEtiqueta(conversaId: string, etiquetaId: string) {
  await prisma.conversaEtiqueta.deleteMany({ where: { conversaId, etiquetaId } });
  return getConversaById(conversaId);
}
