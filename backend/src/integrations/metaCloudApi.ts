import axios from "axios";
import { env } from "../config/env.js";

const client = axios.create({
  baseURL: `https://graph.facebook.com/${env.META_API_VERSION}`,
  headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
  timeout: 15_000,
});

export async function enviarTextoMeta(phoneNumberId: string, numero: string, texto: string) {
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: "text",
    text: { body: texto },
  });
  return data;
}

export async function enviarTemplateMeta(
  phoneNumberId: string,
  numero: string,
  templateName: string,
  variaveis: string[] = [],
  idioma = "pt_BR",
) {
  const { data } = await client.post(`/${phoneNumberId}/messages`, {
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
  return data;
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

  const { data } = await client.post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: tipo,
    [tipo]: media,
  });
  return data;
}

export async function listarTemplatesMeta(wabaId: string) {
  const { data } = await client.get(`/${wabaId}/message_templates`);
  return data;
}
