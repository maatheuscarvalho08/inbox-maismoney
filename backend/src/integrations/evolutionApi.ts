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

export async function criarInstanciaEvolution(instanceName: string) {
  const { data } = await client.post("/instance/create", {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
  });
  return data;
}
