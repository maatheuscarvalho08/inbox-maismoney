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
