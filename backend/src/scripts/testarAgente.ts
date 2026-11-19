// Fase 4: o agente decide com o modelo simulado. Confere a entrada que ele recebe e as travas
// sobre o que ele devolve. Sem rede. Uso: npx tsx src/scripts/testarAgente.ts
import assert from "node:assert/strict";
process.env.OPENAI_API_KEY ||= "teste";
const { decidirAgente, montarEntradaAgente, numerosInventados } = await import("../modules/maisa/agente.js");
type Entrada = Parameters<typeof decidirAgente>[0];

let resposta: unknown = null;
let pedidos: string[] = [];
globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
  pedidos.push(String(init?.body ?? ""));
  return new Response(JSON.stringify({ output_text: JSON.stringify(resposta), usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
}) as unknown as typeof fetch;

const BASE: Entrada = {
  etapa: "oferta_port", produto: "siape",
  ficha: "Oferta de portabilidade para o banco Facta: contrato do INTERME nº 16361925, parcela hoje R$ 543,59.\nCom o refinanciamento na Facta: 120 parcelas de R$ 543,59, e cai na conta do cliente R$ 822,10 (troco).",
  memoriaCliente: "", historico: "Maisa: Quer seguir? Responda SIM.", mensagem: "qual o banco?", roteiro: ["Essa dúvida um especialista responde melhor."], efeitosRoteiro: ["transferir"],
};

let ok = 0;
const falhas: string[] = [];
async function caso(nome: string, fn: () => Promise<void>) {
  pedidos = [];
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

await caso("A entrada leva ficha, memória, histórico, roteiro e efeitos", async () => {
  const t = montarEntradaAgente({ ...BASE, memoriaCliente: "Proposta no Facta em 19/11/2026: digitada." });
  for (const trecho of ["FICHA DO CLIENTE", "R$ 822,10", "MEMÓRIA DO CLIENTE", "Proposta no Facta", "ÚLTIMAS MENSAGENS", "RESPOSTA DO ROTEIRO", "EFEITOS DO ROTEIRO: transferir"]) assert.ok(t.includes(trecho), trecho);
});

await caso("Responder com valor da ficha: vale", async () => {
  resposta = { acao: "responder", texto: "O banco é a Facta. Cai na sua conta R$ 822,10. Quer seguir?", motivo: "o roteiro transferia uma dúvida que a ficha responde" };
  const { decisao } = await decidirAgente(BASE);
  assert.equal(decisao.acao, "responder");
  assert.match(decisao.texto!, /822,10/);
});

await caso("Responder com número inventado: descartado, fica o roteiro", async () => {
  resposta = { acao: "responder", texto: "Cai na sua conta R$ 1.500,00 em 5 dias.", motivo: "x" };
  const { decisao } = await decidirAgente(BASE);
  assert.equal(decisao.acao, "seguir_roteiro");
  assert.match(decisao.motivo, /número fora da ficha/);
});

await caso("Responder vazio: descartado", async () => {
  resposta = { acao: "responder", texto: "  ", motivo: "x" };
  assert.equal((await decidirAgente(BASE)).decisao.acao, "seguir_roteiro");
});

await caso("Silêncio e equipe passam sem texto", async () => {
  resposta = { acao: "silencio", texto: "qualquer", motivo: "ok do cliente" };
  const s = await decidirAgente(BASE);
  assert.equal(s.decisao.acao, "silencio");
  assert.equal(s.decisao.texto, null);
  resposta = { acao: "equipe", texto: null, motivo: "pediu pessoa" };
  assert.equal((await decidirAgente(BASE)).decisao.acao, "equipe");
});

await caso("Números da mensagem e do histórico contam como lidos", async () => {
  assert.deepEqual(numerosInventados("Sua parcela de R$ 543,59 e o contrato 16361925", BASE), []);
  assert.deepEqual(numerosInventados("são 7 dias", BASE), ["7"]);
});

await caso("Sem chave: não chama o modelo", async () => {
  const antes = process.env.OPENAI_API_KEY;
  const { env } = await import("../config/env.js");
  const guardada = env.OPENAI_API_KEY;
  (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = "";
  await assert.rejects(decidirAgente(BASE), /sem_chave/);
  (env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY = guardada;
  process.env.OPENAI_API_KEY = antes;
  assert.equal(pedidos.length, 0);
});

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
