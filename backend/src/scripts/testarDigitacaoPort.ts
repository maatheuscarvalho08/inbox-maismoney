// Port + refin depois do SIM: perguntas não cancelam, a condição é conferida antes de digitar.
// Sem modelo, sem Facta, sem rede. Uso: npx tsx src/scripts/testarDigitacaoPort.ts
import assert from "node:assert/strict";
import { avancar, type Dependencias, type EstadoMaisa, type Passo, type ResultadoDigitacao } from "../modules/maisa/fluxo.js";
import { classificadorRegras } from "../modules/maisa/classificador.js";
import type { DigitacaoPort } from "../modules/maisa/bancos.js";
import { invalidaConfirmacao, perguntaSobreAndamento } from "../modules/maisa/ordemMensagens.js";

globalThis.fetch = (async () => {
  throw new Error("fetch bloqueado");
}) as typeof fetch;

const DIG: DigitacaoPort = {
  banco: "INTERME", bancoCodigo: "77", numeroContrato: "16361925", parcela: 543.59, prazoRestante: 89, prazoOriginal: 96, saldoDevedor: 25702.36,
  port: { codigoTabela: 115445, prazo: 89, contrato: 25702.36, parcela: 534.94, coeficiente: 0.020813, nome: "68322 Port", taxa: 1.5, liquido: 0 },
  refin: { codigoTabela: 117037, prazo: 120, contrato: 25986.64, parcela: 543.59, coeficiente: 0.021553, nome: "73067 NORMAL", taxa: 1.8, liquido: 284.28 },
};
const DADOS = {
  nome: "Ana Souza", rg: "530107", orgaoEmissor: "SSP", estadoRg: "AP", dataExpedicao: "2009-06-09", nomeMae: "Luzia Souza", nomePai: "Joao Souza",
  cidadeNatural: "970206", cidadeNaturalNome: "MACAPA", estadoNatural: "AP", sexo: "F", estadoCivil: "4", estadoCivilNome: "SOLTEIRO",
  cep: "68906848", endereco: "Alameda Oiapoque", numero: "14", bairro: "Cabralzinho", cidade: "970206", cidadeNome: "MACAPA", estado: "AP",
  email: "ana@exemplo.com", matricula: "1011305", renda: 5500, bancoConta: "341", agencia: "8529", conta: "180674",
} as const;

const confirmacao = (): EstadoMaisa => ({
  etapa: "confirmacao", tentativas: 0, produto: "siape", dataNascimento: "1955-06-08",
  alternativa: { operacao: "port_refin", trocoCentavos: 28428, motivo: "teste", numeroContrato: "16361925", digitacao: DIG },
  contrato: { dados: { ...DADOS }, pergunta: "Os dados estão certos? Responda SIM ou NÃO." },
} as EstadoMaisa);

class Cena {
  agora = new Date("2026-11-19T18:00:00Z");
  estado = confirmacao();
  digitacoes: unknown[] = [];
  revalidar: Dependencias["revalidarPort"] = async (d) => ({ port: d.port, refin: d.refin });
  resultado: ResultadoDigitacao = { tipo: "enviada", codigoAf: "AF1", url: "https://facta.ly/x" };
  deps(): Dependencias {
    return {
      classificador: classificadorRegras,
      agora: () => this.agora,
      solicitarAutorizacao: async () => { throw new Error("não"); },
      consultar: async () => { throw new Error("não"); },
      statusProposta: async () => null,
      simularPorExtrato: async () => { throw new Error("não"); },
      digitacaoAtiva: true,
      digitacaoLiberada: true,
      extrairDados: async () => ({}),
      digitar: async (d) => { this.digitacoes.push(d); return this.resultado; },
      revalidarPort: this.revalidar,
    } as Dependencias;
  }
  async diga(texto: string, segundos = 5): Promise<Passo> {
    this.agora = new Date(this.agora.getTime() + segundos * 1000);
    const p = await avancar(this.estado, { texto, temMidia: false }, this.deps());
    this.estado = p.estado;
    return p;
  }
  async executa(): Promise<Passo> {
    this.agora = new Date(this.agora.getTime() + 60_000);
    const p = await avancar(this.estado, { evento: "executar_digitacao" }, this.deps());
    this.estado = p.estado;
    return p;
  }
}

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
const txt = (p: Passo) => p.respostas.join(" ");

