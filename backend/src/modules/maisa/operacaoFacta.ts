// Digitação na Facta: no máximo uma operação viva por cliente, com ponto sem volta
// explícito e rastro de toda exceção.
//
// Ciclo:
// 1. reservar (transação com trava por CPF no Postgres): cria a operação "preparada".
//    Bloqueia se o mesmo CPF tem operação preparada, irreversível, desconhecida, ou
//    concluída nos últimos 30 dias, em qualquer conversa ou número. Reaproveita a linha
//    da mesma chave se ela terminou sem proposta (falhou, invalidada) ou foi liberada.
// 2. o chamador confere se o cliente mandou mensagem depois do "sim" (com a operação já
//    gravada; o que chegar depois disso invalida a operação na própria gravação da
//    mensagem, ver mensagens.service.ts).
// 3. etapas 1 e 2 da Facta (não criam proposta).
// 4. ponto sem volta: "preparada" vira "irreversivel" numa atualização condicional. Se a
//    operação foi invalidada antes, a etapa 3 não é chamada.
// 5. etapa 3: só o código da proposta conta como sucesso; o resto é "desconhecida".
// 6. "concluida" e a proposta na tela de Propostas são gravadas na mesma transação.
//
// Nada é repetido automaticamente. "desconhecida" e "concluida" só deixam tentar de novo
// depois de liberação da equipe, com quem liberou e o motivo.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { ResultadoContratacao } from "./facta.js";
import type { EstadoMaisa, ResultadoDigitacao } from "./fluxo.js";

// Sem atualização há mais que isto, a operação é de um processo que caiu.
// Etapas 1 e 2 (e o refin da port) levam no máximo uns 2 minutos com o tempo padrão.
export const LIMITE_PREPARADA_MS = 4 * 60_000;
export const LIMITE_IRREVERSIVEL_MS = 4 * 60_000;
// Proposta concluída do mesmo CPF bloqueia uma nova por este tempo.
export const JANELA_CONCLUIDA_MS = 30 * 24 * 60 * 60_000;

const VIVAS = ["preparada", "irreversivel", "desconhecida"];
const REAPROVEITAVEIS = ["falhou", "invalidada", "liberada"];

export const cpfNormalizado = (cpf: string) => cpf.replace(/\D/g, "").padStart(11, "0");

// JSON com as chaves em ordem: o mesmo dado dá sempre o mesmo resumo.
function estavel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, estavel((v as Record<string, unknown>)[k])]));
  return v;
}
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(estavel(v))).digest("hex");

// Resumo dos dados efetivamente usados na proposta: cadastro, nascimento e contrato
// comprado. Qualquer correção muda o resumo.
export function versaoDados(estado: EstadoMaisa): string {
  return sha({ dados: estado.contrato?.dados ?? {}, nascimento: estado.dataNascimento ?? null, contrato: estado.alternativa?.numeroContrato ?? null });
}

// Cliente + produto + oferta + versão dos dados. Sem a conversa: o mesmo cliente com a
// mesma oferta e os mesmos dados em outro número dá a mesma chave.
export function chaveOperacao(cpf: string, estado: EstadoMaisa): { chave: string; tipo: string; versao: string } {
  const a = estado.alternativa;
  const oferta = a?.digitacao
    ? { tipo: "port_refin", port: a.digitacao.port, refin: a.digitacao.refin ?? null, banco: a.digitacao.bancoCodigo ?? null, parcela: a.digitacao.parcela }
    : { tipo: "novo", tabela: estado.oferta?.tabela ?? null };
  const versao = versaoDados(estado);
  return { chave: sha({ cpf: cpfNormalizado(cpf), produto: estado.produto ?? null, oferta, versao }), tipo: oferta.tipo, versao };
}

export type Reserva = { ok: true; operacaoId: string } | { ok: false; motivo: string; status: string; codigoAf?: string | null };

