import axios from "axios";
import { env } from "../config/env.js";

// axios.isAxiosError não é suficiente sozinho pra extrair a mensagem real — por padrão
// o console trunca err.response.data como [Object], escondendo o motivo de verdade
// (ex.: "(#132001) Template name does not exist"). Usar isso em vez de err.message.
export function mensagemErroMeta(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const erroApi = err.response?.data?.error;
    if (erroApi?.message) return `${erroApi.message}${erroApi.error_subcode ? ` (${erroApi.error_subcode})` : ""}`;
  }
  return err instanceof Error ? err.message : "Falha ao enviar mensagem";
}

const client = axios.create({
  baseURL: `https://graph.facebook.com/${env.META_API_VERSION}`,
  headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  timeout: 15_000,
});

interface RespostaEnvioMeta {
  messages?: { id: string }[];
}

export async function enviarTextoMeta(phoneNumberId: string, numero: string, texto: string) {
  const { data } = await client.post<RespostaEnvioMeta>(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: "text",
    text: { body: texto },
  });
  return data.messages?.[0]?.id;
}

export async function enviarTemplateMeta(
  phoneNumberId: string,
  numero: string,
  templateName: string,
  variaveis: string[] = [],
  idioma = "pt_BR",
) {
  const { data } = await client.post<RespostaEnvioMeta>(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: "template",
    template: {
      name: templateName,
      language: { code: idioma },
      ...(variaveis.length
        ? { components: [{ type: "body", parameters: variaveis.map((texto) => ({ type: "text", text: texto })) }] }
        : {}),
    },
  });
  return data.messages?.[0]?.id;
}

export async function enviarMidiaMeta(
  phoneNumberId: string,
  numero: string,
  tipo: "image" | "audio" | "video" | "document",
  link: string,
  opts: { caption?: string; filename?: string; voiceNote?: boolean } = {},
) {
  const media: Record<string, unknown> = { link };
  // Legenda só é aceita pela Meta em image/video/document — áudio não suporta caption.
  if (opts.caption && tipo !== "audio") media.caption = opts.caption;
  if (opts.filename && tipo === "document") media.filename = opts.filename;
  if (opts.voiceNote && tipo === "audio") media.voice = true;

  const { data } = await client.post<RespostaEnvioMeta>(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: tipo,
    [tipo]: media,
  });
  return data.messages?.[0]?.id;
}

export async function listarTemplatesMeta(wabaId: string) {
  const { data } = await client.get(`/${wabaId}/message_templates`);
  return data;
}

// Mídia recebida de cliente não vem no corpo do webhook — só um media id. É preciso
// buscar a URL temporária (expira em minutos) e então baixar o arquivo com o mesmo
// token, na sequência, antes que ela expire.
export async function baixarMidiaMeta(mediaId: string): Promise<{ buffer: Buffer; mimetype: string }> {
  const { data: info } = await client.get<{ url: string; mime_type: string }>(`/${mediaId}`);
  const { data: buffer } = await axios.get<ArrayBuffer>(info.url, {
    headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 20_000,
  });
  return { buffer: Buffer.from(buffer), mimetype: info.mime_type };
}
