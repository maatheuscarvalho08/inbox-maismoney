// Fase 4: o que o agente em modo sombra teria feito, ao lado do que o roteiro fez.
// Uso: node dist/scripts/relatorioAgente.js [horas=24]
import { prisma } from "../db/prisma.js";
import { mascararNumeros } from "../modules/maisa/conversa/contexto.js";

const horas = Number(process.argv[2] ?? 24);
const desde = new Date(Date.now() - horas * 60 * 60_000);
const registros = await prisma.maisaInterpretacao.findMany({ where: { modo: { in: ["agente_sombra", "agente_ativo"] }, createdAt: { gte: desde } }, orderBy: { createdAt: "asc" } });

const contagem = new Map<string, number>();
for (const r of registros) contagem.set(r.acao, (contagem.get(r.acao) ?? 0) + 1);
const lat = registros.map((r) => r.latenciaMs ?? 0).filter(Boolean).sort((a, b) => a - b);
console.log(`Agente, últimas ${horas}h: ${registros.length} mensagem(ns)`);
for (const [acao, n] of [...contagem].sort((a, b) => b[1] - a[1])) console.log(`  ${acao}: ${n}`);
if (lat.length) console.log(`  latência mediana: ${lat[Math.floor(lat.length / 2)]} ms`);

const mensagens = new Map(
  (await prisma.mensagem.findMany({ where: { id: { in: registros.map((r) => r.mensagemId).filter((x): x is string => Boolean(x)) } }, select: { id: true, conteudoTexto: true } })).map((m) => [m.id, m.conteudoTexto ?? ""]),
);
const corta = (s: string | null | undefined, n = 300) => (s ? mascararNumeros(s).replace(/\s+/g, " ").slice(0, n) : "(nada)");
console.log("\nOnde o agente faria diferente:");
for (const r of registros.filter((x) => x.divergiu)) {
  console.log(`\n[${r.createdAt.toISOString().slice(5, 16).replace("T", " ")}] conversa ${r.conversaId.slice(0, 8)} | etapa ${r.etapa} | roteiro: ${r.rotuloReal}`);
  console.log(`  cliente: ${corta(mensagens.get(r.mensagemId ?? ""))}`);
  console.log(`  roteiro: ${corta(r.textoReal)}`);
  console.log(`  agente:  ${r.acao.replace("agente:", "")}${r.textoSombra ? ` | ${corta(r.textoSombra)}` : ""}`);
  console.log(`  motivo:  ${r.motivo ?? ""}`);
}
await prisma.$disconnect();
