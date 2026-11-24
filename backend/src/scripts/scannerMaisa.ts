// Scanner da Maisa: tudo o que aconteceu num período, só leitura. Gera um resumo com números
// exatos e as conversas completas, com CPF, contas e outros números mascarados, para uma
// pessoa ou o Claude classificar o que melhorar. Não envia nada e não altera nada.
//
// Uso: node dist/scripts/scannerMaisa.js --desde 2026-11-20T14:00:00-03:00 --ate 2026-11-24T13:00:00-03:00 [--saida /tmp/scanner] [--contexto 6]
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { mascararNumeros } from "../modules/maisa/conversa/contexto.js";

const args = process.argv.slice(2);
const arg = (nome: string) => (args.includes(nome) ? args[args.indexOf(nome) + 1] : undefined);
const desde = new Date(arg("--desde") ?? "");
const ate = new Date(arg("--ate") ?? "");
if (Number.isNaN(desde.getTime()) || Number.isNaN(ate.getTime())) {
  console.error("Uso: --desde <ISO com fuso> --ate <ISO com fuso> [--saida pasta]");
  process.exit(1);
}
const saida = arg("--saida") ?? "/tmp/scanner";
const POR_LOTE = 20;
// Mensagens de antes do período mostradas como contexto. O resto do histórico é resumido numa linha.
const CONTEXTO_ANTES = Number(arg("--contexto") ?? 6);
const MAX_MSG = 700;

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const brt = (d: Date) => fmtData.format(d).replace(",", "");
const horaBrt = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(d)) % 24;
const diaBrt = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);

