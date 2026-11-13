// Revisão manual da fase 2 sobre a análise automática. Aplica a mesma correção às duas
// rodadas (o comportamento foi idêntico nelas, exceto C1-010) e recalcula as taxas.
import { readFileSync, writeFileSync } from "node:fs";
const [, , entrada, saida] = process.argv;
const a = JSON.parse(readFileSync(entrada, "utf8"));
const rng = (p, de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => `${p}-${String(de + i).padStart(3, "0")}`);

const REPROVA = {
  ...Object.fromEntries(rng("C1", 29, 42).map((id) => [id, "Saída padrão com outra frase: \"Não consegui entender o número do contrato\" para cumprimento, agradecimento ou confirmação curta."])),
  "C2-029": "\"depois que fizer, a parcela cai quando?\" foi respondido com o valor da parcela (a palavra \"parcela\" disparou a resposta pronta), não com o quando.",
  "C2-030": "\"amanhã já cai o desconto menor?\" recebeu o valor da parcela, não o prazo.",
  "C3-013": "\"quanto fica a parcela?\" recebeu \"você recebe até R$ 12.500\" (regra de dinheiro casou \"quanto fica\").",
  "C3-015": "\"qual a taxa?\" recebeu \"São 84 parcelas de R$ 300\": não diz a taxa.",
  "C3-019": "\"qual banco?\" recebeu \"São 84 parcelas de R$ 300\": não diz o banco.",
  "C5-032": "\"a parcela vence quando?\" recebeu o valor da parcela e a taxa: responde outra pergunta.",
  "C5-033": "\"a taxa pode mudar depois?\" recebeu a taxa atual: não responde se muda.",
  "C5-037": "\"perco o desconto no salário?\" recebeu o valor da parcela.",
  "C5-040": "\"quantas parcelas eu pago na facta?\" recebeu \"as mesmas que faltavam\" sem o número (68).",
  "C5-044": "\"vou receber algum documento?\" recebeu \"não tem troco\".",
  "C5-055": "\"depois posso pegar mais dinheiro?\" recebeu \"não tem troco\" desta operação; não responde sobre depois.",
  "C6-010": "\"15/03/1958, ah não, é 16/03/1958\": guardou a primeira data (a errada). Vai errada para o contrato.",
  "C6-012": "\"errei a data, é 16/03/1958\": o modelo respondeu \"Obrigada pela correção!\" mas a data não foi alterada. Afirma uma ação que não aconteceu.",
};
const ATENCAO = {
  "C2-048": "\"levei golpe, vocês são sérios? quero fazer\": aceitou sem responder a desconfiança.",
  "C3-022": "Objeção \"muitas parcelas\" recebeu só \"São 84 parcelas de R$ 300\".",
  "C3-024": "\"prefiro menos parcelas\" recebeu só o prazo atual, sem oferecer outro.",
  "C3-028": "\"precisa do nome do pai? não tenho\" não foi respondido; listou campos que faltam.",
  "C5-002": "\"tenho 75 anos\": evasiva. Pela regra da Facta SIAPE (até 74 na assinatura) a resposta seria não.",
  "C5-005": "\"vocês guardam meu documento?\": diz que não tem a informação, mas a regra dos 4 dias existe.",
  "C5-029": "\"a Facta é confiável?\" respondeu sobre a Mais Money, não sobre a Facta.",
  "C6-004": "Vínculo certo, mas a pergunta \"vocês fazem portabilidade?\" ficou sem resposta.",
  "C6-007": "CPF aceito, \"demora muito?\" ignorado.",
  "C6-009": "Data aceita, \"até que idade?\" ignorado.",
  "C6-011": "\"minha margem é 300\" ignorado; só explicou como tirar o extrato.",
  "C6-019": "Aceite seguiu, pergunta sobre cartão ignorada.",
  "C6-024": "Aceite seguiu, \"meu salário cai no Itaú\" ignorado (conta de crédito pode estar errada).",
  "C6-026": "RG lido, \"pra que vocês precisam disso?\" ignorado.",
  "C6-027": "RG lido, \"posso mandar foto depois?\" ignorado.",
  "C6-034": "Dois números de contrato: ficou com o maior por acaso (regra pega o trecho mais longo).",
  "C6-050": "Aceite seguiu, \"só posso assinar à noite\" ignorado.",
  "IX-026": "Data corrigida depois da oferta: \"Boa pergunta!\" e equipe; a data não foi corrigida.",
};
// C4 sem aceite falso, mas com a saída padrão "Boa pergunta!" (perde a venda): atenção, cruzado com C1.
for (const n of [2, 3, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 31, 32, 36, 37, 38, 39, 47, 51]) {
  ATENCAO[`C4-${String(n).padStart(3, "0")}`] = "Não aceitou por engano, mas respondeu \"Boa pergunta!\" e passou para a equipe (efeito da causa C1).";
}

for (const c of a.cenarios) {
  const r = REPROVA[c.id];
  const t = ATENCAO[c.id];
  if (r && c.reproducao !== "reproduzida") { c.revisao = { status: "REPROVADO", motivo: r }; c.reproducao = "reproduzida"; c.statusRuns = c.statusRuns.map(() => "REPROVADO"); }
  else if (t && c.reproducao === "não reproduzida") { c.revisao = { status: "ATENÇÃO", motivo: t }; c.reproducao = "atenção"; c.statusRuns = c.statusRuns.map(() => "ATENÇÃO"); }
}
const cats = {};
for (const c of a.cenarios) {
  const x = (cats[c.categoria] ??= { cenarios: 0, execucoes: 0, aprov: 0, atencao: 0, reprov: 0, reproduzidas: 0, instaveis: 0, atencaoCen: 0, naoRep: 0, regrasReprov: 0 });
  x.cenarios++;
  for (const s of c.statusRuns) { x.execucoes++; if (s === "APROVADO") x.aprov++; else if (s === "ATENÇÃO") x.atencao++; else x.reprov++; }
  if (c.reproducao === "reproduzida") x.reproduzidas++;
  else if (c.reproducao === "instável") x.instaveis++;
  else if (c.reproducao === "atenção") x.atencaoCen++;
  else x.naoRep++;
  if (c.regrasFalha) x.regrasReprov++;
}
let T = { execucoes: 0, aprov: 0, atencao: 0, reprov: 0, cenarios: 0, reproduzidas: 0 };
for (const [k, x] of Object.entries(cats)) {
  for (const f of Object.keys(T)) T[f] += x[f] ?? 0;
  console.log(`${k} | cen ${x.cenarios} | exec ${x.execucoes} | aprov ${(100 * x.aprov / x.execucoes).toFixed(1)}% | atenção ${(100 * x.atencao / x.execucoes).toFixed(1)}% | reprov ${(100 * x.reprov / x.execucoes).toFixed(1)}% | reproduzidas ${x.reproduzidas} | instáveis ${x.instaveis} | atenção ${x.atencaoCen} | ok ${x.naoRep} | só regras reprov ${x.regrasReprov}`);
}
console.log("TOTAL", JSON.stringify(T), `aprov ${(100 * T.aprov / T.execucoes).toFixed(1)}% atenção ${(100 * T.atencao / T.execucoes).toFixed(1)}% reprov ${(100 * T.reprov / T.execucoes).toFixed(1)}%`);
a.catsRevisadas = cats;
writeFileSync(saida, JSON.stringify(a, null, 2));
