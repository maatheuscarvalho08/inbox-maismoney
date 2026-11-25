import { prisma } from "../db/prisma.js";
import { getIo } from "./socket.js";

// Quem é restrito recebe o evento das conversas sem dono (fila e Maisa) e das dele. Os demais recebem tudo.
// Sem conversa no evento (instância, campanha, Carrinho), o restrito não recebe.
function emitirFiltrado(evento: string, payload: unknown, conversaId?: string | null) {
  const io = getIo();
  const restritos = [...io.sockets.sockets.values()].filter((s) => s.data.restrito);
  if (!restritos.length) {
    io.emit(evento, payload);
    return;
  }
  io.except(restritos.map((s) => s.id)).emit(evento, payload);
  if (!conversaId) return;
  void prisma.conversa
    .findUnique({ where: { id: conversaId }, select: { operadorId: true } })
    .then((c) => {
      for (const s of restritos) if (c && (c.operadorId === null || s.data.usuarioId === c.operadorId)) s.emit(evento, payload);
    })
    .catch(() => undefined);
}

const idDe = (v: unknown, campo: string) => ((v as Record<string, unknown> | null)?.[campo] as string | undefined) ?? null;

export function emitNovaMensagem(mensagem: unknown) {
  emitirFiltrado("mensagem:nova", mensagem, idDe(mensagem, "conversaId"));
}

export function emitConversaAtualizada(conversa: unknown) {
  emitirFiltrado("conversa:atualizada", conversa, idDe(conversa, "id"));
}

export function emitInstanciaAtualizada(instancia: unknown) {
  emitirFiltrado("instancia:atualizada", instancia);
}

export function emitCampanhaAtualizada(payload: unknown) {
  emitirFiltrado("campanha:atualizada", payload);
}

// Cliente ofertado que não respondeu em 24h: a tela avisa a equipe no topo.
export function emitCarrinhoNovo(conversa: unknown) {
  emitirFiltrado("carrinho:novo", conversa, idDe(conversa, "id"));
}

// Chegou o dia combinado para chamar o cliente de novo: a tela avisa no topo.
export function emitRetornoVencido(conversa: unknown) {
  emitirFiltrado("retorno:vencido", conversa, idDe(conversa, "id"));
}

// Aviso da Maisa para a equipe, no topo da tela: aceite depois de a conversa sair dela,
// mensagem que ela não conseguiu entregar, digitação com resultado incerto.
export type TipoAvisoMaisa = "aceite_apos_transferencia" | "entrega_falhou" | "digitacao_incerta" | "mensagem_apos_digitacao" | "digitacao_bloqueada";
export function emitAvisoMaisa(aviso: { tipo: TipoAvisoMaisa; conversaId: string; nome: string | null; detalhe?: string }) {
  emitirFiltrado("maisa:aviso", aviso, aviso.conversaId);
}
