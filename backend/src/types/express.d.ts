import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        nome: string;
        email: string;
        fotoPath: string | null;
      };
      rawBody?: Buffer;
    }
  }
}

export {};
