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
        // Só vê as conversas atribuídas a ele.
        somenteAtribuidas: boolean;
      };
      rawBody?: Buffer;
    }
  }
}

export {};
