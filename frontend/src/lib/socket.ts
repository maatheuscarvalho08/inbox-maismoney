import { io, type Socket } from "socket.io-client";
import { ORIGIN_URL } from "./api";

let socket: Socket | null = null;

// Componentes que montam antes do socket existir (ex: sessão restaurada no F5,
// timing de carregamento) escutam esse evento pra pegar o socket assim que ele
// for criado, em vez de ficar travados pra sempre em getSocket() === null.
const READY_EVENT = "maismoney:socket-ready";

export function conectarSocket(token: string) {
  if (socket) {
    socket.disconnect();
  }
  socket = io(ORIGIN_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on("connect_error", (err) => {
    console.warn("Socket.io falhou ao conectar/reconectar:", err.message);
  });

  window.dispatchEvent(new Event(READY_EVENT));
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}

export function onSocketReady(callback: () => void) {
  window.addEventListener(READY_EVENT, callback);
  return () => window.removeEventListener(READY_EVENT, callback);
}
