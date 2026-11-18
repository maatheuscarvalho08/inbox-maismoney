// CPF e datas: normalização, validação e o caminho dentro da conversa. Sem rede, sem banco,
// sem modelo real. Uso: npx tsx src/scripts/testarCpfDatas.ts
import assert from "node:assert/strict";
import { avancar, extrairNumeroContrato, lerDataNascimento, type Dependencias, type EstadoMaisa } from "../modules/maisa/fluxo.js";
import { classificadorRegras } from "../modules/maisa/classificador.js";
import { normalizarCpf, mascararCpf } from "../modules/maisa/cpf.js";
import { dataInexistente } from "../modules/maisa/mensagens.js";
import { criarConversaDeps } from "../modules/maisa/conversa/ligacao.js";
import { criarMotor } from "../modules/maisa/conversa/motor.js";
import { redatorReserva } from "../modules/maisa/conversa/redator.js";
import type { Interpretador } from "../modules/maisa/conversa/interpretador.js";

let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  throw new Error("fetch bloqueado");
}) as typeof fetch;

const AGORA = new Date("2026-11-18T15:00:00Z");
const CPF = "52998224725"; // válido nos dígitos verificadores
let chamadasModelo = 0;

// O modelo falso sempre diz "não entendi, confiança baixa": prova que CPF e data não dependem dele.
const modeloConfuso: Interpretador = {
  async interpretar() {
    chamadasModelo++;
    return {
      ok: true, descartados: 0, meta: { latenciaMs: 1, modelo: "falso", tokensEntrada: 1, tokensSaida: 1 },
      interpretacao: { intencao: "ininteligivel", secundarias: [], respondeuPerguntaPendente: "nao_se_aplica", dados: [], topicoAjuda: null, tom: "neutro", reclamaRepeticao: false, confianca: 0.2 },
    };
  },
};

function deps(): Dependencias {
  return {
    classificador: classificadorRegras,
    agora: () => AGORA,
    solicitarAutorizacao: async () => { throw new Error("não autoriza em teste"); },
    consultar: async () => { throw new Error("não consulta em teste"); },
    statusProposta: async () => null,
    simularPorExtrato: async () => ({ tipo: "sem_saldo", banco: "extrato", motivo: "sem margem" }),
    digitacaoAtiva: false,
    extrairDados: async () => ({}),
    digitar: async () => { throw new Error("não digita em teste"); },
    conversa: criarConversaDeps({ motor: criarMotor({ interpretador: modeloConfuso, redator: redatorReserva, confiancaMin: 0.6 }), etapas: ["cpf", "nascimento", "extrato", "numero_contrato", "coleta"] }),
  };
}

const noCpf = (produto: "siape" | "clt" = "siape"): EstadoMaisa => ({ etapa: "cpf", tentativas: 0, produto });
const naData = (): EstadoMaisa => ({ etapa: "nascimento", tentativas: 0, produto: "siape" });
const diga = (e: EstadoMaisa, texto: string) => avancar(e, { texto, temMidia: false }, deps());
const cpfDoPasso = (efeitos: { tipo: string }[]) => (efeitos.find((x) => x.tipo === "cpf") as { cpf?: string } | undefined)?.cpf ?? null;

