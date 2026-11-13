import { Prisma, type RemetenteTipo, type StatusEntrega } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { invalidaConfirmacao } from "../maisa/ordemMensagens.js";
import { emitAvisoMaisa, emitNovaMensagem } from "../../ws/events.js";

const INCLUDE_RESPOSTA = {
  operador: { select: { id: true, nome: true, fotoPath: true } },
  respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
} as const;

export async function listMensagensPorConversa(conversaId: string) {
  const mensagens = await prisma.mensagem.findMany({
    where: { conversaId },
    orderBy: { timestamp: "asc" },
    include: INCLUDE_RESPOSTA,
  });
  // Situação na fila de saída da Maisa: pendente, processando, enviado, falhou ou incerto.
  // Mensagem na fila não é "sugestão": a tela não oferece o botão Enviar para ela.
  const saidas = await prisma.saidaMaisa.findMany({ where: { conversaId }, select: { mensagemId: true, status: true } });
  const porMensagem = new Map(saidas.map((s) => [s.mensagemId, s.status]));
  return mensagens.map((m) => ({ ...m, saidaStatus: porMensagem.get(m.id) ?? null }));
}

// A mensagem está (ou esteve) na fila de saída da Maisa? Enviar na mão duplicaria.
export async function situacaoNaFila(mensagemId: string) {
  return (await prisma.saidaMaisa.findUnique({ where: { mensagemId }, select: { status: true } }))?.status ?? null;
}

interface CriarMensagemInput {
  conversaId: string;
  remetenteTipo: RemetenteTipo;
  operadorId?: string | null;
  conteudoTexto?: string | null;
  tipoMidia?: string | null;
  midiaPath?: string | null;
  externalId?: string | null;
  statusEntrega?: StatusEntrega | null;
  erroEntrega?: string | null;
  loteId?: string | null;
  templateNome?: string | null;
  respondeAId?: string | null;
  timestamp?: Date;
}

// Retorna null se a mensagem já existe (reentrega de webhook) — o chamador deve
// simplesmente não emitir evento nenhum nesse caso, já foi processada da primeira vez.
export async function criarMensagem(input: CriarMensagemInput) {
  if (input.externalId) {
    const existente = await prisma.mensagem.findUnique({ where: { externalId: input.externalId } });
    if (existente) return null;
  }

  const relevante = input.remetenteTipo === "cliente" && invalidaConfirmacao({ conteudoTexto: input.conteudoTexto ?? null, tipoMidia: input.tipoMidia ?? null });
  const saida: { alerta: Awaited<ReturnType<typeof sincronizarDigitacao>> } = { alerta: null };
  let mensagem;
  try {
    mensagem = await prisma.$transaction(async (tx) => {
      const m = await tx.mensagem.create({ data: input, include: INCLUDE_RESPOSTA });
      await tx.conversa.update({ where: { id: input.conversaId }, data: { lastMessageAt: m.timestamp } });
      if (relevante) saida.alerta = await sincronizarDigitacao(tx, input.conversaId, m.conteudoTexto, m.tipoMidia);
      return m;
    });
  } catch (err) {
    // Dois webhooks iguais ao mesmo tempo: o segundo bate na chave única do externalId.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.externalId) return null;
    throw err;
  }

  const a = saida.alerta;
  if (a) {
    try {
      emitNovaMensagem(a.nota);
      emitAvisoMaisa({ tipo: "mensagem_apos_digitacao", conversaId: input.conversaId, nome: a.nome });
    } catch {
      // Sem socket (scripts e testes): a nota já está gravada.
    }
  }
  return mensagem;
}

// Na mesma transação que grava a mensagem do cliente:
// - digitação ainda "preparada" (antes do ponto sem volta) é invalidada: a etapa 3 da
//   Facta não será chamada. A troca para "irreversivel" é uma atualização condicional na
//   mesma linha: o Postgres ordena as duas e só uma vence;
// - digitação que já passou do ponto sem volta (ou terminou há pouco) não muda, e a equipe
//   recebe uma nota: a proposta foi feita com os dados de antes.
async function sincronizarDigitacao(tx: Prisma.TransactionClient, conversaId: string, texto: string | null, tipoMidia: string | null) {
  await tx.operacaoFacta.updateMany({
    where: { conversaId, status: "preparada" },
    data: { status: "invalidada", erro: "mensagem do cliente antes do ponto sem volta" },
  });
  const depois = await tx.operacaoFacta.findFirst({
    where: {
      conversaId,
      OR: [{ status: "irreversivel" }, { status: { in: ["concluida", "desconhecida"] }, irreversivelEm: { gte: new Date(Date.now() - 30 * 60_000) } }],
    },
    orderBy: { createdAt: "desc" },
    include: { conversa: { include: { contato: { select: { nome: true } } } } },
  });
  if (!depois) return null;
  const conteudo = texto ? `"${texto.slice(0, 160)}"` : `um arquivo (${tipoMidia ?? "mídia"})`;
  const nota = await tx.mensagem.create({
    data: {
      conversaId,
      remetenteTipo: "nota",
      conteudoTexto:
        `ATENÇÃO: o cliente mandou ${conteudo} depois do ponto sem volta da digitação na Facta` +
        `${depois.codigoAf ? ` (proposta ${depois.codigoAf})` : ""}. A proposta foi feita com os dados de antes desta mensagem. ` +
        "Nada foi corrigido nela: confira com o cliente e, se preciso, cancele e refaça no portal.",
    },
    include: INCLUDE_RESPOSTA,
  });
  return { nota, nome: depois.conversa.contato.nome };
}