export async function reservar(conversaId: string, cpf: string, estado: EstadoMaisa, agora = new Date()): Promise<Reserva> {
  const doc = cpfNormalizado(cpf);
  const { chave, tipo, versao } = chaveOperacao(doc, estado);
  return prisma.$transaction(async (tx) => {
    // Uma reserva por CPF de cada vez, em qualquer processo: a checagem e a gravação
    // ficam dentro da mesma trava.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"facta:" + doc}))`;
    const mesma = await tx.operacaoFacta.findUnique({ where: { chave } });
    if (mesma && !REAPROVEITAVEIS.includes(mesma.status)) {
      return { ok: false as const, motivo: `esta oferta, com estes mesmos dados, já tem uma digitação (${mesma.status})`, status: mesma.status, codigoAf: mesma.codigoAf };
    }
    const outra = await tx.operacaoFacta.findFirst({
      where: {
        cpf: doc,
        chave: { not: chave },
        OR: [{ status: { in: VIVAS } }, { status: "concluida", updatedAt: { gte: new Date(agora.getTime() - JANELA_CONCLUIDA_MS) } }],
      },
      orderBy: { createdAt: "desc" },
    });
    if (outra) {
      return {
        ok: false as const,
        motivo: `o CPF já tem uma digitação ${outra.status}${outra.codigoAf ? ` (proposta ${outra.codigoAf})` : ""}${outra.conversaId !== conversaId ? " em outra conversa" : ""}`,
        status: outra.status,
        codigoAf: outra.codigoAf,
      };
    }
    if (mesma) {
      const r = await tx.operacaoFacta.update({
        where: { id: mesma.id },
        data: { conversaId, status: "preparada", tentativas: { increment: 1 }, etapa: null, erro: null, codigoAf: null, url: null, irreversivelEm: null },
      });
      registrar("reaproveitada", conversaId, r.id, mesma.status);
      return { ok: true as const, operacaoId: r.id };
    }
    const r = await tx.operacaoFacta.create({ data: { conversaId, cpf: doc, chave, tipo, versaoDados: versao, status: "preparada" } });
    registrar("reservada", conversaId, r.id, "preparada");
    return { ok: true as const, operacaoId: r.id };
  });
}

// O ponto sem volta. Só passa se ninguém invalidou a operação até aqui.
export async function passarPontoSemVolta(operacaoId: string): Promise<boolean> {
  const r = await prisma.operacaoFacta.updateMany({ where: { id: operacaoId, status: "preparada" }, data: { status: "irreversivel", irreversivelEm: new Date() } });
  registrar(r.count ? "ponto_sem_volta" : "ponto_sem_volta_recusado", null, operacaoId, null);
  return r.count === 1;
}

export async function invalidar(operacaoId: string, motivo: string) {
  await prisma.operacaoFacta.updateMany({ where: { id: operacaoId, status: "preparada" }, data: { status: "invalidada", erro: motivo.slice(0, 500) } });
}

// Proposta para a tela de Propostas, gravada junto com a conclusão da operação.
export interface PropostaDaOperacao {
  conversaId: string;
  convenio: "inss" | "siape" | null;
  valorCentavos: number;
  parcelaCentavos: number | null;
  prazoMeses: number | null;
}

