// Reformulação, primeira parte: cliente com proposta, reação, ficha do cliente e dúvida
// respondida antes de ir para a equipe. Sem modelo, sem Facta. Uso: npx tsx src/scripts/testarReformulacao.ts
import assert from "node:assert/strict";
import { avancar, fichaCliente, type Dependencias, type EstadoMaisa, type Passo, type PropostaRecente } from "../modules/maisa/fluxo.js";
import { classificadorRegras } from "../modules/maisa/classificador.js";
import type { DigitacaoPort } from "../modules/maisa/bancos.js";

globalThis.fetch = (async () => {
  throw new Error("fetch bloqueado");
}) as typeof fetch;

const DIG: DigitacaoPort = {
  banco: "INTERME", bancoCodigo: "77", numeroContrato: "16361925", parcela: 543.59, prazoRestante: 89, prazoOriginal: 96, saldoDevedor: 25702.36,
  port: { codigoTabela: 115445, prazo: 89, contrato: 25702.36, parcela: 534.94, coeficiente: 0.020813, nome: "68322", taxa: 1.5, liquido: 0 },
  refin: { codigoTabela: 117036, prazo: 120, contrato: 26524.46, parcela: 543.59, coeficiente: 0.021103, nome: "73083", taxa: 1.75, liquido: 822.1 },
};
const CEF: DigitacaoPort = { ...DIG, banco: "CEF", bancoCodigo: "104", numeroContrato: "04082110001", parcela: 288.49, refin: undefined };
const ofertaPort = (): EstadoMaisa => ({
  etapa: "oferta_port", tentativas: 0, produto: "siape", dataNascimento: "1955-06-08",
  alternativa: { operacao: "port_refin", trocoCentavos: 82210, motivo: "t", numeroContrato: "16361925", digitacao: DIG, simulacoes: [DIG, CEF] },
} as EstadoMaisa);

const PROPOSTA: PropostaRecente = { banco: "Facta", status: "digitada", statusTexto: "digitada, aguardando o banco", codigoAf: "124710181", url: "facta.ly/8e19fd3b", criadaEm: "2026-11-19T18:23:00Z" };

function deps(o: { proposta?: PropostaRecente | null; livre?: string | null; fichas?: string[] } = {}): Dependencias {
  return {
    classificador: classificadorRegras,
    agora: () => new Date("2026-11-19T19:00:00Z"),
    solicitarAutorizacao: async () => { throw new Error("não"); },
    consultar: async () => { throw new Error("não"); },
    statusProposta: async () => null,
    simularPorExtrato: async () => { throw new Error("não"); },
    digitacaoAtiva: true,
    extrairDados: async () => ({}),
    digitar: async () => { throw new Error("não digita"); },
    propostaRecente: async () => o.proposta ?? null,
    responderLivre: async (_t, _e, _p, _q, ficha) => { o.fichas?.push(ficha ?? ""); return o.livre ?? null; },
  } as Dependencias;
}
const diga = (estado: EstadoMaisa | null, texto: string, d: Dependencias) => avancar(estado, { texto, temMidia: false }, d);
const txt = (p: Passo) => p.respostas.join(" ");
const MENU = /Responda com o número/;
const transferiu = (p: Passo) => p.efeitos.some((e) => e.tipo === "transferir");

