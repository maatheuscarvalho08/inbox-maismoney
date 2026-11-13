// Fila de saída da Maisa (transactional outbox).
//
// As respostas são gravadas (mensagem + linha em saidas_maisa) dentro da MESMA transação
// que muda o estado da conversa: ou tudo fica gravado, ou nada. Depois, o despachante
// entrega uma de cada vez por conversa, na ordem.
//
// Situações: pendente -> processando -> enviado | pendente (nova tentativa) | falhou | incerto.
// - Só reenvia quando há prova de que a mensagem não saiu (ver falhaEnvio.ts).
// - Envio que não terminou (processo caiu, travado_ate venceu) vira "incerto" e nunca é
//   reenviado: o provedor pode ter aceitado. Entrega exatamente uma vez não existe sem
//   garantia do provedor; o que existe é "no máximo uma vez, e o resto vai para a equipe".
// - Falha definitiva ou incerta: a conversa sai da Maisa na hora, as mensagens seguintes
//   não saem, a equipe recebe nota e aviso.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { entregarMensagem } from "../mensagens/entrega.js";
import { emitAvisoMaisa, emitConversaAtualizada, emitNovaMensagem } from "../../ws/events.js";
import { getConversaById } from "../conversas/conversas.service.js";
import { DONO_PROCESSO, portasMaisa } from "./portasMaisa.js";
import type { EstadoMaisa } from "./fluxo.js";

const INCLUDE = {
  operador: { select: { id: true, nome: true, fotoPath: true } },
  respondeA: { select: { id: true, conteudoTexto: true, tipoMidia: true, remetenteTipo: true } },
} as const;

let contador = 0;
// Ordem crescente dentro do processo. Entre processos, o lease da conversa impede duas
// gravações ao mesmo tempo, então o relógio basta para ordenar.
const proximaOrdem = () => BigInt(Date.now()) * 1000n + BigInt(contador++ % 1000);

// Grava as respostas na transação de quem chama. enviar=false (copiloto, conversa de
// teste): ficam só como mensagem da Maisa, sem saída.
export async function registrarSaidas(tx: Prisma.TransactionClient, conversaId: string, textos: string[], enviar: boolean) {
  const criadas = [];
  for (const texto of textos) {
    const m = await tx.mensagem.create({ data: { conversaId, remetenteTipo: "maisa", conteudoTexto: texto }, include: INCLUDE });
    if (enviar) await tx.saidaMaisa.create({ data: { conversaId, mensagemId: m.id, ordem: proximaOrdem(), proximaEm: new Date() } });
    criadas.push(m);
  }
  return criadas;
}

export async function criarNota(tx: Prisma.TransactionClient, conversaId: string, texto: string) {
  return tx.mensagem.create({ data: { conversaId, remetenteTipo: "nota", conteudoTexto: texto }, include: INCLUDE });
}

interface Reservada {
  id: string;
  conversaId: string;
  mensagemId: string;
  tentativas: number;
}

// Pega a próxima saída que pode sair agora: pendente, na hora, sem outra anterior da
// mesma conversa ainda pendente ou em envio. SKIP LOCKED: dois despachantes nunca pegam
// a mesma linha.
async function reservarProxima(conversaId: string | null): Promise<Reservada | null> {
  const segundos = Math.ceil(env.EVOLUTION_TIMEOUT_MS / 1000) + 45;
  const linhas = await prisma.$queryRaw<Reservada[]>`
    UPDATE saidas_maisa SET status = 'processando', travado_ate = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${segundos}),
      travado_por = ${DONO_PROCESSO}, tentativas = tentativas + 1, updated_at = (now() AT TIME ZONE 'UTC')
    WHERE id = (
      SELECT s.id FROM saidas_maisa s
      WHERE s.status = 'pendente' AND s.proxima_em <= (now() AT TIME ZONE 'UTC')
        AND (${conversaId}::text IS NULL OR s.conversa_id = ${conversaId})
        AND NOT EXISTS (
          SELECT 1 FROM saidas_maisa a
          WHERE a.conversa_id = s.conversa_id AND a.ordem < s.ordem AND a.status IN ('pendente', 'processando'))
      ORDER BY s.ordem
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
    RETURNING id, conversa_id AS "conversaId", mensagem_id AS "mensagemId", tentativas`;
  return linhas[0] ?? null;
}

// Despachos em andamento neste processo, para os testes e o desligamento esperarem.
const emAndamento = new Set<Promise<number>>();
export async function aguardarDespachos() {
  while (emAndamento.size) await Promise.allSettled([...emAndamento]);
}