const contar = <T>(itens: T[], chave: (x: T) => string | null | undefined) => {
  const m = new Map<string, number>();
  for (const i of itens) {
    const k = chave(i) ?? "(vazio)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
};
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const curto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const limpo = (s: string, n: number) => curto(mascararNumeros(s).replace(/\s+/g, " ").trim(), n);

const idsComMensagem = await prisma.mensagem.findMany({ where: { createdAt: { gte: desde, lte: ate } }, select: { conversaId: true }, distinct: ["conversaId"] });
const ids = idsComMensagem.map((m) => m.conversaId);

const conversas = await prisma.conversa.findMany({
  where: { id: { in: ids } },
  include: {
    instancia: { select: { nome: true, tipoConexao: true } },
    operador: { select: { nome: true } },
    etiquetas: { include: { etiqueta: { select: { nome: true } } } },
    mensagens: { orderBy: { createdAt: "asc" }, select: { remetenteTipo: true, conteudoTexto: true, tipoMidia: true, analiseResumo: true, statusEntrega: true, erroEntrega: true, createdAt: true, operador: { select: { nome: true } } } },
  },
  orderBy: { createdAt: "asc" },
});
const eventos = await prisma.maisaEvento.findMany({ where: { conversaId: { in: ids } }, orderBy: { createdAt: "asc" } });
const propostas = await prisma.proposta.findMany({ where: { conversaId: { in: ids } } });
const simulacoes = await prisma.simulacao.findMany({ where: { conversaId: { in: ids } } });
const funil = await prisma.funilEvento.findMany({ where: { conversaId: { in: ids }, createdAt: { gte: desde, lte: ate } } });
const interpretacoes = await prisma.maisaInterpretacao.findMany({ where: { conversaId: { in: ids }, createdAt: { gte: desde, lte: ate } }, select: { etapa: true, acao: true, falha: true, modo: true } });
const filaAgora = await prisma.conversa.count({ where: { comMaisa: false, operadorId: null, status: { not: "encerrada" }, respondida: true } });

const eventosPor = new Map<string, typeof eventos>();
for (const e of eventos) eventosPor.set(e.conversaId, [...(eventosPor.get(e.conversaId) ?? []), e]);

type Estado = { etapa?: string; saida?: string; paradaEm?: string; motivoTransferencia?: string; produto?: string; aceitouOferta?: boolean; margemInformada?: number; vinculoSiape?: string };
const estadoDe = (c: (typeof conversas)[number]) => (c.maisaEstado ?? {}) as Estado;

// Quando a Maisa entregou a conversa à equipe e quanto tempo até uma pessoa responder.
function esperaDaEquipe(c: (typeof conversas)[number]) {
  const ev = (eventosPor.get(c.id) ?? []).filter((e) => e.etapaDepois === "finalizada").pop();
  const e = estadoDe(c);
  if (!ev || !e.saida || ["margem_negativa", "port_pura", "sem_saldo"].includes(e.saida)) return null;
  const resposta = c.mensagens.find((m) => m.remetenteTipo === "operador" && m.createdAt > ev.createdAt);
  return { quando: ev.createdAt, esperaMin: resposta ? Math.round((resposta.createdAt.getTime() - ev.createdAt.getTime()) / 60_000) : null };
}

const esperas = conversas.map((c) => ({ c, w: esperaDaEquipe(c) })).filter((x) => x.w !== null) as { c: (typeof conversas)[number]; w: { quando: Date; esperaMin: number | null } }[];
const esperasMin = esperas.map((x) => x.w.esperaMin).filter((x): x is number => x !== null);

const ultimoRemetente = (c: (typeof conversas)[number]) => c.mensagens[c.mensagens.length - 1]?.remetenteTipo;
const abertas = conversas.filter((c) => c.status !== "encerrada");

const resumo = {
  periodo: { desde: desde.toISOString(), ate: ate.toISOString() },
  conversas: conversas.length,
  fila_agora_sem_dono: filaAgora,
  por_convenio: contar(conversas, (c) => c.convenio),
  por_status: contar(conversas, (c) => c.status),
  por_instancia: contar(conversas, (c) => c.instancia.nome),
  origem_disparo: contar(conversas, (c) => (c.origemDisparo ? "disparo" : "receptivo")),
  com_maisa_agora: contar(conversas, (c) => (c.comMaisa ? "com_maisa" : c.operadorId ? "atribuida" : "fila")),
  etapa_atual: contar(conversas, (c) => estadoDe(c).etapa),
  saida: contar(conversas, (c) => estadoDe(c).saida),
  parou_em: contar(conversas.filter((c) => estadoDe(c).paradaEm), (c) => estadoDe(c).paradaEm),
  saida_por_etapa: contar(conversas.filter((c) => estadoDe(c).saida), (c) => `${estadoDe(c).paradaEm ?? "?"} > ${estadoDe(c).saida}`),
  motivos_de_encaminhamento: contar(conversas.filter((c) => estadoDe(c).motivoTransferencia), (c) => curto(mascararNumeros(estadoDe(c).motivoTransferencia ?? "").replace(/\d+[.,]?\d*/g, "N"), 110)),
  rotulos_do_fluxo: contar(eventos.filter((e) => e.createdAt >= desde && e.createdAt <= ate), (e) => e.rotulo),
  funil: contar(funil, (f) => f.etapa),
  propostas: contar(propostas.filter((p) => p.createdAt >= desde && p.createdAt <= ate), (p) => `${p.status}${p.convenio ? ` ${p.convenio}` : ""}`),
  simulacoes: contar(simulacoes.filter((s) => s.createdAt >= desde && s.createdAt <= ate), (s) => `${s.banco} ${s.resultado}`),
  interpretacao_acoes: contar(interpretacoes, (i) => `${i.modo} ${i.acao}`),
  interpretacao_falhas: contar(interpretacoes.filter((i) => i.falha), (i) => i.falha),
  encaminhadas_para_equipe: esperas.length,
  espera_equipe_minutos: { respondidas: esperasMin.length, nunca_respondidas: esperas.length - esperasMin.length, mediana: pct(esperasMin, 0.5), p90: pct(esperasMin, 0.9) },
  encaminhamentos_por_dia_hora: contar(esperas, (x) => `${diaBrt(x.w.quando)} ${String(horaBrt(x.w.quando)).padStart(2, "0")}h`),
  paradas_sem_encaminhar: {
    cliente_sumiu_na_maisa: contar(abertas.filter((c) => c.comMaisa && ultimoRemetente(c) === "maisa"), (c) => estadoDe(c).etapa),
    cliente_falou_sem_resposta: contar(abertas.filter((c) => ultimoRemetente(c) === "cliente"), (c) => (c.comMaisa ? `maisa ${estadoDe(c).etapa}` : c.operadorId ? "atribuida" : "fila")),
  },
  falhas_de_entrega: contar(conversas.flatMap((c) => c.mensagens).filter((m) => m.statusEntrega === "falhou"), (m) => (m.erroEntrega ? curto(m.erroEntrega, 90) : "(sem motivo)")),
  mensagens_por_conversa: { mediana: pct(conversas.map((c) => c.mensagens.length), 0.5), p90: pct(conversas.map((c) => c.mensagens.length), 0.9) },
  midia_do_cliente: contar(conversas.flatMap((c) => c.mensagens).filter((m) => m.remetenteTipo === "cliente" && m.tipoMidia), (m) => m.tipoMidia?.split(";")[0]),
};

mkdirSync(saida, { recursive: true });
writeFileSync(`${saida}/resumo.json`, JSON.stringify(resumo, null, 2));

// Conversas inteiras, uma depois da outra, em lotes de POR_LOTE, com os eventos do fluxo no meio.
const indice: Record<string, string> = {};
const blocos = conversas.map((c, i) => {
  const cod = `C${String(i + 1).padStart(4, "0")}`;
  indice[cod] = c.id;
  const e = estadoDe(c);
  const linhas: { t: Date; s: string }[] = [];
  const antes = c.mensagens.filter((m) => m.createdAt < desde);
  const omitidas = Math.max(0, antes.length - CONTEXTO_ANTES);
  const mostradas = c.mensagens.filter((m) => m.createdAt >= desde || antes.indexOf(m) >= omitidas);
  for (const m of mostradas) {
    const quem = m.remetenteTipo === "cliente" ? "CLIENTE" : m.remetenteTipo === "maisa" ? "MAISA" : m.remetenteTipo === "operador" ? `EQUIPE${m.operador?.nome ? `(${m.operador.nome})` : ""}` : "NOTA-MAISA";
    const corpo = m.conteudoTexto ? limpo(m.conteudoTexto, m.remetenteTipo === "nota" ? 900 : MAX_MSG) : "";
    const midia = m.tipoMidia ? `[${m.tipoMidia.split(";")[0]}${m.analiseResumo ? `: ${limpo(m.analiseResumo, 200)}` : ""}]` : "";
    const falha = m.statusEntrega === "falhou" ? ` [NÃO ENTREGUE${m.erroEntrega ? `: ${curto(m.erroEntrega, 80)}` : ""}]` : "";
    linhas.push({ t: m.createdAt, s: `${quem}: ${[midia, corpo].filter(Boolean).join(" ")}${falha}` });
  }
  for (const ev of (eventosPor.get(c.id) ?? []).filter((x) => x.createdAt >= desde)) linhas.push({ t: ev.createdAt, s: `  >> fluxo ${ev.etapaAntes ?? "-"} -> ${ev.etapaDepois}${ev.rotulo ? ` [${ev.rotulo}]` : ""}${ev.motivo ? ` motivo: ${limpo(ev.motivo, 160)}` : ""}` });
  linhas.sort((a, b) => a.t.getTime() - b.t.getTime());
  const cab = [
    `=== ${cod} | ${c.convenio ?? "sem convênio"} | ${c.instancia.nome} (${c.instancia.tipoConexao}) | status ${c.status} | ${c.comMaisa ? "com Maisa" : c.operadorId ? `atribuída a ${c.operador?.nome ?? "?"}` : "na fila"} | ${c.origemDisparo ? "veio de disparo" : "receptivo"}`,
    `    etapa ${e.etapa ?? "-"} | parou em ${e.paradaEm ?? "-"} | saída ${e.saida ?? "-"}${e.motivoTransferencia ? ` | motivo: ${limpo(e.motivoTransferencia, 200)}` : ""}`,
    `    etiquetas: ${c.etiquetas.map((x) => x.etiqueta.nome).join(", ") || "-"} | criada ${brt(c.createdAt)}`,
  ];
  const aviso = omitidas ? `(... ${omitidas} mensagem(ns) anteriores ao período omitidas)\n` : "";
  return `${cab.join("\n")}\n${aviso}${linhas.map((l) => `[${brt(l.t)}] ${l.s}`).join("\n")}\n`;
});
for (let i = 0; i < blocos.length; i += POR_LOTE) {
  writeFileSync(`${saida}/lote-${String(i / POR_LOTE + 1).padStart(2, "0")}.txt`, blocos.slice(i, i + POR_LOTE).join("\n"));
}
writeFileSync(`${saida}/indice.json`, JSON.stringify(indice, null, 2));

console.log(`Scanner: ${conversas.length} conversa(s) de ${brt(desde)} a ${brt(ate)}. ${Math.ceil(blocos.length / POR_LOTE)} lote(s) em ${saida}.`);
await prisma.$disconnect();