let ok = 0;
const falhas: string[] = [];
async function caso(nome: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

await caso("Reação a um balão: silêncio no início e no meio do cadastro", async () => {
  const r1 = await diga(null, '[Mensagem do tipo "reaction" ainda não suportada]', deps());
  assert.equal(r1.respostas.length, 0);
  const r2 = await diga({ etapa: "coleta", tentativas: 0, produto: "siape", contrato: { dados: {}, pergunta: "Qual o seu e-mail?" } } as EstadoMaisa, '[Mensagem do tipo "reaction" ainda não suportada]', deps());
  assert.equal(r2.respostas.length, 0);
  assert.equal(r2.estado.etapa, "coleta");
});

await caso("Com proposta, 'Ok.🤝': silêncio, nada de menu", async () => {
  const r = await diga({ etapa: "inicio", tentativas: 0 }, "Ok.🤝", deps({ proposta: PROPOSTA }));
  assert.equal(r.respostas.length, 0);
  assert.ok(!transferiu(r));
});

await caso("Com proposta, 'obrigada' e emoji: silêncio", async () => {
  for (const t of ["Obrigada", "👍", "🙏🙏"]) {
    const r = await diga({ etapa: "inicio", tentativas: 0 }, t, deps({ proposta: PROPOSTA }));
    assert.equal(r.respostas.length, 0, t);
  }
});

await caso("Com proposta, 'já caiu?': status e link para assinar, nada de menu", async () => {
  const r = await diga({ etapa: "inicio", tentativas: 0 }, "Já caiu o dinheiro?", deps({ proposta: PROPOSTA }));
  assert.match(txt(r), /facta\.ly\/8e19fd3b/);
  assert.doesNotMatch(txt(r), MENU);
  assert.ok(!transferiu(r));
});

await caso("Com proposta, 'cadê o link': manda o link", async () => {
  const r = await diga({ etapa: "inicio", tentativas: 0 }, "cadê o link pra assinar", deps({ proposta: PROPOSTA }));
  assert.match(txt(r), /facta\.ly\/8e19fd3b/);
});

await caso("Com proposta, outro assunto: equipe, nunca o menu", async () => {
  const r = await diga({ etapa: "inicio", tentativas: 0 }, "quero fazer outro empréstimo", deps({ proposta: PROPOSTA }));
  assert.ok(transferiu(r));
  assert.doesNotMatch(txt(r), MENU);
  assert.match(txt(r), /acompanha a sua proposta/);
});

await caso("Sem proposta, 'oi': segue o atendimento normal", async () => {
  const r = await diga(null, "oi", deps({ proposta: null }));
  assert.ok(r.respostas.length > 0);
  assert.ok(!transferiu(r));
});

await caso("Ficha do cliente traz banco, contrato, parcela e troco da simulação", async () => {
  const f = fichaCliente(ofertaPort());
  assert.match(f, /INTERME nº 16361925/);
  assert.match(f, /R\$\s?543,59/);
  assert.match(f, /R\$\s?822,10/);
  assert.match(f, /CEF nº 04082110001/);
  assert.match(f, /não abriu tabela com troco/);
});

await caso("Oferta, 'Qual seria o banco?': responde com a ficha e repete a pergunta, sem transferir", async () => {
  const fichas: string[] = [];
  const r = await diga(ofertaPort(), "Qual seria o banco?", deps({ livre: "A portabilidade é para o banco Facta, com o seu contrato do INTERME.", fichas }));
  assert.ok(!transferiu(r));
  assert.equal(r.estado.etapa, "oferta_port");
  assert.match(txt(r), /banco Facta/);
  assert.equal(r.respostas.length, 2);
  assert.match(fichas[0], /16361925/);
});

await caso("Oferta, pergunta sem resposta possível: aí sim vai para a equipe", async () => {
  const r = await diga(ofertaPort(), "E as margens dos cartões, consegue fazer?", deps({ livre: null }));
  assert.ok(transferiu(r));
});

await caso("Início, dúvida fora do FAQ: responde e segue para o vínculo", async () => {
  const r = await diga(null, "vocês atendem aposentado do INSS de outro estado?", deps({ livre: "Atendemos sim, o atendimento é todo por aqui." }));
  if (transferiu(r)) {
    // A regra de convênio pode pegar "INSS" antes: tudo bem, desde que não transfira.
    assert.fail("transferiu uma dúvida que tinha resposta");
  }
  assert.ok(r.respostas.length > 0);
});

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
