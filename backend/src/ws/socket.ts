import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

let io: SocketIOServer | undefined;

function salaDoUsuario(usuarioId: string) {
  return `usuario:${usuarioId}`;
}

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Token ausente"));
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string };
      // Mesma regra do middleware authenticate: usuário desativado não conecta,
      // mesmo com token ainda dentro da validade.
      const usuario = payload.sub ? await prisma.usuario.findUnique({ where: { id: payload.sub } }) : null;
      if (!usuario?.ativo) {
        return next(new Error("Token inválido"));
      }
      socket.join(salaDoUsuario(usuario.id));
      next();
    } catch {
      next(new Error("Token inválido"));
    }
  });

  return io;
}

// Chamado quando um admin desativa alguém — derruba as conexões abertas na hora,
// senão a pessoa seguiria recebendo todas as mensagens em tempo real até fechar a aba.
export function desconectarUsuario(usuarioId: string) {
  io?.in(salaDoUsuario(usuarioId)).disconnectSockets(true);
}

export function getIo() {
  if (!io) throw new Error("Socket.io não inicializado");
  return io;
}
