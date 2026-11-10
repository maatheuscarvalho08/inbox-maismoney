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
  // Segredo que a Evolution manda de volta em todo webhook — sem ele qualquer um na
  // internet conseguia injetar mensagens falsas em /api/webhooks/evolution.
  EVOLUTION_WEBHOOK_TOKEN: z.string().default(""),

  // Meta Cloud API (oficial)
  META_ACCESS_TOKEN: z.string().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_API_VERSION: z.string().default("v21.0"),

  // Deleção automática de mídia
  MEDIA_RETENTION_DIAS: z.coerce.number().default(4),
  UPLOADS_DIR: z.string().default("uploads"),

  // Discadora (Fase 2) — Twilio Voice + IVR
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_PHONE_NUMBER: z.string().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Maisa (IA de atendimento). Desligada por padrão: nada muda em produção até
  // alguém ligar de propósito.
  // copiloto = ela grava a resposta como sugestão e a equipe decide se envia.
  // automatico = ela mesma envia pelo WhatsApp.
  MAISA_MODO: z.enum(["desligado", "copiloto", "automatico"]).default("desligado"),
  // Usa o banco de mentira nas simulações. Só para teste: gera ofertas fictícias.
  MAISA_BANCO_SIMULADO: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // API da Facta para a simulação CLT. Comece pela homologação. A Facta só aceita
  // chamadas do IP liberado, então em produção isso só funciona na VPS.
  FACTA_BASE_URL: z.string().default("https://webservice-homol.facta.com.br"),
  FACTA_USER: z.string().default(""),
  FACTA_PASS: z.string().default(""),
  // Digitação da proposta: login do correspondente certificado e código master.
  FACTA_LOGIN_CERTIFICADO: z.string().default(""),
  FACTA_CODIGO_MASTER: z.string().default(""),
  // A Maisa digita a proposta na Facta quando o cliente de INSS ou SIAPE aceita.
  // Desligado, o "sim" do cliente vai para a equipe, como antes.
  MAISA_DIGITA_PROPOSTA: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // OpenAI. A leitura de extrato usa um modelo com visão; as etapas simples, um barato.
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODELO_EXTRATO: z.string().default("gpt-6.1-sol"),
  // Transcrição dos áudios que o cliente manda para a Maisa.
  OPENAI_MODELO_AUDIO: z.string().default("gpt-4o-transcribe"),
  // Libera a tela de teste, que cria conversas de mentira e simula o cliente.
  MAISA_SIMULADOR: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);
