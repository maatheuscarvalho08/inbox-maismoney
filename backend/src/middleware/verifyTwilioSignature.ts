import twilio from "twilio";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

// Twilio não manda token — autentica via assinatura HMAC do request (X-Twilio-Signature),
// calculada sobre a URL completa + os campos do form-urlencoded. Falha fechado, igual ao
// webhook da Meta: sem TWILIO_AUTH_TOKEN configurado, recusa em vez de deixar passar.
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction) {
  if (!env.TWILIO_AUTH_TOKEN) {
    console.error("TWILIO_AUTH_TOKEN não configurado — recusando webhook Twilio.");
    return res.status(503).send("Webhook não configurado");
  }

  const assinatura = req.headers["x-twilio-signature"];
  if (typeof assinatura !== "string") {
    return res.status(401).send("Assinatura ausente");
  }

  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const valido = twilio.validateRequest(env.TWILIO_AUTH_TOKEN, assinatura, url, req.body as Record<string, string>);

  if (!valido) {
    return res.status(401).send("Assinatura inválida");
  }

  next();
}
