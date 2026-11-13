import { getIo } from "./socket.js";

export function emitNovaMensagem(mensagem: unknown) {
  getIo().emit("mensagem:nova", mensagem);
}

export function emitConversaAtualizada(conversa: unknown) {
  getIo().emit("conversa:atualizada", conversa);
}

export function emitInstanciaAtualizada(instancia: unknown) {
  getIo().emit("instancia:atualizada", instancia);
}

export function emitCampanhaAtualizada(payload: unknown) {
  getIo().emit("campanha:atualizada", payload);
}

// Cliente ofertado que não respondeu em 24h: a tela avisa a equipe no topo.
export function emitCarrinhoNovo(conversa: unknown) {
  getIo().emit("carrinho:novo", conversa);
}

// Aviso da Maisa para a equipe, no topo da tela: aceite depois de a conversa sair dela,
// mensagem que ela não conseguiu entregar, digitação com resultado incerto.
export type TipoAvisoMaisa = "aceite_apos_transferencia" | "entrega_falhou" | "digitacao_incerta" | "mensagem_apos_digitacao" | "digitacao_bloqueada";
export function emitAvisoMaisa(aviso: { tipo: TipoAvisoMaisa; conversaId: string; nome: string | null; detalhe?: string }) {
  getIo().emit("maisa:aviso", aviso);
}