let ok = 0;
const falhas: string[] = [];
async function caso(nome: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

// ---------- CPF ----------
for (const [n, nome, texto] of [
  [1, "só números", "52998224725"],
  [2, "pontos e traço", "529.982.247-25"],
  [3, "espaços", "529 982 247 25"],
  [4, "acompanhado de texto", "Bom dia! meu cpf é 529.982.247-25, obrigado"],
] as const) {
  await caso(`${n}. CPF ${nome}: aceito e segue para a data`, async () => {
    const p = await diga(noCpf(), texto);
    assert.equal(cpfDoPasso(p.efeitos), CPF);
    assert.equal(p.estado.etapa, "nascimento");
  });
}

await caso("4b. CPF com o traço do celular (–) e com hífens no lugar dos pontos", async () => {
  for (const t of ["529.982.247–25", "529-982-247-25", "529.982.247 - 25"]) {
    const p = await diga(noCpf(), t);
    assert.equal(cpfDoPasso(p.efeitos), CPF, t);
  }
});

await caso("5. CPF matematicamente inválido: pede para conferir, sem 'não entendi'", async () => {
  const p = await diga(noCpf(), "529.982.247-26");
  assert.equal(p.estado.etapa, "cpf");
  assert.equal(cpfDoPasso(p.efeitos), null);
  assert.match(p.respostas.join(" "), /Não consegui validar esse CPF/);
  assert.doesNotMatch(p.respostas.join(" "), /não entendi/i);
});

await caso("6. CPF com dígitos a menos ou a mais: diz quantos contou", async () => {
  const p10 = await diga(noCpf(), "5299822472");
  assert.match(p10.respostas.join(" "), /11 números, e aqui eu contei 10/);
  const p12 = await diga(noCpf(), "529.982.247-251");
  assert.match(p12.respostas.join(" "), /contei 12/);
  assert.equal(p12.estado.etapa, "cpf");
});

await caso("7. CPF em foto: nunca é lido de imagem, a Maisa não inventa nem aceita", async () => {
  const p = await avancar(noCpf("clt"), { texto: null, temMidia: true, documento: true, documentoId: "foto" }, deps());
  assert.equal(cpfDoPasso(p.efeitos), null);
  assert.equal(p.estado.cpfFim, undefined);
});

await caso("8. Leitura incompleta (dígito trocado por letra): não completa nem adivinha", async () => {
  assert.deepEqual(normalizarCpf("529.982.24O-25"), { tipo: "ausente" });
  const p = await diga(noCpf(), "529.982.24O-25");
  assert.equal(cpfDoPasso(p.efeitos), null);
  assert.equal(p.estado.etapa, "cpf");
});

// ---------- Datas ----------
for (const [n, nome, texto] of [
  [9, "com barras", "10/12/1966"],
  [10, "com pontos", "10.12.1966"],
  [11, "sem separadores", "10121966"],
  [12, "por extenso", "10 de dezembro de 1966"],
] as const) {
  await caso(`${n}. Data ${nome}: vira 1966-12-10`, async () => {
    assert.equal(lerDataNascimento(texto, AGORA), "1966-12-10");
    const p = await diga(naData(), texto);
    assert.equal(p.estado.dataNascimento, "1966-12-10");
    assert.equal(p.estado.etapa, "extrato");
  });
}

await caso("10b. Data com hífens e ano de dois dígitos", async () => {
  assert.equal(lerDataNascimento("10-12-1966", AGORA), "1966-12-10");
  assert.equal(lerDataNascimento("10/12/66", AGORA), "1966-12-10");
});

await caso("13. Ano bissexto: 29/02/1964 existe, 29/02/1965 não", async () => {
  assert.equal(lerDataNascimento("29/02/1964", AGORA), "1964-02-29");
  const p = await diga(naData(), "29/02/1965");
  assert.match(p.respostas.join(" "), /29\/02\/1965 não existe/);
  assert.equal(p.estado.etapa, "nascimento");
});

await caso("14. Data inexistente: diz qual data não existe", async () => {
  assert.equal(dataInexistente("31/02/1966"), "31/02/1966");
  assert.equal(dataInexistente("10/12/1966"), null);
  const p = await diga(naData(), "31/02/1966");
  assert.match(p.respostas.join(" "), /31\/02\/1966 não existe no calendário/);
  assert.doesNotMatch(p.respostas.join(" "), /não entendi/i);
});

await caso("15. Data ambígua no formato americano (12/25/1966): pergunta antes de usar", async () => {
  const p = await diga(naData(), "12/25/1966");
  assert.equal(p.estado.etapa, "nascimento");
  assert.equal(p.estado.dataNascimento, undefined);
  assert.equal(p.estado.dataSugerida, "1966-12-25");
  assert.match(p.respostas.join(" "), /25\/12\/1966, com o dia antes do mês/);
  const p2 = await diga(p.estado, "sim");
  assert.equal(p2.estado.dataNascimento, "1966-12-25");
});

await caso("15b. Dia até 12 vale como DD/MM, o formato do Brasil", async () => {
  assert.equal(lerDataNascimento("05/06/1966", AGORA), "1966-06-05");
});

await caso("16. Cliente corrige a data: vale a última", async () => {
  const p = await diga(naData(), "10/12/1966, ah não, errei, é 11/12/1966");
  assert.equal(p.estado.dataNascimento, "1966-12-11");
  const noExtrato: EstadoMaisa = { etapa: "extrato", tentativas: 0, produto: "siape", dataNascimento: "1966-12-10" };
  const p2 = await diga(noExtrato, "errei, é 12/12/1966");
  assert.equal(p2.estado.dataNascimento, "1966-12-12");
});

await caso("16b. Idade fora da regra continua barrada (menor de 18)", async () => {
  const p = await diga(naData(), "10/12/2015");
  assert.equal(p.estado.etapa, "nascimento");
  assert.equal(p.estado.dataNascimento, undefined);
});

await caso("17. CPF e data na mesma mensagem: usa os dois", async () => {
  for (const t of ["529.982.247-25 nasci em 10/12/1966", "52998224725 10121966", "cpf 529 982 247 25, data 10 de dezembro de 1966"]) {
    const p = await diga(noCpf(), t);
    assert.equal(cpfDoPasso(p.efeitos), CPF, t);
    assert.equal(p.estado.dataNascimento, "1966-12-10", t);
  }
});

await caso("18. Número de contrato não vira CPF, e CPF não vira contrato", async () => {
  assert.deepEqual(normalizarCpf("12345678901234"), { tipo: "ausente" });
  assert.equal(normalizarCpf("contrato 0012345678901234").tipo, "ausente");
  assert.equal(extrairNumeroContrato("20250464573"), "20250464573");
  assert.equal(extrairNumeroContrato("52998224725"), null);
});

// ---------- Segurança e arquitetura ----------
await caso("CPF e data com o modelo confuso: as regras decidem, o modelo nem é chamado", async () => {
  const antes = chamadasModelo;
  await diga(noCpf(), "529.982.247-25");
  await diga(naData(), "10.12.1966");
  await diga(noCpf(), "529.982.247-26");
  await diga(naData(), "31/02/1966");
  assert.equal(chamadasModelo, antes);
});

await caso("Respostas e máscara não expõem o CPF completo", async () => {
  const p = await diga(noCpf(), "529.982.247-25");
  assert.doesNotMatch(p.respostas.join(" ") + JSON.stringify(p.interpretacao ?? {}), /52998224725|529\.982\.247-25/);
  assert.equal(mascararCpf(CPF), "***.982.***-**");
  assert.equal(p.estado.cpfFim, "4725");
});

await caso("Nenhuma chamada externa", () => assert.equal(fetches, 0));

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
