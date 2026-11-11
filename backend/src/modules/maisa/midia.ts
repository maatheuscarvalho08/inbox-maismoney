// Arquivos que o cliente manda para a Maisa: áudio vira texto, extrato do INSS ou
// contracheque do SIAPE vira parcela máxima. O arquivo nunca fica guardado na OpenAI
// (store: false no extrato; a transcrição não guarda por padrão).
import fs from "fs/promises";
import path from "path";
import { env } from "../../config/env.js";
import { uploadsRoot } from "../../middleware/upload.js";
import { lerExtrato } from "../extratos/leitor.js";
import { analisarExtrato } from "../extratos/analise.js";
import type { AnaliseGuardada } from "../extratos/guardadas.js";
import type { ResultadoExtrato } from "./bancos.js";

export const FORMATOS_EXTRATO = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function lerArquivo(midiaPath: string): Promise<Buffer> {
  // Nunca ler fora da pasta de uploads.
  const caminho = path.resolve(process.cwd(), midiaPath);
  if (!caminho.startsWith(uploadsRoot + path.sep)) throw new Error("Caminho de mídia inválido");
  return fs.readFile(caminho);
}

const EXTENSAO_AUDIO: [RegExp, string][] = [
  [/ogg|opus/, "ogg"],
  [/mpeg|mp3/, "mp3"],
  [/mp4|m4a|aac/, "m4a"],
  [/webm/, "webm"],
  [/wav/, "wav"],
];

export async function transcreverAudio(conteudo: Buffer, mimetype: string): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada");
  const ext = EXTENSAO_AUDIO.find(([re]) => re.test(mimetype))?.[1] ?? "ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(conteudo)], { type: mimetype.split(";")[0] }), `audio.${ext}`);
  form.append("model", env.OPENAI_MODELO_AUDIO);
  form.append("language", "pt");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${j.error?.message ?? "erro desconhecido"}`);
  return String(j.text ?? "").trim();
}

// Lê o extrato e devolve a parcela máxima para um empréstimo novo, ou o motivo de
// não dar. Quem simula com essa parcela é o banco.
// "registro" é a leitura completa, para guardar na mensagem e a equipe ver o motivo.
export async function parcelaPeloExtrato(
  conteudo: Buffer,
  mimetype: string,
  convenio: "inss" | "siape",
): Promise<{
  resultado:
    | { tipo: "ok"; parcelaMaxima: number; renda: number | null; especie: number | null; matricula: string | null }
    | Exclude<ResultadoExtrato, { tipo: "com_saldo" | "erro" }>;
  registro: AnaliseGuardada;
}> {
  const nome = mimetype === "application/pdf" ? "extrato.pdf" : "extrato";
  let leitura = await lerExtrato(conteudo, mimetype, nome);
  // "Estadual" já saiu errado em contracheque SIAPE (o modelo varia). Lê de novo e só
  // aceita se as duas leituras concordarem.
  if (leitura.extrato.tipo_documento === "servidor_outro") {
    const segunda = await lerExtrato(conteudo, mimetype, nome);
    if (segunda.extrato.tipo_documento !== "servidor_outro") leitura = segunda;
  }
  const { extrato } = leitura;
  const analise = analisarExtrato(extrato);
  const registro: AnaliseGuardada = {
    leitura: extrato,
    analise,
    modelo: leitura.modelo,
    tokens: { entrada: leitura.tokensEntrada, saida: leitura.tokensSaida },
    origem: "maisa",
    lidoEm: new Date().toISOString(),
  };
  // Escolheu SIAPE, mas o contracheque é de estado ou prefeitura: é com a equipe.
  if (extrato.legivel && extrato.tipo_documento === "servidor_outro") {
    const motivo = "contracheque de servidor estadual ou municipal, não federal";
    return { resultado: { tipo: "servidor_outro", motivo }, registro: { ...registro, recusa: motivo } };
  }
  if (!extrato.legivel || extrato.tipo_documento !== convenio) {
    const motivo = extrato.legivel
      ? `não é ${convenio === "siape" ? "contracheque do SIAPE" : "extrato do INSS"}`
      : "documento ilegível";
    return { resultado: { tipo: "extrato_invalido", motivo }, registro: { ...registro, recusa: motivo } };
  }
  const novo = analise.possibilidades.find((p) => p.tipo === "novo");
  if (!novo || novo.tipo !== "novo" || !novo.possivel) {
    // Leitura com dúvida: a margem zerada pode ser erro de leitura. A equipe confere.
    const motivo = novo?.motivo ?? "sem margem para empréstimo novo";
    return { resultado: { tipo: "sem_saldo", banco: "extrato", motivo, revisar: !analise.confiavel }, registro };
  }
  return {
    resultado: {
      tipo: "ok",
      parcelaMaxima: novo.parcelaMaxima,
      renda: extrato.renda_bruta ?? extrato.base_calculo,
      especie: extrato.especie_codigo,
      matricula: extrato.matricula,
    },
    registro,
  };
}
