import crypto from "crypto";
import { env } from "../config/env.js";

// Chave derivada do JWT_SECRET com domínio separado — evita reusar a mesma chave
// crua tanto para assinar JWTs quanto para assinar links de mídia.
const mediaSigningKey = crypto.createHash("sha256").update(`${env.JWT_SECRET}:media-signing`).digest();

export function assinarMidia(mensagemId: string, ttlSegundos = 300) {
  const exp = Date.now() + ttlSegundos * 1000;
  const sig = crypto.createHmac("sha256", mediaSigningKey).update(`${mensagemId}.${exp}`).digest("hex");
  return { exp, sig };
}

export function validarAssinaturaMidia(mensagemId: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return false;
  }

  const esperado = crypto.createHmac("sha256", mediaSigningKey).update(`${mensagemId}.${exp}`).digest("hex");
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(esperado);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}