// Entrega o que estiver na vez. conversaId: só daquela conversa (logo depois de gravar).
export function despachar(conversaId: string | null = null, limite = 50): Promise<number> {
  const p = despacharAgora(conversaId, limite);
  emAndamento.add(p);
  void p.finally(() => emAndamento.delete(p)).catch(() => {});
  return p;
}

async function despacharAgora(conversaId: string | null, limite: number) {
  let feitas = 0;
  for (; feitas < limite; feitas++) {
    const s = await reservarProxima(conversaId);
    if (!s) break;
    await enviarReservada(s);
  }
  return feitas;
}

async function enviarReservada(s: Reservada) {
  const mensagem = await prisma.mensagem.findUnique({ where: { id: s.mensagemId } });
  const conversa = mensagem && (await prisma.conversa.findUnique({ where: { id: s.conversaId }, include: { contato: true, instancia: true } }));
  if (!mensagem || !conversa) {
    await finalizar(s, "falhou", "mensagem ou conversa não encontrada");
    return;
  }
  const r = await entregarMensagem(mensagem, conversa, null, { digitandoMs: s.tentativas === 1 ? portasMaisa.digitando(mensagem.conteudoTexto ?? "") : 0 });
  await prisma.mensagem.update({ where: { id: mensagem.id }, data: { tentativasEntrega: s.tentativas } });
  emitirSemFalhar(() => emitNovaMensagem({ ...mensagem, statusEntrega: r.entregue ? "enviado" : "falhou", erroEntrega: r.erroEntrega ?? null, tentativasEntrega: s.tentativas }));
  if (r.entregue) {
    await finalizar(s, "enviado", null);
    return;
  }
  registrar("falha_envio", s, r.falha, r.erroEntrega);
  if (r.falha === "nao_enviada" && s.tentativas < env.MAISA_ENTREGA_TENTATIVAS) {
    // Volta para a fila com espera. Continua bloqueando as seguintes da conversa.
    await prisma.saidaMaisa.updateMany({
      where: { id: s.id, status: "processando", travadoPor: DONO_PROCESSO },
      data: { status: "pendente", travadoAte: null, travadoPor: null, erro: r.erroEntrega ?? null, proximaEm: new Date(Date.now() + portasMaisa.esperaReenvioMs(s.tentativas)) },
    });
    return;
  }
  const final = r.falha === "incerta" ? "incerto" : "falhou";
  if (await finalizar(s, final, r.erroEntrega ?? "falha desconhecida")) {
    await tirarDaMaisaPorEntrega(s.conversaId, s.mensagemId, final, `${r.falha}: ${r.erroEntrega ?? "sem detalhe"}, ${s.tentativas} tentativa(s)`);
  }
}

// Só quem reservou fecha a saída. Se o prazo venceu e a recuperação já marcou "incerto",
// esta gravação não acontece.
async function finalizar(s: Reservada, status: "enviado" | "falhou" | "incerto", erro: string | null) {
  const r = await prisma.saidaMaisa.updateMany({
    where: { id: s.id, status: "processando", travadoPor: DONO_PROCESSO },
    data: { status, erro, travadoAte: null },
  });
  return r.count === 1;
}

// Envio que não terminou dentro do prazo: o processo caiu ou travou. Pode ter saído,
// então vira "incerto", nunca "pendente".
export async function recuperarSaidas() {
  const vencidas = await prisma.$queryRaw<{ id: string; conversaId: string; mensagemId: string }[]>`
    UPDATE saidas_maisa SET status = 'incerto', erro = 'envio interrompido (processo caiu ou travou): pode ter chegado ou não', updated_at = (now() AT TIME ZONE 'UTC')
    WHERE status = 'processando' AND travado_ate < (now() AT TIME ZONE 'UTC')
    RETURNING id, conversa_id AS "conversaId", mensagem_id AS "mensagemId"`;
  for (const v of vencidas) await tirarDaMaisaPorEntrega(v.conversaId, v.mensagemId, "incerto", "envio interrompido no meio");
  return vencidas.length + (await despachar());
}

// O provedor avisou depois (webhook de status) que uma mensagem da Maisa falhou.
// Repetido não faz nada: a mudança de "enviado" para "falhou" só acontece uma vez.
export async function falhaInformadaPeloProvedor(mensagemId: string, erro: string) {
  const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
  if (!mensagem || mensagem.remetenteTipo !== "maisa") return;
  const s = await prisma.saidaMaisa.updateMany({ where: { mensagemId, status: { in: ["enviado", "incerto"] } }, data: { status: "falhou", erro: `aceita e depois rejeitada pelo provedor: ${erro}`.slice(0, 500) } });
  const semSaida = !(await prisma.saidaMaisa.count({ where: { mensagemId } }));
  if (s.count || semSaida) await tirarDaMaisaPorEntrega(mensagem.conversaId, mensagemId, "falhou", `o provedor avisou depois do envio que a mensagem não foi entregue (${erro})`);
}

