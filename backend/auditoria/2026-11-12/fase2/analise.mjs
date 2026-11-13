// Fase 2: junta as duas rodadas com o modelo e a rodada só com regras.
// Por cenário: falhou nas 2 rodadas = reproduzida; em 1 = instável; em 0 = não reproduzida.
// Por subproblema: reproduzida em 2+ cenários = recorrente; em 1 = isolada.
import { readFileSync, writeFileSync } from "node:fs";
const [, , arqModelo, arqRegras, saida] = process.argv;
const M = JSON.parse(readFileSync(arqModelo, "utf8")).resultados;
const Rg = JSON.parse(readFileSync(arqRegras, "utf8")).resultados;
const falhou = (r) => r.status === "REPROVADO" || r.status === "FALHA CRÍTICA";
const porCen = {};
for (const r of M) {
  const id = r.id.split("#")[0];
  (porCen[id] ??= { id, categoria: r.categoria, sub: r.sub, causas: r.causas, descricao: r.descricao, runs: [] }).runs.push(r);
}
for (const r of Rg) if (porCen[r.id]) porCen[r.id].regras = r;
const cens = Object.values(porCen);
for (const c of cens) {
  const f = c.runs.filter(falhou).length;
  const a = c.runs.filter((r) => r.status === "ATENÇÃO").length;
  c.reproducao = f === c.runs.length ? "reproduzida" : f > 0 ? "instável" : a > 0 ? "atenção" : "não reproduzida";
  c.regrasFalha = c.regras ? falhou(c.regras) : null;
  c.exemplo = c.runs.find(falhou) ?? c.runs.find((r) => r.status === "ATENÇÃO") ?? c.runs[0];
}
const cats = {};
for (const r of M) {
  const k = r.categoria;
  const x = (cats[k] ??= { execucoes: 0, APROVADO: 0, "ATENÇÃO": 0, REPROVADO: 0, "FALHA CRÍTICA": 0 });
  x.execucoes++; x[r.status]++;
}
for (const [k, x] of Object.entries(cats)) {
  const cs = cens.filter((c) => c.categoria === k);
  Object.assign(x, {
    cenarios: cs.length,
    aprov: +(100 * x.APROVADO / x.execucoes).toFixed(1),
    reprov: +(100 * (x.REPROVADO + x["FALHA CRÍTICA"]) / x.execucoes).toFixed(1),
    atencao: +(100 * x["ATENÇÃO"] / x.execucoes).toFixed(1),
    reproduzidas: cs.filter((c) => c.reproducao === "reproduzida").length,
    instaveis: cs.filter((c) => c.reproducao === "instável").length,
    naoReproduzidas: cs.filter((c) => c.reproducao === "não reproduzida").length,
    atencaoCen: cs.filter((c) => c.reproducao === "atenção").length,
    regrasReprov: cs.filter((c) => c.regrasFalha).length,
  });
}
const subs = {};
for (const c of cens) {
  const k = `${c.categoria} :: ${c.sub}`;
  const s = (subs[k] ??= { categoria: c.categoria, sub: c.sub, total: 0, reproduzidas: 0, instaveis: 0 });
  s.total++;
  if (c.reproducao === "reproduzida") s.reproduzidas++;
  if (c.reproducao === "instável") s.instaveis++;
}
for (const s of Object.values(subs)) s.classe = s.reproduzidas >= 2 ? "recorrente" : s.reproduzidas === 1 ? "isolada" : s.instaveis ? "instável" : "não reproduzida";
const total = { execucoesModelo: M.length, execucoesRegras: Rg.length, cenarios: cens.length };
const out = { total, cats, subs: Object.values(subs), cenarios: cens.map((c) => ({
  id: c.id, categoria: c.categoria, sub: c.sub, causas: c.causas, descricao: c.descricao, reproducao: c.reproducao, regrasFalha: c.regrasFalha,
  statusRuns: c.runs.map((r) => r.status),
  falhas: [...new Set(c.runs.flatMap((r) => r.checagens.filter((k) => !k.ok).map((k) => k.descricao)))],
  ultimo: c.exemplo.turnos.at(-1),
  turnos: c.exemplo.turnos,
})) };
writeFileSync(saida, JSON.stringify(out, null, 2));
console.log(JSON.stringify(total));
for (const [k, x] of Object.entries(cats)) console.log(k, JSON.stringify({ cen: x.cenarios, exec: x.execucoes, aprov: x.aprov, atencao: x.atencao, reprov: x.reprov, reproduzidas: x.reproduzidas, instaveis: x.instaveis, naoRep: x.naoReproduzidas, atencaoCen: x.atencaoCen, regrasReprov: x.regrasReprov }));
console.log("--- subproblemas");
for (const s of Object.values(subs).sort((a, b) => b.reproduzidas - a.reproduzidas)) console.log(`${s.categoria} | ${s.sub} | ${s.reproduzidas}/${s.total} reproduzidas, ${s.instaveis} instáveis -> ${s.classe}`);
