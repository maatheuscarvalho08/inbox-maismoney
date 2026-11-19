// Estado de uma conversa que a equipe devolve para a Maisa. Parada no meio do atendimento
// (oferta feita, extrato pedido, CPF pedido...), ela continua de onde parou, com a oferta e os
// dados de antes: o "sim" do cliente à oferta vale. Sem ponto para continuar, recomeça do
// início, guardando o cadastro estruturado anterior (contratoSalvo), que o fluxo reaproveita com
// nova confirmação do cliente. Notas e textos livres da equipe nunca entram aqui.
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";

// Etapas em que dá para retomar sem perder nada: a pergunta da etapa ainda faz sentido.
const RETOMAVEIS = new Set(["cpf", "nome", "nascimento", "extrato", "numero_contrato", "oferta", "oferta_port"]);

export function estadoLimpoPreservandoCadastro(estadoAtual: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const e = estadoAtual as Record<string, unknown> | null;
  const parada = typeof e?.paradaEm === "string" ? e.paradaEm : null;
  const temOferta = Boolean(e?.alternativa || e?.oferta);
  if (e && parada && RETOMAVEIS.has(parada) && (!parada.startsWith("oferta") || temOferta)) {
    const { saida: _s, motivoTransferencia: _m, paradaEm: _p, confirmacaoPendente: _c, digitacaoErro: _d, redeAvisoEm: _r, ...resto } = e;
    return { ...resto, etapa: parada, tentativas: 0, sociais: 0, ultimoContatoCliente: undefined, followupEnviado: false } as unknown as Prisma.InputJsonValue;
  }
  // Reaproveitar cadastro é da fase 7: com a camada desligada, o estado volta limpo como antes.
  if (env.MAISA_CONVERSA_MODO !== "ativo") return Prisma.DbNull;
  const salvo = e?.contratoSalvo;
  if (!salvo) return Prisma.DbNull;
  return { etapa: "inicio", tentativas: 0, contratoSalvo: salvo } as unknown as Prisma.InputJsonValue;
}
