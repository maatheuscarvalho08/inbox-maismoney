import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

let avisouSemToken = false;

// Aceita o segredo por header (x-webhook-token) ou por ?token= na URL — a URL funciona
// em qualquer versão da Evolution; o header só existe nas versões mais novas.
//
// Sem EVOLUTION_WEBHOOK_TOKEN configurado, deixa passar com aviso: é o modo de
// transição pra trocar o webhook das instâncias já conectadas sem perder mensagem
// (ver scripts/sincronizarWebhooksEvolution.ts). Assim que o token entra no .env,
// passa a recusar qualquer chamada sem ele.
export function verifyEvolutionToken(req: Request, res: Response, next: NextFunction) {
  if (!env.EVOLUTION_WEBHOOK_TOKEN) {
    if (!avisouSemToken) {
      console.warn("EVOLUTION_WEBHOOK_TOKEN não configurado — webhook Evolution aceitando chamadas sem autenticação.");
      avisouSemToken = true;
    }
    return next();
  }

  const header = req.headers["x-webhook-token"];
  const recebido = typeof header === "string" ? header : typeof req.query.token === "string" ? req.query.token : "";

  const bufA = Buffer.from(recebido);
  const bufB = Buffer.from(env.EVOLUTION_WEBHOOK_TOKEN);
  const valido = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  if (!valido) {
    return res.status(401).json({ error: "Token inválido" });
  }

  next();
}
