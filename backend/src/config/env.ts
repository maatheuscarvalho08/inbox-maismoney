import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET é obrigatório"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  PUBLIC_API_URL: z.string().default("http://localhost:3333"),

  // Evolution API (self-hosted) — servidor único, instâncias identificadas por nome
  EVOLUTION_API_URL: z.string().default(""),
  EVOLUTION_API_KEY: z.string().default(""),

  // Meta Cloud API (oficial)
  META_ACCESS_TOKEN: z.string().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_API_VERSION: z.string().default("v21.0"),

  // Deleção automática de mídia
  MEDIA_RETENTION_DIAS: z.coerce.number().default(4),
  UPLOADS_DIR: z.string().default("uploads"),
});

export const env = envSchema.parse(process.env);
