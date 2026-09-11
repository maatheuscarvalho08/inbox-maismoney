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

// Dados da mensagem original pra citar numa resposta (reply do WhatsApp) — o
// Baileys precisa saber quem mandou a original (fromMe) pra montar o key certo.
export interface CitacaoEvolution {
  externalId: string;
  fromMe: boolean;
  conteudoTexto?: string | null;
}

function montarQuoted(numero: string, citado?: CitacaoEvolution) {
  if (!citado) return undefined;
  return {
    key: { id: citado.externalId, remoteJid: `${numero}@s.whatsapp.net`, fromMe: citado.fromMe },
    message: { conversation: citado.conteudoTexto ?? "" },
  };
}

export async function enviarTextoEvolution(
  instanceName: string,
  numero: string,
  texto: string,
  citado?: CitacaoEvolution,
) {
  const { data } = await client.post<RespostaEnvioEvolution>(`/message/sendText/${instanceName}`, {
    number: numero,
    text: texto,
    quoted: montarQuoted(numero, citado),
  });
  return data.key?.id;
}

// Edição só existe no lado Evolution (WhatsApp Web) — a Meta Cloud API não tem
// endpoint pra editar mensagem já enviada. O cliente ainda vê o texto antigo por
// um instante até a edição chegar nele.
export async function editarMensagemEvolution(
  instanceName: string,
  numero: string,
  externalId: string,
  novoTexto: string,
) {
  await client.post(`/chat/updateMessage/${instanceName}`, {
    number: numero,
    text: novoTexto,
    key: { id: externalId, remoteJid: `${numero}@s.whatsapp.net`, fromMe: true },
  });
}

export async function enviarMidiaEvolution(
  instanceName: string,
  numero: string,
  mediaUrl: string,
  mediatype: "image" | "video" | "audio" | "document",
  caption?: string,
  citado?: CitacaoEvolution,
) {
  // Áudio via /message/sendMedia trata o arquivo como anexo genérico — o Baileys
  // recebe mas frequentemente não entrega/toca como mensagem de voz de verdade.
  // A própria Evolution API tem um endpoint dedicado só pra isso.
  if (mediatype === "audio") {
    return enviarAudioEvolution(instanceName, numero, mediaUrl, citado);
  }

  const { data } = await client.post<RespostaEnvioEvolution>(`/message/sendMedia/${instanceName}`, {
    number: numero,
    mediatype,
    media: mediaUrl,
    caption,
    quoted: montarQuoted(numero, citado),
  });
  return data.key?.id;
}

export async function enviarAudioEvolution(
  instanceName: string,
  numero: string,
  mediaUrl: string,
  citado?: CitacaoEvolution,
) {
  const { data } = await client.post<RespostaEnvioEvolution>(`/message/sendWhatsAppAudio/${instanceName}`, {
    number: numero,
    audio: mediaUrl,
    quoted: montarQuoted(numero, citado),
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
