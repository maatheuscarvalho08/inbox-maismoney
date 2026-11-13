// Antes (com revisão manual) x depois, por cenário. Regressão = aprovado antes e não depois.
// Uso: node comparar.mjs <f1-antes-revisado> <f2-antes-revisado> <f1-depois> <f2-depois> <f3-depois>
import { readFileSync } from "node:fs";
const ler = (f) => JSON.parse(readFileSync(f, "utf8"));
const [, , f1a, f2a, f1d, f2d, f3d] = process.argv;
const pct = (n, t) => `${((100 * n) / t).toFixed(1)}%`;
const conta = (sts) => sts.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});

// fase 1: um status por cenário
const k1 = (r) => `${r.categoria}|${r.id}`;
const A1 = Object.fromEntries(ler(f1a).resultados.map((r) => [k1(r), r.status]));
const D1 = ler(f1d).resultados;
// fase 2: duas rodadas; antes vem da análise revisada (statusRuns), depois do resultado bruto
const A2 = Object.fromEntries(ler(f2a).cenarios.map((c) => [c.id, c.statusRuns]));
const D2 = {};
for (const r of ler(f2d).resultados) (D2[r.id.split("#")[0]] ??= []).push(r);
const D3 = {};
for (const r of ler(f3d).resultados) (D3[r.id.split("#")[0]] ??= []).push(r);

const resumo = (nome, antes, depois) => {
  const a = conta(antes), d = conta(depois);
  const ok = (m) => m.APROVADO ?? 0, at = (m) => m["ATENÇÃO"] ?? 0, rp = (m) => (m.REPROVADO ?? 0) + (m["FALHA CRÍTICA"] ?? 0);
  console.log(`${nome}: antes ${ok(a)}/${at(a)}/${rp(a)} (aprov ${pct(ok(a), antes.length)}) -> depois ${ok(d)}/${at(d)}/${rp(d)} (aprov ${pct(ok(d), depois.length)}; funcional ${pct(depois.length - rp(d), depois.length)}) | críticas depois ${d["FALHA CRÍTICA"] ?? 0}`);
};
resumo("Fase 1 (311)", Object.values(A1), D1.map((r) => r.status));
resumo("Fase 2 (748 exec.)", Object.values(A2).flat(), Object.values(D2).flat().map((r) => r.status));
resumo("Fase 3 (nova)", [], Object.values(D3).flat().map((r) => r.status));

const reg1 = D1.filter((r) => A1[k1(r)] === "APROVADO" && r.status !== "APROVADO");
const reg2 = Object.entries(D2).filter(([id, rs]) => A2[id]?.every((s) => s === "APROVADO") && rs.some((r) => r.status !== "APROVADO"));
console.log(`\nRegressões fase 1: ${reg1.length}`);
for (const r of reg1) { const u = r.turnos.at(-1); console.log(`  ${r.id} [${r.status}] ${r.descricao.slice(0, 60)} | ${r.checagens.filter((c) => !c.ok).map((c) => c.descricao.slice(0, 60)).join("; ")}\n     -> ${u.etapa}: ${u.maisa.join(" | ").replace(/\s+/g, " ").slice(0, 160)}`); }
console.log(`Regressões fase 2: ${reg2.length}`);
for (const [id, rs] of reg2) { const r = rs.find((x) => x.status !== "APROVADO"); const u = r.turnos.at(-1); console.log(`  ${id} [${rs.map((x) => x.status).join(",")}] ${r.descricao.slice(0, 60)} | ${r.checagens.filter((c) => !c.ok).map((c) => c.descricao.slice(0, 60)).join("; ")}\n     -> ${u.etapa}: ${u.maisa.join(" | ").replace(/\s+/g, " ").slice(0, 160)}`); }
const instaveis = [...Object.entries(D2), ...Object.entries(D3)].filter(([, rs]) => new Set(rs.map((r) => r.status)).size > 1).map(([id]) => id);
console.log(`\nInstáveis (diferem entre as 2 rodadas): ${instaveis.length} ${instaveis.join(" ")}`);
for (const [nome, D] of [["Fase 1", Object.fromEntries(D1.map((r) => [k1(r), [r]]))], ["Fase 2", D2], ["Fase 3", D3]]) {
  const falhas = Object.entries(D).filter(([, rs]) => rs.some((r) => r.status !== "APROVADO"));
  console.log(`\n${nome}: ${falhas.length} cenários não aprovados`);
  for (const [id, rs] of falhas) { const r = rs.find((x) => x.status !== "APROVADO"); const u = r.turnos.at(-1); console.log(`  ${id} [${rs.map((x) => x.status[0]).join("")}] ${r.descricao.slice(0, 55)} | ${r.checagens.filter((c) => !c.ok).map((c) => c.descricao.slice(0, 50)).join("; ")}\n     -> ${u.etapa}: ${u.maisa.join(" | ").replace(/\s+/g, " ").slice(0, 150)}`); }
}
