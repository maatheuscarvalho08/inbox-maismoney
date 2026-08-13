import crypto from "crypto";
import { env } from "../config/env.js";

export function assinarMidia(mensagemId: string, ttlSegundos = 300) {
  const exp = Date.now() + ttlSegundos * 1000;
  const sig = crypto.createHmac("sha256", env.JWT_SECRET).update(`${mensagemId}.${exp}`).digest("hex");
  return { exp, sig };
}

export function validarAssinaturaMidia(mensagemId: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return false;
  }

  const esperado = crypto.createHmac("sha256", env.JWT_SECRET).update(`${mensagemId}.${exp}`).digest("hex");
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(esperado);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}
