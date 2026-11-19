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

// ---------- Modo ativo: quando a decisão vale ----------
const { aplicarDecisao } = await import("../modules/maisa/agente.js");
const { transferirPeloAgente } = await import("../modules/maisa/fluxo.js");
type Estado = import("../modules/maisa/fluxo.js").EstadoMaisa;
const est = (e: Partial<Estado>): Estado => ({ etapa: "oferta_port", tentativas: 0, produto: "siape", ...e }) as Estado;
const dec = (acao: "seguir_roteiro" | "responder" | "silencio" | "equipe", texto: string | null = null) => ({ acao, texto, motivo: "teste" });

await caso("Ativo: seguir o roteiro não muda nada", async () => {
  const passo = { estado: est({}), respostas: ["roteiro"], efeitos: [], rotulo: "x" };
  assert.equal(aplicarDecisao(est({}), passo, dec("seguir_roteiro"), transferirPeloAgente).aplicado, false);
});

await caso("Ativo: passo com simulação ou proposta: vale o roteiro", async () => {
  for (const efeito of [{ tipo: "simulacao" }, { tipo: "proposta", codigoAf: "1" }, { tipo: "cpf", cpf: "1" }, { tipo: "rede", nota: "" }] as never[]) {
    const passo = { estado: est({}), respostas: ["roteiro"], efeitos: [efeito], rotulo: "x" };
    const r = aplicarDecisao(est({}), passo, dec("responder", "outro texto"), transferirPeloAgente);
    assert.equal(r.aplicado, false);
    assert.deepEqual(r.passo.respostas, ["roteiro"]);
  }
});

await caso("Ativo: digitação agendada ou com erro: vale o roteiro", async () => {
  const pendente = est({ etapa: "confirmacao", confirmacaoPendente: { recebidoEm: "", executarEm: "", consentimento: "sim" } });
  const passo = { estado: pendente, respostas: ["roteiro"], efeitos: [], rotulo: "x" };
  assert.equal(aplicarDecisao(pendente, passo, dec("silencio"), transferirPeloAgente).aplicado, false);
  const erro = est({ etapa: "confirmacao", digitacaoErro: { tipo: "erro", etapa: "x", mensagem: "x", em: "" } });
  assert.equal(aplicarDecisao(erro, { ...passo, estado: erro }, dec("responder", "oi"), transferirPeloAgente).aplicado, false);
});

await caso("Ativo: transferência por dúvida vira resposta e a conversa fica onde estava", async () => {
  const antes = est({ etapa: "oferta_port" });
  const passo = { estado: est({ etapa: "finalizada", saida: "objecao", motivoTransferencia: "dúvida sem resposta pronta na oferta: qual o banco?" }), respostas: ["vou chamar alguém"], efeitos: [{ tipo: "transferir", motivo: "x" }] as never[], rotulo: "objecao" };
  const r = aplicarDecisao(antes, passo, dec("responder", "É a Facta. Quer seguir?"), transferirPeloAgente);
  assert.equal(r.aplicado, true);
  assert.equal(r.passo.estado.etapa, "oferta_port");
  assert.deepEqual(r.passo.efeitos, []);
  assert.deepEqual(r.passo.respostas, ["É a Facta. Quer seguir?"]);
});

await caso("Ativo: transferência que não é por dúvida (pediu atendente): vale o roteiro", async () => {
  const passo = { estado: est({ etapa: "finalizada", saida: "humano" }), respostas: ["chamando"], efeitos: [{ tipo: "transferir", motivo: "x" }] as never[], rotulo: "humano" };
  assert.equal(aplicarDecisao(est({}), passo, dec("responder", "posso ajudar"), transferirPeloAgente).aplicado, false);
});

await caso("Ativo: silêncio no lugar do menu, estado fica como estava", async () => {
  const antes = est({ etapa: "inicio", produto: undefined });
  const passo = { estado: est({ etapa: "convenio", produto: undefined }), respostas: ["menu"], efeitos: [], rotulo: "menu" };
  const r = aplicarDecisao(antes, passo, dec("silencio"), transferirPeloAgente);
  assert.equal(r.aplicado, true);
  assert.deepEqual(r.passo.respostas, []);
  assert.equal(r.passo.estado.etapa, "inicio");
});

await caso("Ativo: equipe quando o roteiro não transfere", async () => {
  const passo = { estado: est({}), respostas: ["roteiro"], efeitos: [], rotulo: "x" };
  const r = aplicarDecisao(est({}), passo, dec("equipe"), transferirPeloAgente);
  assert.equal(r.aplicado, true);
  assert.equal(r.passo.estado.etapa, "finalizada");
  assert.equal(r.passo.estado.saida, "agente_equipe");
  assert.ok(r.passo.efeitos.some((e) => e.tipo === "transferir"));
});

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
