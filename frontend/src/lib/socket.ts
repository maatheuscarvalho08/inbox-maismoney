import { io, type Socket } from "socket.io-client";
import { ORIGIN_URL } from "./api";

let socket: Socket | null = null;

export function conectarSocket(token: string) {
  if (socket) {
    socket.disconnect();
  }
  socket = io(ORIGIN_URL, { auth: { token } });
  return socket;
}

export function desconectarSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocket() {
  return socket;
}
