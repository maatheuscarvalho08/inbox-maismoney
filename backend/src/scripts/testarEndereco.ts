// Endereço em pedaços: conversas completas na coleta do cadastro. Interpretador confuso,
// CEP falso, nenhum modelo nem rede. Uso: npx tsx src/scripts/testarEndereco.ts
import assert from "node:assert/strict";
import { avancar, type Dependencias, type EstadoMaisa } from "../modules/maisa/fluxo.js";
import { classificadorRegras } from "../modules/maisa/classificador.js";
import type { DadosContrato } from "../modules/maisa/contrato.js";
import { criarConversaDeps } from "../modules/maisa/conversa/ligacao.js";
import { criarMotor } from "../modules/maisa/conversa/motor.js";
import { redatorReserva } from "../modules/maisa/conversa/redator.js";
import type { Interpretador } from "../modules/maisa/conversa/interpretador.js";

let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  throw new Error("fetch bloqueado");
}) as typeof fetch;

let chamadasModelo = 0;
let leiturasModelo = 0;
const modeloConfuso: Interpretador = {
  async interpretar(_ctx, msg) {
    chamadasModelo++;
    // Pergunta é pergunta (como o modelo leria); o resto, confuso, para provar que o endereço não depende dele.
    const pergunta = msg.includes("?");
    return {
      ok: true, descartados: 0, meta: { latenciaMs: 1, modelo: "falso", tokensEntrada: 1, tokensSaida: 1 },
      interpretacao: { intencao: pergunta ? "perguntar" : "ininteligivel", secundarias: [], respondeuPerguntaPendente: "nao_se_aplica", dados: [], topicoAjuda: null, tom: "neutro", reclamaRepeticao: false, confianca: pergunta ? 0.9 : 0.2 },
    };
  },
};

const CEPS: Record<string, { cidade: string; cidadeNome: string; estado: string; endereco?: string; bairro?: string }> = {
  "31320022": { cidade: "3106200", cidadeNome: "BELO HORIZONTE", estado: "MG", endereco: "Rua Castelo de Lisboa", bairro: "Castelo" },
  "31320023": { cidade: "3106200", cidadeNome: "BELO HORIZONTE", estado: "MG", endereco: "Rua Castelo de Évora", bairro: "Castelo" },
};

class Conversa {
  agora = new Date("2026-11-19T15:00:00Z");
  estado: EstadoMaisa;
  ultimas: string[] = [];
  constructor(estado: EstadoMaisa) {
    this.estado = estado;
  }
  deps(): Dependencias {
    return {
      classificador: classificadorRegras,
      agora: () => this.agora,
      solicitarAutorizacao: async () => { throw new Error("não"); },
      consultar: async () => { throw new Error("não"); },
      statusProposta: async () => null,
      simularPorExtrato: async () => { throw new Error("não"); },
      digitacaoAtiva: true,
      extrairDados: async () => { leiturasModelo++; return {}; },
      digitar: async () => { throw new Error("não digita em teste"); },
      responderLivre: async () => "O complemento não é obrigatório.",
      consultarCep: async (cep) => (CEPS[cep] ? { cep, ...CEPS[cep] } : null),
      conversa: criarConversaDeps({ motor: criarMotor({ interpretador: modeloConfuso, redator: redatorReserva, confiancaMin: 0.6 }), etapas: ["coleta", "extrato"] }),
    };
  }
  async diga(texto: string, minutos = 1) {
    this.agora = new Date(this.agora.getTime() + minutos * 60_000);
    const p = await avancar(this.estado, { texto, temMidia: false }, this.deps());
    this.estado = p.estado;
    this.ultimas = p.respostas;
    if (process.env.ENDERECO_VER === "1") console.log(`   cliente: ${texto}\n   maisa:   ${p.respostas.join(" || ").replace(/\n+/g, " ")}`);
    return p.respostas.join(" ");
  }
  get dados(): DadosContrato {
    return this.estado.contrato?.dados ?? {};
  }
}

// Cadastro pronto até o estado civil: a próxima pergunta é a do endereço.
const ATE_ESTADO_CIVIL: DadosContrato = {
  nome: "Maria da Silva", rg: "1234567", orgaoEmissor: "SSP", estadoRg: "MG", dataExpedicao: "2010-01-01", nomeMae: "Ana da Silva", nomePai: "José da Silva",
  cidadeNatural: "3106200", cidadeNaturalNome: "BELO HORIZONTE", estadoNatural: "MG", sexo: "F", estadoCivil: "1", estadoCivilNome: "Solteiro",
};
const PERGUNTA_ENDERECO = "Qual o CEP da sua casa e o número? Se tiver complemento, como apartamento ou bloco, manda também.";
const novaNoEndereco = (extra: DadosContrato = {}) =>
  new Conversa({ etapa: "coleta", tentativas: 0, produto: "siape", dataNascimento: "1960-01-01", contrato: { dados: { ...ATE_ESTADO_CIVIL, ...extra }, pergunta: PERGUNTA_ENDERECO } });

let ok = 0;
const falhas: string[] = [];
async function caso(nome: string, fn: () => Promise<void>) {
  if (process.env.ENDERECO_VER === "1") console.log(`\n# ${nome}`);
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}
const naoRepete = (r: string) => assert.doesNotMatch(r, /Qual o CEP da sua casa e o número\?/, "repetiu a pergunta inteira");

