import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";

export class InvalidCredentialsError extends Error {}

export async function login(email: string, senha: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email } });

  if (!usuario || !usuario.ativo) {
    throw new InvalidCredentialsError();
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaValida) {
    throw new InvalidCredentialsError();
  }

  const token = jwt.sign(
    { sub: usuario.id, role: usuario.role, nome: usuario.nome, email: usuario.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions,
  );

  return {
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
    },
  };
}
