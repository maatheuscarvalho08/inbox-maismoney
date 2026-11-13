// Estado novo de uma conversa que volta para a Maisa. Recomeça do início, mas guarda o cadastro
// estruturado de um atendimento anterior (contratoSalvo), que o fluxo reaproveita com nova
// confirmação do cliente. Notas e textos livres da equipe nunca entram aqui.
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";

export function estadoLimpoPreservandoCadastro(estadoAtual: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  // Reaproveitar cadastro é da fase 7: com a camada desligada, o estado volta limpo como antes.
  if (env.MAISA_CONVERSA_MODO !== "ativo") return Prisma.DbNull;
  const salvo = (estadoAtual as { contratoSalvo?: unknown } | null)?.contratoSalvo;
  if (!salvo) return Prisma.DbNull;
  return { etapa: "inicio", tentativas: 0, contratoSalvo: salvo } as unknown as Prisma.InputJsonValue;
}