await caso("1. CEP, complemento e número em mensagens separadas (o caso real)", async () => {
  const c = novaNoEndereco();
  const r1 = await c.diga("31320022");
  naoRepete(r1);
  assert.match(r1, /só preciso do número da casa/);
  const r2 = await c.diga("Apto 102");
  naoRepete(r2);
  assert.match(r2, /só preciso do número da casa/);
  const r3 = await c.diga("774");
  assert.match(r3, /Recebi o endereço/);
  assert.equal(c.dados.cep, "31320022");
  assert.equal(c.dados.numero, "774");
  assert.equal(c.dados.complemento, "Apto 102");
  assert.equal(c.dados.endereco, "Rua Castelo de Lisboa");
  assert.match(r3, /e-mail/);
});

await caso("2. CEP e número na mesma mensagem", async () => {
  const c = novaNoEndereco();
  const r = await c.diga("31320-022, 774");
  assert.equal(c.dados.cep, "31320022");
  assert.equal(c.dados.numero, "774");
  assert.match(r, /Recebi o endereço/);
});

await caso("3. Número antes do CEP: pede só o CEP", async () => {
  const c = novaNoEndereco();
  const r1 = await c.diga("nº 774");
  assert.match(r1, /só preciso do CEP/);
  await c.diga("31320022");
  assert.equal(c.dados.numero, "774");
  assert.equal(c.dados.cep, "31320022");
});

await caso("4. Complemento enviado por último, depois do endereço completo", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022 774");
  const r = await c.diga("apto 102 bloco 3");
  assert.equal(c.dados.complemento, "apto 102 bloco 3");
  assert.match(r, /e-mail/);
});

await caso("5. Cliente corrige o número: vale o último e a correção fica registrada", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022");
  await c.diga("O número é 774");
  const r = await c.diga("Na verdade, o número é 747");
  assert.equal(c.dados.numero, "747");
  assert.match(r, /troquei o número/);
  const corr = c.estado.contrato?.correcoes ?? [];
  assert.ok(corr.some((x) => x.campo === "numero" && x.anterior === "774" && x.novo === "747"));
});

await caso("6. Cliente corrige o CEP: troca o CEP e a rua do CEP novo", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022 774");
  const r = await c.diga("errei o cep, é 31320-023");
  assert.equal(c.dados.cep, "31320023");
  assert.equal(c.dados.endereco, "Rua Castelo de Évora");
  assert.equal(c.dados.numero, "774");
  assert.match(r, /troquei o CEP/);
});

await caso("7. Só parte dos dados: pede só o que falta, sem repetir tudo", async () => {
  const c = novaNoEndereco();
  const r = await c.diga("31320022");
  naoRepete(r);
  assert.match(r, /número da casa/);
  assert.equal(c.dados.numero, undefined);
});

await caso("8. Mensagens com intervalo de tempo: junta mesmo depois de 2 horas", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022");
  await c.diga("774", 120);
  assert.equal(c.dados.cep, "31320022");
  assert.equal(c.dados.numero, "774");
});

await caso("9. Pergunta no meio dos dados: responde e não perde o que já tinha", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022");
  const r = await c.diga("precisa colocar o complemento?");
  assert.match(r, /não é obrigatório/);
  naoRepete(r);
  assert.equal(c.dados.cep, "31320022");
  await c.diga("774");
  assert.equal(c.dados.numero, "774");
});

await caso("10. Números sem contexto não viram CEP nem número", async () => {
  const c = novaNoEndereco();
  await c.diga("123456");
  assert.equal(c.dados.cep, undefined);
  assert.equal(c.dados.numero, undefined);
  await c.diga("Rua das Flores 774 perto da padaria do seu João que fica na esquina");
  assert.equal(c.dados.numero, undefined);
  await c.diga("99999999");
  assert.equal(c.dados.cep, undefined);
  assert.match(c.ultimas.join(" "), /Não encontrei esse CEP/);
});

await caso("11. Endereço fora da etapa e fora da pergunta do endereço não é absorvido", async () => {
  const ext = new Conversa({ etapa: "extrato", tentativas: 0, produto: "siape", dataNascimento: "1960-01-01" });
  await ext.diga("31320022");
  assert.equal(ext.estado.contrato, undefined);
  // Pedindo o RG: "774" não é o número da casa.
  const rg = new Conversa({ etapa: "coleta", tentativas: 0, produto: "siape", dataNascimento: "1960-01-01", contrato: { dados: {}, pergunta: "Me manda uma foto do seu RG" } });
  await rg.diga("774");
  assert.equal(rg.dados.numero, undefined);
});

await caso("12. Campo repetido: diz que já tem e pede só o que falta", async () => {
  const c = novaNoEndereco();
  await c.diga("31320022");
  const r = await c.diga("31320022");
  assert.match(r, /CEP já está aqui/);
  assert.match(r, /número da casa/);
  assert.equal(c.dados.cep, "31320022");
});

await caso("Endereço em pedaços não chama o modelo (nem interpretação nem leitura de dados)", async () => {
  const antesI = chamadasModelo;
  const antesL = leiturasModelo;
  const c = novaNoEndereco();
  await c.diga("31320022");
  await c.diga("Apto 102");
  await c.diga("774");
  assert.equal(chamadasModelo, antesI);
  assert.equal(leiturasModelo, antesL);
});

await caso("Endereço completo no fim do cadastro vai para a confirmação com tudo", async () => {
  const resto: DadosContrato = { email: "maria@exemplo.com", matricula: "1234567", renda: 5000, bancoConta: "1", agencia: "1234", conta: "56789", pixCpf: true, tipoCreditoNb: "1", tipoBeneficio: "41" };
  const c = novaNoEndereco(resto);
  await c.diga("31320022");
  await c.diga("774 apto 102");
  assert.equal(c.estado.etapa, "confirmacao");
  assert.match(c.ultimas.join(" "), /CEP 31320022/);
});

await caso("Nenhuma chamada externa", async () => assert.equal(fetches, 0));

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
