// Monitor do sistema: confere a cada minuto se a Maisa e as integrações estão de pé e avisa quem está em
// ALERTAS_EMAILS com uma faixa no topo do inbox. Os alertas ficam só na memória do processo: um reinício
// zera tudo e o monitor reconstrói o quadro nos minutos seguintes.
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { emitirParaUsuarios } from "../../ws/socket.js";

export type Servico = "openai" | "facta" | "maisa";

export interface Alerta {
  id: string;
  titulo: string;
  detalhe: string;
  desde: string;
}

const JANELA_MS = 15 * 60_000;
const registros: Record<Servico, { em: number; ok: boolean }[]> = { openai: [], facta: [], maisa: [] };
let semCreditoEm = 0;
let ultimoCronOk = Date.now();
const enfileiradosFollowup: { em: number; n: number }[] = [];
let ativos = new Map<string, Alerta>();

const podar = (lista: { em: number }[], janela = JANELA_MS) => {
  const limite = Date.now() - janela;
  while (lista.length && lista[0].em < limite) lista.shift();
};

export function registrar(servico: Servico, ok: boolean) {
  const lista = registros[servico];
  lista.push({ em: Date.now(), ok });
  podar(lista);
  if (lista.length > 500) lista.splice(0, lista.length - 500);
}

export function registrarCronOk() {
  ultimoCronOk = Date.now();
}

export function registrarFollowupsEnfileirados(n: number) {
  if (n > 0) enfileiradosFollowup.push({ em: Date.now(), n });
  podar(enfileiradosFollowup, 60 * 60_000);
}

// Observa as chamadas para a OpenAI e a Facta sem mexer em cada módulo: um invólucro no fetch global conta
// sucesso e falha. Falha = erro de rede, tempo esgotado ou resposta que indica serviço fora (5xx, 429, 401, 403).
export function instalarObservadorDeFetch() {
  const original = globalThis.fetch;
  const factaOrigem = (() => {
    try {
      return new URL(env.FACTA_BASE_URL).origin;
    } catch {
      return null;
    }
  })();
  const servicoDe = (url: string): Servico | null => {
    if (url.startsWith("https://api.openai.com/")) return "openai";
    if (factaOrigem && url.startsWith(factaOrigem)) return "facta";
    return null;
  };
  globalThis.fetch = async (entrada: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const servico = servicoDe(url);
    if (!servico) return original(entrada, init);
    try {
      const r = await original(entrada, init);
      const falhou = r.status >= 500 || r.status === 429 || r.status === 401 || r.status === 403;
      registrar(servico, !falhou);
      if (servico === "openai" && r.status === 429) {
        // Crédito acabado vem como 429 "insufficient_quota". Lê uma cópia para não consumir a resposta.
        void r
          .clone()
          .text()
          .then((t) => {
            if (t.includes("insufficient_quota")) semCreditoEm = Date.now();
          })
          .catch(() => undefined);
      }
      return r;
    } catch (err) {
      registrar(servico, false);
      throw err;
    }
  };
}

const horaComercial = (d: Date) => {
  const h = (d.getUTCHours() + 21) % 24; // Brasília, UTC-3
  return h >= 8 && h < 21;
};

function falhando(servico: Servico, minimo: number) {
  const lista = registros[servico];
  podar(lista);
  const falhas = lista.filter((r) => !r.ok).length;
  return { falhas, total: lista.length, alerta: falhas >= minimo && falhas * 2 >= lista.length };
}

