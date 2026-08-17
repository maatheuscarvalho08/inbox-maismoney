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

export async function listarTemplatesMeta(wabaId: string) {
  const { data } = await client.get(`/${wabaId}/message_templates`);
  return data;
}
