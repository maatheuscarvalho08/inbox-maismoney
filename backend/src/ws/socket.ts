import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

let io: SocketIOServer | undefined;

export function initSocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Token ausente"));
    }
    try {
      jwt.verify(token, env.JWT_SECRET);
      next();
    } catch {
      next(new Error("Token inválido"));
    }
  });

  return io;
}

export function getIo() {
  if (!io) throw new Error("Socket.io não inicializado");
  return io;
}