// Executa a digitação reservada. Nunca lança por causa da Facta: devolve o resultado.
export async function executarReservada(operacaoId: string, proposta: PropostaDaOperacao, executar: () => Promise<ResultadoContratacao>): Promise<ResultadoDigitacao> {
  let resultado: ResultadoContratacao;
  try {
    resultado = await executar();
  } catch (err) {
    resultado = { tipo: "erro", etapa: "antes do cadastro da proposta", mensagem: err instanceof Error ? err.message : String(err) };
  }
  const atual = await prisma.operacaoFacta.findUniqueOrThrow({ where: { id: operacaoId } });
  // Exceção depois do ponto sem volta (a etapa 3 em si nunca lança): resultado incerto.
  if (resultado.tipo === "erro" && atual.status === "irreversivel") {
    resultado = { tipo: "desconhecido", etapa: "cadastro da proposta", mensagem: resultado.mensagem };
  }
  if (resultado.tipo === "enviada") {
    const r = resultado;
    // Registro antes de gravar: se o banco cair agora, o código da proposta fica no log.
    registrar("concluida_facta", proposta.conversaId, operacaoId, r.codigoAf);
    await prisma.$transaction([
      prisma.operacaoFacta.update({ where: { id: operacaoId }, data: { status: "concluida", etapa: "concluida", codigoAf: r.codigoAf, url: r.url || null, erro: null } }),
      prisma.proposta.create({
        data: {
          conversaId: proposta.conversaId,
          banco: "Facta",
          convenio: proposta.convenio,
          valorCentavos: proposta.valorCentavos,
          parcelaCentavos: proposta.parcelaCentavos,
          prazoMeses: proposta.prazoMeses,
          numeroContrato: r.codigoAf,
        },
      }),
    ]);
    return r;
  }
  if (resultado.tipo === "desconhecido") {
    await prisma.operacaoFacta.update({ where: { id: operacaoId }, data: { status: "desconhecida", etapa: resultado.etapa, erro: resultado.mensagem.slice(0, 500) } });
    registrar("desconhecida", proposta.conversaId, operacaoId, resultado.etapa);
    return resultado;
  }
  if (resultado.tipo === "abortada") {
    registrar("abortada", proposta.conversaId, operacaoId, null);
    return resultado;
  }
  // Falha antes da etapa 3. Se a operação foi invalidada no meio, continua invalidada.
  await prisma.operacaoFacta.updateMany({ where: { id: operacaoId, status: "preparada" }, data: { status: "falhou", etapa: resultado.etapa, erro: resultado.mensagem.slice(0, 500) } });
  registrar("falhou", proposta.conversaId, operacaoId, resultado.etapa);
  return resultado;
}

// Operações de processo que caiu. "preparada" parada: a etapa 3 não foi chamada, então
// nada foi criado e a reserva é liberada. "irreversivel" parada: a etapa 3 pode ter sido
// chamada, vira "desconhecida" e vai para a equipe.
export async function recuperarOperacoesPresas(agora = new Date()): Promise<{ id: string; conversaId: string; codigoAf: string | null }[]> {
  await prisma.operacaoFacta.updateMany({
    where: { status: "preparada", updatedAt: { lt: new Date(agora.getTime() - LIMITE_PREPARADA_MS) } },
    data: { status: "falhou", erro: "processo interrompido antes do ponto sem volta: a etapa 3 não foi chamada" },
  });
  const presas = await prisma.operacaoFacta.findMany({
    where: { status: "irreversivel", updatedAt: { lt: new Date(agora.getTime() - LIMITE_IRREVERSIVEL_MS) } },
    select: { id: true, conversaId: true, codigoAf: true },
  });
  const viradas: typeof presas = [];
  for (const op of presas) {
    const r = await prisma.operacaoFacta.updateMany({
      where: { id: op.id, status: "irreversivel" },
      data: { status: "desconhecida", erro: "processo interrompido depois do ponto sem volta: a proposta pode existir" },
    });
    if (r.count) {
      registrar("presa_desconhecida", op.conversaId, op.id, "irreversivel");
      viradas.push(op);
    }
  }
  return viradas;
}

// A equipe conferiu no portal e autoriza uma nova tentativa. Fica registrado quem e por quê.
export async function liberarOperacao(operacaoId: string, usuarioId: string, motivo: string) {
  const m = motivo.trim();
  if (m.length < 5) throw new Error("motivo da liberação obrigatório");
  const r = await prisma.operacaoFacta.updateMany({
    where: { id: operacaoId, status: { in: ["desconhecida", "concluida", "falhou", "invalidada"] } },
    data: { status: "liberada", liberadaPor: usuarioId, liberadaEm: new Date(), motivoLiberacao: m.slice(0, 500) },
  });
  if (!r.count) throw new Error("operação não pode ser liberada nesta situação");
  registrar("liberada", null, operacaoId, usuarioId);
}

export function listarOperacoes(conversaId: string, tx: Prisma.TransactionClient = prisma) {
  return tx.operacaoFacta.findMany({ where: { conversaId }, orderBy: { createdAt: "desc" } });
}

// Registro estruturado, sem dado pessoal.
function registrar(evento: string, conversaId: string | null, operacaoId: string, detalhe: string | null) {
  console.log(JSON.stringify({ origem: "maisa", tipo: "operacao_facta", evento, conversaId, operacaoId, detalhe }));
}
