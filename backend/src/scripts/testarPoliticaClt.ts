// Testa a conferência da etapa 1 antes da oferta do CLT, com a Facta simulada no fetch.
// Nenhuma chamada sai para a internet.
import assert from "node:assert/strict";

process.env.FACTA_BASE_URL = "https://facta.teste";
process.env.FACTA_USER = "u";
process.env.FACTA_PASS = "p";
process.env.FACTA_LOGIN_CERTIFICADO = "cert";
process.env.FACTA_TIMEOUT_MS = "500";

type Plano = { etapa1: (parcela: number) => Record<string, unknown> | "rede" };
let plano: Plano;
let chamadas: string[] = [];
const parcelasSimuladas: number[] = [];

const VINCULO = {
  cpf: "00000000191", matricula: "216", numeroInscricaoEmpregador: "12345678", nome: "TESTE", sexo_descricao: "Masculino",
  dataNascimento: "01/01/1990", dataAdmissao: "01/01/2020", dataDesligamento: "", elegivel: "Sim",
  valorTotalVencimentos: "3.575,05", valorMargemDisponivel: "363,43", qtdEmprestimosAtivosSuspensos: "4",
  codigoCategoriaTrabalhador: "101", tipoBloqueio_descricao: "Sem Bloqueio", possuiAlertas: "N", emprestimosLegados: "N",
  cnae_descricao: "CONSTRUCAO DE EDIFICIOS", cbo_descricao: "SERVENTE DE OBRAS", dataInicioAtividadeEmpregador: "01/01/2020",
};

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  chamadas.push(u.pathname);
  if (u.pathname === "/gera-token") return json({ erro: false, token: "t" });
  if (u.pathname === "/consignado-trabalhador/autoriza-consulta") return json({ erro: false, dados_trabalhador: { dados: [VINCULO] } });
  if (u.pathname === "/proposta/operacoes-disponiveis") {
    const parcela = Number(u.searchParams.get("valor_parcela"));
    parcelasSimuladas.push(parcela);
    return json({ erro: false, tabelas: [{ tabela: "71978 - CLT NOVO PREMIUM SB", codigoTabela: 116617, coeficiente: 0.059383, contrato: +(parcela / 0.059383).toFixed(2), prazo: 36, taxa: 4.05, parcela, valor_liquido: +(parcela / 0.059383).toFixed(2), valor_seguro: 0 }] });
  }
  if (u.pathname === "/proposta/etapa1-simulador") {
    const parcela = Number(new URLSearchParams(String(init?.body)).get("valor_parcela"));
    const r = plano.etapa1(parcela);
    if (r === "rede") throw new TypeError("fetch failed");
    return json(r);
  }
  if (/etapa2|etapa3|envio/.test(u.pathname)) throw new Error(`chamou ${u.pathname}: nunca pode`);
  return json({ erro: true, mensagem: "endpoint inesperado" });
}) as typeof fetch;

const { bancoFacta } = await import("../modules/maisa/bancos.js");

let falhas = 0;
async function caso(nome: string, fn: () => Promise<void>) {
  chamadas = [];
  parcelasSimuladas.length = 0;
  try {
    await fn();
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

await caso("Etapa 1 aceita: oferta sai e a simulação guarda 'etapa 1 ok' com o perfil", async () => {
  plano = { etapa1: () => ({ erro: false, id_simulador: "S1" }) };
  const r = await bancoFacta.consultar("00000000191");
  assert.equal(r.tipo, "com_saldo");
  if (r.tipo !== "com_saldo") return;
  assert.match(r.politica ?? "", /^etapa 1 ok/);
  assert.match(r.politica ?? "", /emprestimos 4/);
  assert.equal(parcelasSimuladas[0], 327.09, "simula com 90% da margem");
  assert.equal(r.clt?.cnpjEmpregador, "12345678");
});

await caso("Teto da etapa 1: simula de novo com o teto e oferta o valor novo", async () => {
  plano = { etapa1: (parcela) => (parcela > 300 ? { erro: true, mensagem: "O valor Máximo de Prestação disponível é de R$ 300,00", prestacao_maxima: "300.00" } : { erro: false, id_simulador: "S2" }) };
  const r = await bancoFacta.consultar("00000000191");
  assert.equal(r.tipo, "com_saldo");
  if (r.tipo !== "com_saldo") return;
  assert.deepEqual(parcelasSimuladas, [327.09, 300]);
  assert.equal(r.parcelaCentavos, 30000);
});

await caso("Fora da política (121): não oferta, vai como sem saldo com a mensagem e o perfil", async () => {
  plano = { etapa1: () => ({ erro: true, mensagem: "Operação fora da política de crédito (121).", prazo_maximo: "0", prestacao_maxima: "0.00" }) };
  const r = await bancoFacta.consultar("00000000191");
  assert.equal(r.tipo, "sem_saldo");
  if (r.tipo !== "sem_saldo") return;
  assert.match(r.motivo, /\(121\)/);
  assert.match(r.motivo, /emprestimos 4/);
});

await caso("Teto e depois fora da política (o caso do Yury): sem saldo", async () => {
  plano = { etapa1: (parcela) => (parcela > 327.09 ? { erro: true, mensagem: "teto", prestacao_maxima: "327.09" } : { erro: true, mensagem: "Operação fora da política de crédito (121).", prestacao_maxima: "0.00" }) };
  // Margem que dá parcela acima do teto já na primeira simulação.
  VINCULO.valorMargemDisponivel = "400,00";
  const r = await bancoFacta.consultar("00000000191");
  VINCULO.valorMargemDisponivel = "363,43";
  assert.equal(r.tipo, "sem_saldo");
  assert.deepEqual(parcelasSimuladas, [360, 327.09]);
});

await caso("Rede caiu na etapa 1: erro, sem oferta", async () => {
  plano = { etapa1: () => "rede" };
  const r = await bancoFacta.consultar("00000000191");
  assert.equal(r.tipo, "erro");
});

await caso("Nunca chama etapa 2 nem 3", async () => {
  plano = { etapa1: () => ({ erro: false, id_simulador: "S1" }) };
  await bancoFacta.consultar("00000000191");
  assert.ok(!chamadas.some((c) => /etapa2|etapa3|envio/.test(c)));
});

console.log(falhas ? `\n${falhas} falharam` : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