// O provedor confirmou a entrega de uma mensagem que ficou "incerta": avisa a equipe.
export async function entregaConfirmadaPeloProvedor(mensagemId: string) {
  const s = await prisma.saidaMaisa.findUnique({ where: { mensagemId } });
  if (s?.status !== "incerto") return;
  const r = await prisma.saidaMaisa.updateMany({ where: { id: s.id, status: "incerto" }, data: { status: "enviado", erro: "confirmada depois pelo provedor" } });
  if (!r.count) return;
  const nota = await prisma.mensagem.create({ data: { conversaId: s.conversaId, remetenteTipo: "nota", conteudoTexto: "A mensagem da Maisa que estava com entrega incerta chegou ao cliente (o provedor confirmou). Não precisa reenviar." }, include: INCLUDE });
  emitirSemFalhar(() => emitNovaMensagem(nota));
}

// A Maisa não pode seguir esperando resposta se a própria mensagem não chegou: a conversa
// sai dela na hora (mesma atualização do estado), as próximas saídas são canceladas e a
// equipe recebe nota e aviso.
export async function tirarDaMaisaPorEntrega(conversaId: string, mensagemId: string, tipo: "falhou" | "incerto", detalhe: string) {
  const r = await prisma.$transaction(async (tx) => {
    const canceladas = await tx.saidaMaisa.findMany({ where: { conversaId, status: "pendente" }, orderBy: { ordem: "asc" }, select: { id: true, mensagemId: true } });
    if (canceladas.length) {
      await tx.saidaMaisa.updateMany({ where: { id: { in: canceladas.map((c) => c.id) } }, data: { status: "falhou", erro: "não enviada: uma mensagem anterior falhou" } });
    }
    const textos = canceladas.length
      ? (await tx.mensagem.findMany({ where: { id: { in: canceladas.map((c) => c.mensagemId) } }, select: { conteudoTexto: true } })).map((m) => m.conteudoTexto ?? "")
      : [];
    const conversa = await tx.conversa.findUnique({ where: { id: conversaId }, include: { contato: true } });
    if (!conversa) return null;
    const estado = (conversa.maisaEstado as EstadoMaisa | null) ?? null;
    const motivo = `a Maisa não conseguiu entregar a mensagem ao cliente (${detalhe})`;
    if (conversa.comMaisa) {
      const novo: EstadoMaisa = { ...(estado ?? { etapa: "inicio", tentativas: 0 }), etapa: "finalizada", paradaEm: estado?.etapa, saida: "falha_entrega", motivoTransferencia: motivo, confirmacaoPendente: undefined };
      await tx.conversa.update({ where: { id: conversaId }, data: { comMaisa: false, maisaEstado: novo as unknown as Prisma.InputJsonValue, maisaVersao: { increment: 1 } } });
      await tx.maisaEvento.create({ data: { conversaId, etapaAntes: estado?.etapa ?? null, etapaDepois: "finalizada", rotulo: "falha_entrega", motivo } });
    }
    const nota = await criarNota(
      tx,
      conversaId,
      `${conversa.comMaisa ? "Passei para a equipe" : "Aviso"}: ${motivo}. ` +
        (tipo === "incerto" ? "A mensagem pode ter chegado ou não: confira antes de repetir. " : "O cliente não recebeu. ") +
        "Confira a conexão do número na tela Números." +
        (textos.length ? `\n\nNão enviei também:\n${textos.map((t) => `- ${t.slice(0, 300)}`).join("\n")}` : ""),
    );
    return { nota, nome: conversa.contato.nome };
  });
  if (!r) return;
  emitirSemFalhar(() => emitNovaMensagem(r.nota));
  emitirSemFalhar(() => emitAvisoMaisa({ tipo: "entrega_falhou", conversaId, nome: r.nome, detalhe }));
  const atualizada = await getConversaById(conversaId).catch(() => null);
  if (atualizada) emitirSemFalhar(() => emitConversaAtualizada(atualizada));
}

function emitirSemFalhar(f: () => void) {
  try {
    f();
  } catch {
    // Sem socket (scripts e testes): o que importa já está gravado.
  }
}

function registrar(evento: string, s: Reservada, falha?: string, erro?: string) {
  console.error(JSON.stringify({ origem: "maisa", tipo: "saida_whatsapp", evento, conversaId: s.conversaId, mensagemId: s.mensagemId, tentativa: s.tentativas, falha: falha ?? null, erro: erro?.slice(0, 200) ?? null }));
}
