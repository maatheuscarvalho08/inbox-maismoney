import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

// A Meta Cloud API só aceita audio/aac, audio/mp4, audio/mpeg, audio/amr e audio/ogg
// pra mensagens de áudio/voz — audio/webm (o que o MediaRecorder do navegador produz no
// Chrome/Edge) não está nessa lista e falha silenciosamente na entrega (a Meta aceita o
// POST e busca o arquivo, mas não consegue processar pra enviar ao WhatsApp).
const TIPOS_ACEITOS_META = ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"];

export function precisaConverterAudio(mimetype: string) {
  return mimetype.startsWith("audio/") && !TIPOS_ACEITOS_META.includes(mimetype.split(";")[0]);
}

// Remux pra ogg/opus (rápido, sem recodificar — webm e ogg são só containers diferentes
// pro mesmo codec Opus que o MediaRecorder já produz).
export async function converterParaOgg(inputPath: string): Promise<{ path: string; mimetype: string }> {
  const outputPath = inputPath.replace(path.extname(inputPath), "") + ".ogg";

  await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-c:a", "libopus", "-f", "ogg", outputPath]);

  await fs.promises.unlink(inputPath).catch(() => {});

  return { path: outputPath, mimetype: "audio/ogg" };
}
