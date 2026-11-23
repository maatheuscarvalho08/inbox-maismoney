import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import { env } from "../config/env.js";

const execFileAsync = promisify(execFile);

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

export async function enviarTextoMeta(
  phoneNumberId: string,
  numero: string,
  texto: string,
  contextMessageId?: string,
) {
  const { data } = await client.post<RespostaEnvioMeta>(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: "text",
    text: { body: texto },
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
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

// A Meta Cloud API aceita áudio apenas em AAC para envio — OGG/Opus é suportado
// só no recebimento. Converte qualquer áudio para AAC/m4a antes do upload.
async function converterParaAac(inputPath: string): Promise<{ filePath: string; cleanup: () => void }> {
  const outputPath = path.join(os.tmpdir(), `meta_audio_${Date.now()}.m4a`);
  await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-c:a", "aac", "-b:a", "64k", outputPath]);
  return { filePath: outputPath, cleanup: () => { try { fs.unlinkSync(outputPath); } catch { /* noop */ } } };
}

// Faz upload do arquivo local para a Media API da Meta e retorna o media_id.
async function uploadMidiaMeta(phoneNumberId: string, filePath: string, mimetype: string): Promise<string> {
  let uploadPath = filePath;
  let uploadMimetype = mimetype;
  let cleanup: (() => void) | undefined;

  // Converte áudio OGG/Opus para AAC antes de enviar — a Meta rejeita OGG no envio.
  if (mimetype.startsWith("audio/")) {
    const conv = await converterParaAac(filePath);
    uploadPath = conv.filePath;
    uploadMimetype = "audio/mp4";
    cleanup = conv.cleanup;
  }

  try {
    const fileBuffer = fs.readFileSync(uploadPath);
    const blob = new Blob([fileBuffer], { type: uploadMimetype });
    const form = new globalThis.FormData();
    form.append("file", blob, "media");
    form.append("type", uploadMimetype);
    form.append("messaging_product", "whatsapp");
    const { data } = await axios.post<{ id: string }>(
      `https://graph.facebook.com/${env.META_API_VERSION}/${phoneNumberId}/media`,
      form,
      { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` }, timeout: 30_000 },
    );
    return data.id;
  } finally {
    cleanup?.();
  }
}

export async function enviarMidiaMeta(
  phoneNumberId: string,
  numero: string,
  tipo: "image" | "audio" | "video" | "document",
  linkOuFilePath: string,
  opts: { caption?: string; filename?: string; voiceNote?: boolean; contextMessageId?: string; mimetype?: string; isFilePath?: boolean } = {},
) {
  let media: Record<string, unknown>;

  if (opts.isFilePath && opts.mimetype) {
    const mediaId = await uploadMidiaMeta(phoneNumberId, linkOuFilePath, opts.mimetype);
    media = { id: mediaId };
  } else {
    media = { link: linkOuFilePath };
  }

  // Legenda só é aceita pela Meta em image/video/document — áudio não suporta caption.
  if (opts.caption && tipo !== "audio") media.caption = opts.caption;
  if (opts.filename && tipo === "document") media.filename = opts.filename;
  if (opts.voiceNote && tipo === "audio") media.voice = true;

  const { data } = await client.post<RespostaEnvioMeta>(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: numero,
    type: tipo,
    [tipo]: media,
    ...(opts.contextMessageId ? { context: { message_id: opts.contextMessageId } } : {}),
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
