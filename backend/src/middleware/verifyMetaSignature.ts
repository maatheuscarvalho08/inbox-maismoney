import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

let avisoEmitido = false;

export function verifyMetaSignature(req: Request, res: Response, next: NextFunction) {
  if (!env.META_APP_SECRET) {
    if (!avisoEmitido) {
      console.warn("META_APP_SECRET não configurado — assinatura do webhook Meta não está sendo verificada.");
      avisoEmitido = true;
    }
    return next();
  }

  const assinatura = req.headers["x-hub-signature-256"];
  if (typeof assinatura !== "string" || !req.rawBody) {
    return res.status(401).json({ error: "Assinatura ausente" });
  }

  const esperado =
    "sha256=" + crypto.createHmac("sha256", env.META_APP_SECRET).update(req.rawBody).digest("hex");

  const bufA = Buffer.from(assinatura);
  const bufB = Buffer.from(esperado);
  const valido = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  if (!valido) {
    return res.status(401).json({ error: "Assinatura inválida" });
  }

  next();
}
