// Fase 4: resultado final da fase 3 (linha de base) x agora, cenário a cenário.
// Regressão = aprovado em todas as rodadas antes e não aprovado em alguma agora.
// Uso: node comparar-f4.mjs <dir-base-fase3> <dir-agora>
import { readFileSync } from "node:fs";
const [, , base, agora] = process.argv;
const ler = (f) => JSON.parse(readFileSync(f, "utf8")).resultados;
const chave = (r) => `${r.categoria}|${r.id.split("#")[0]}`;
const agrupar = (rs) => rs.reduce((m, r) => ((m[chave(r)] ??= []).push(r), m), {});
const pct = (n, t) => `${((100 * n) / t).toFixed(1)}%`;
const conta = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
const linha = (nome, rs) => {
  const c = conta(rs);
  const rp = (c.REPROVADO ?? 0) + (c["FALHA CRÍTICA"] ?? 0);
  return `${nome}: ${rs.length} execuções | aprovado ${c.APROVADO ?? 0} (${pct(c.APROVADO ?? 0, rs.length)}) | atenção ${c["ATENÇÃO"] ?? 0} | reprovado ${c.REPROVADO ?? 0} | crítica ${c["FALHA CRÍTICA"] ?? 0} | funcional ${pct(rs.length - rp, rs.length)}`;
};
const pares = [
  ["Fase 1", `${base}/fase1-depois.json`, `${agora}/fase1-depois.json`],
  ["Fase 2", `${base}/fase2-depois-2-rodadas.json`, `${agora}/fase2-depois.json`],
  ["Fase 3", `${base}/fase3-novos-2-rodadas.json`, `${agora}/fase3-depois.json`],
];
for (const [nome, fa, fd] of pares) {
  const A = ler(fa), D = ler(fd);
  console.log(`${linha(`${nome} antes`, A)}\n${linha(`${nome} agora`, D)}`);
  const ga = agrupar(A), gd = agrupar(D);
  const reg = Object.entries(gd).filter(([k, rs]) => ga[k]?.every((r) => r.status === "APROVADO") && rs.some((r) => r.status !== "APROVADO"));
  const melhora = Object.entries(gd).filter(([k, rs]) => ga[k]?.some((r) => r.status !== "APROVADO") && rs.every((r) => r.status === "APROVADO"));
  console.log(`  regressões: ${reg.length} | melhoras: ${melhora.length}`);
  for (const [k, rs] of reg) {
    const r = rs.find((x) => x.status !== "APROVADO"), u = r.turnos.at(-1);
    console.log(`   REG ${k} [${rs.map((x) => x.status[0]).join("")}] ${r.descricao.slice(0, 70)}\n       x ${r.checagens.filter((c) => !c.ok).map((c) => c.descricao.slice(0, 70)).join("; ")}\n       -> ${u.etapa}: ${u.maisa.join(" | ").replace(/\s+/g, " ").slice(0, 200)}`);
  }
  for (const [k] of melhora) console.log(`   MELHORA ${k}`);
}
const F4 = ler(`${agora}/fase4-depois.json`);
console.log(`\n${linha("Fase 4 agora", F4)}`);
const g4 = agrupar(F4);
const inst = Object.entries(g4).filter(([, rs]) => new Set(rs.map((r) => r.status)).size > 1).map(([k]) => k);
console.log(`  instáveis entre as 2 rodadas: ${inst.length} ${inst.join(" ")}`);
for (const [k, rs] of Object.entries(g4).filter(([, rs]) => rs.some((r) => r.status !== "APROVADO"))) {
  const r = rs.find((x) => x.status !== "APROVADO");
  console.log(`   ${k} [${rs.map((x) => x.status[0]).join("")}] ${r.descricao.slice(0, 70)}\n       x ${r.checagens.filter((c) => !c.ok).map((c) => c.descricao.slice(0, 70)).join("; ")}`);
  for (const t of r.turnos.slice(-3)) console.log(`       ${t.cliente.slice(0, 50)} => ${t.etapa}: ${t.maisa.join(" | ").replace(/\s+/g, " ").slice(0, 170)}`);
}
