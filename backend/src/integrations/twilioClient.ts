import twilio from "twilio";
import { env } from "../config/env.js";

const client = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

export function twilioConfigurado() {
  return client !== null;
}

export async function discarNumero(numeroDestino: string, twimlUrl: string, statusCallbackUrl: string) {
  if (!client) {
    throw new Error("Twilio não configurado (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ausentes)");
  }

  // Números aqui vêm salvos sem "+" (mesmo formato usado pra Meta Cloud API), mas o
  // Twilio Voice exige E.164 completo com "+" — sem isso toda ligação falha.
  const to = numeroDestino.startsWith("+") ? numeroDestino : `+${numeroDestino}`;

  const call = await client.calls.create({
    to,
    from: env.TWILIO_PHONE_NUMBER,
    url: twimlUrl,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  return call.sid;
}
