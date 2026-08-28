import axios from "axios";
import { env } from "../config/env.js";

const client = axios.create({
  baseURL: env.EVOLUTION_API_URL,
  headers: { apikey: env.EVOLUTION_API_KEY },
  timeout: 15_000,
});

interface RespostaEnvioEvolution {
  key?: { id?: string };
}

export async function enviarTextoEvolution(instanceName: string, numero: string, texto: string) {
  const { data } = await client.post<RespostaEnvioEvolution>(`/message/sendText/${instanceName}`, {
    number: numero,
    text: texto,
  });
  return data.key?.id;
}

export async function enviarMidiaEvolution(
  instanceName: string,
  numero: string,
  mediaUrl: string,
  mediatype: "image" | "video" | "audio" | "document",
  caption?: string,
) {
  const { data } = await client.post<RespostaEnvioEvolution>(`/message/sendMedia/${instanceName}`, {
    number: numero,
    mediatype,
    media: mediaUrl,
    caption,
  });
  return data.key?.id;
}

export async function obterQrCodeEvolution(instanceName: string) {
  const { data } = await client.get(`/instance/connect/${instanceName}`);
  return data;
}

export async function statusInstanciaEvolution(instanceName: string) {
  const { data } = await client.get(`/instance/connectionState/${instanceName}`);
  return data;
}

// Cria a instância no Evolution API já apontando o webhook pro nosso backend. Sem
// isso a instância existe mas as mensagens recebidas não chegam em lugar nenhum —
// só os dois eventos que o receptor em webhooks/evolution.routes.ts realmente trata.
export async function criarInstanciaEvolution(instanceName: string) {
  const { data } = await client.post("/instance/create", {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    webhook: {
      url: `${env.PUBLIC_API_URL}/webhooks/evolution`,
      byEvents: false,
      base64: true,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
    },
  });
  return data;
}

export async function instanciaExisteEvolution(instanceName: string) {
  try {
    await client.get(`/instance/connectionState/${instanceName}`);
    return true;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return false;
    throw err;
  }
}

export function mensagemErroEvolution(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const corpo = err.response?.data;
    const detalhe = corpo?.response?.message ?? corpo?.message ?? corpo?.error;
    if (detalhe) return Array.isArray(detalhe) ? detalhe.join("; ") : String(detalhe);
  }
  return err instanceof Error ? err.message : "Falha na Evolution API";
}