export async function avaliar(): Promise<Alerta[]> {
  const agora = new Date();
  const lista: Omit<Alerta, "desde">[] = [];
  if (env.MAISA_MODO === "desligado") return [];

  if (Date.now() - semCreditoEm < JANELA_MS) {
    lista.push({ id: "openai_credito", titulo: "Acabou o crédito da OpenAI", detalhe: "A Maisa não consegue ler arquivos nem conversar. Recarregue a conta da OpenAI." });
  } else {
    const o = falhando("openai", 3);
    if (o.alerta) lista.push({ id: "openai", titulo: "OpenAI falhando", detalhe: `${o.falhas} de ${o.total} chamadas falharam nos últimos 15 min. A Maisa pode não estar lendo arquivos nem respondendo.` });
  }

  const f = falhando("facta", 3);
  if (f.alerta) lista.push({ id: "facta", titulo: "Facta fora do ar", detalhe: `${f.falhas} de ${f.total} chamadas à Facta falharam nos últimos 15 min. Simulação, autorização e digitação podem estar paradas.` });

  // Erros em sequência ao processar conversas: as 5 últimas, dentro de 30 min, todas falharam.
  const m = registros.maisa.filter((r) => r.em > Date.now() - 30 * 60_000).slice(-5);
  if (m.length === 5 && m.every((r) => !r.ok)) {
    lista.push({ id: "maisa", titulo: "A Maisa está falhando", detalhe: "As últimas 5 conversas que ela tentou processar deram erro e foram para a fila." });
  }

  if (Date.now() - ultimoCronOk > 5 * 60_000) {
    lista.push({ id: "cron", titulo: "Checagens automáticas paradas", detalhe: "Follow-ups, autorizações e retornos não rodam há mais de 5 minutos." });
  }

  // Follow-up: na última hora o agendador mandou conversas para o follow-up, mas nenhum saiu.
  if (horaComercial(agora)) {
    podar(enfileiradosFollowup, 60 * 60_000);
    const enfileirados = enfileiradosFollowup.reduce((s, e) => s + e.n, 0);
    const primeiro = enfileiradosFollowup[0]?.em ?? Date.now();
    if (enfileirados >= 5 && Date.now() - primeiro >= 30 * 60_000) {
      const desde = new Date(Date.now() - 60 * 60_000).toISOString();
      const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM conversas WHERE maisa_estado->>'followupEm' IS NOT NULL AND maisa_estado->>'followupEm' > ${desde}`;
      if (Number(r?.n ?? 0) === 0) {
        lista.push({ id: "followup", titulo: "Follow-ups parados", detalhe: `${enfileirados} conversas entraram na checagem de follow-up na última hora e nenhuma mensagem saiu.` });
      }
    }
  }

  const novos = new Map<string, Alerta>();
  for (const a of lista) novos.set(a.id, { ...a, desde: ativos.get(a.id)?.desde ?? agora.toISOString() });
  return [...novos.values()];
}

let destinatarios: string[] | null = null;
async function idsDestinatarios(): Promise<string[]> {
  if (destinatarios) return destinatarios;
  const emails = env.ALERTAS_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return (destinatarios = []);
  const us = await prisma.usuario.findMany({ where: { email: { in: emails, mode: "insensitive" }, ativo: true }, select: { id: true } });
  destinatarios = us.map((u) => u.id);
  return destinatarios;
}

export async function podeVerAlertas(usuarioId: string) {
  return (await idsDestinatarios()).includes(usuarioId);
}

export function alertasAtivos(): Alerta[] {
  return [...ativos.values()];
}

export function startMonitor() {
  instalarObservadorDeFetch();
  setInterval(() => {
    void (async () => {
      const novos = await avaliar();
      const antes = [...ativos.keys()].sort().join(",");
      const depois = novos.map((a) => a.id).sort().join(",");
      ativos = new Map(novos.map((a) => [a.id, a]));
      if (antes === depois) return;
      for (const a of novos) if (!antes.split(",").includes(a.id)) console.error(`ALERTA: ${a.titulo}. ${a.detalhe}`);
      if (!depois) console.log("ALERTA: tudo normal de novo");
      emitirParaUsuarios(await idsDestinatarios(), "sistema:alertas", novos);
    })().catch((err) => console.error("Monitor de alertas falhou:", err instanceof Error ? err.message : err));
  }, 60_000).unref();
}
