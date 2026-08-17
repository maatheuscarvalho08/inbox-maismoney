import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

interface JwtPayload {
  sub: string;
  role: Role;
  nome: string;
  email: string;
}

// Busca o usuário no banco a cada request (em vez de confiar cegamente no payload do JWT)
// para que desativação ou troca de role por um admin tenham efeito imediato, mesmo que o
// token antigo ainda não tenha expirado.
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ error: "Token inválido ou expirado" });
    }
    req.user = { id: usuario.id, role: usuario.role, nome: usuario.nome, email: usuario.email };
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    next();
  };
}