await caso("Leitura: perguntas de andamento", async () => {
  assert.equal(perguntaSobreAndamento("Caiu com quantos dias?"), "prazo");
  assert.equal(perguntaSobreAndamento("Só confirma o valor que pode liberar na conta?"), "valor");
  assert.equal(perguntaSobreAndamento("quanto vai cair na minha conta"), "valor");
  assert.equal(perguntaSobreAndamento("e a parcela?"), "parcela");
  assert.equal(perguntaSobreAndamento("cadê o link"), "link");
  assert.equal(perguntaSobreAndamento("espera, o valor está errado"), null);
  assert.equal(perguntaSobreAndamento("quero mudar a conta"), null);
  assert.equal(invalidaConfirmacao({ conteudoTexto: "Caiu com quantos dias?", tipoMidia: null }), false);
  assert.equal(invalidaConfirmacao({ conteudoTexto: "espera, o CEP está errado", tipoMidia: null }), true);
});

await caso("SIM e depois 'Caiu com quantos dias?': responde e digita mesmo assim", async () => {
  const c = new Cena();
  await c.diga("sim");
  const r = await c.diga("Caiu com quantos dias?");
  assert.match(txt(r), /portabilidade/);
  assert.match(txt(r), /finalizando o seu contrato/);
  assert.ok(c.estado.confirmacaoPendente, "o SIM continua agendado");
  const e = await c.executa();
  assert.equal(c.digitacoes.length, 1);
  assert.match(txt(e), /Deu certo/);
});

await caso("SIM e depois 'quanto cai na conta?': diz o valor da oferta", async () => {
  const c = new Cena();
  await c.diga("sim");
  const r = await c.diga("Só confirma o valor que pode liberar na conta?");
  assert.match(txt(r), /R\$\s?284,28/);
  assert.ok(c.estado.confirmacaoPendente);
});

await caso("SIM e depois correção: cancela e não digita", async () => {
  const c = new Cena();
  await c.diga("sim");
  await c.diga("espera, o CEP está errado");
  assert.equal(c.estado.confirmacaoPendente, undefined);
  await c.executa();
  assert.equal(c.digitacoes.length, 0);
});

await caso("Troco subiu na conferência: digita e avisa o valor novo junto com o link", async () => {
  const c = new Cena();
  c.revalidar = async (d) => ({ port: d.port, refin: { ...d.refin!, liquido: 299.5, coeficiente: 0.02154 } });
  await c.diga("sim");
  const e = await c.executa();
  assert.equal(c.digitacoes.length, 1);
  assert.match(txt(e), /R\$\s?299,50/);
  assert.equal(c.estado.alternativa?.trocoCentavos, 29950);
});

await caso("Troco caiu na conferência: não digita, mostra o valor novo e pede outro SIM", async () => {
  const c = new Cena();
  c.revalidar = async (d) => ({ port: d.port, refin: { ...d.refin!, liquido: 150, coeficiente: 0.0217 } });
  await c.diga("sim");
  const e = await c.executa();
  assert.equal(c.digitacoes.length, 0);
  assert.match(txt(e), /R\$\s?150,00/);
  assert.match(txt(e), /R\$\s?284,28/);
  assert.equal(c.estado.etapa, "confirmacao");
  // Aceita o valor novo: agora digita com ele.
  await c.diga("sim");
  const e2 = await c.executa();
  assert.equal(c.digitacoes.length, 1);
  assert.match(txt(e2), /R\$\s?150,00/);
});

await caso("Conferência sem a tabela: REDE, nada é digitado", async () => {
  const c = new Cena();
  c.revalidar = async () => ({ erro: "tabela do refin não voltou" });
  await c.diga("sim");
  const e = await c.executa();
  assert.equal(c.digitacoes.length, 0);
  assert.ok(e.efeitos.some((x) => x.tipo === "rede"));
  assert.ok(c.estado.digitacaoErro);
});

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
