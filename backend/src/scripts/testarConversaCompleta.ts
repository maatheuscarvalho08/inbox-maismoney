// Conversas completas da camada conversacional (fase 7, etapa 7): várias mensagens seguidas,
// com histórico, memória e relógio. Interpretador falso, redator de reserva, Facta falsa.
// Sem rede, sem banco, sem proposta. Uso: npx tsx src/scripts/testarConversaCompleta.ts
import assert from "node:assert/strict";
import { avancar, type Dependencias, type EstadoMaisa } from "../modules/maisa/fluxo.js";
import { classificadorRegras } from "../modules/maisa/classificador.js";
import type { Interpretador } from "../modules/maisa/conversa/interpretador.js";
import { criarConversaDeps } from "../modules/maisa/conversa/ligacao.js";
import { criarMotor } from "../modules/maisa/conversa/motor.js";
import { redatorReserva } from "../modules/maisa/conversa/redator.js";
import type { MensagemHistorico } from "../modules/maisa/conversa/contexto.js";
import type { Interpretacao } from "../modules/maisa/conversa/tipos.js";

let fetches = 0;
globalThis.fetch = (async () => {
  fetches++;
  throw new Error("fetch bloqueado");
}) as typeof fetch;

const VER = process.env.CONVERSA_VER === "1";
const interp = (o: Partial<Interpretacao>): Interpretacao => ({
  intencao: "ininteligivel", secundarias: [], respondeuPerguntaPendente: "nao_se_aplica", dados: [], topicoAjuda: null,
  tom: "neutro", reclamaRepeticao: false, confianca: 0.9, ...o,
});

// O "modelo" falso lê o texto com regras simples, como um modelo leria. Mensagens curtas de
// andamento nem chegam aqui: a leitura determinística da camada pega antes.
let chamadasModelo = 0;
const interpretadorFalso: Interpretador = {
  async interpretar(_ctx, msg) {
    chamadasModelo++;
    const t = msg.toLowerCase();
    const i =
      /ja mandei|já mandei|ja enviei|já enviei/.test(t) ? interp({ intencao: "aguardando_orientacao", reclamaRepeticao: true })
      : /nao sei|não sei|como (eu )?(baixo|tiro|faço)/.test(t) ? interp({ intencao: "pedir_ajuda", tom: "confuso", topicoAjuda: "extrato_siape" })
      : /demor|absurdo|de novo/.test(t) ? interp({ intencao: "impaciencia", tom: "irritado" })
      : /cartao|cartão|seguro de vida/.test(t) ? interp({ intencao: "fora_do_fluxo" })
      : /\?/.test(t) ? interp({ intencao: "perguntar" })
      : /obrigad/.test(t) ? interp({ intencao: "social", tom: "satisfeito" })
      : /^\d{11}$/.test(t) ? interp({ intencao: "informar_dado" })
      : /\d{2}\/\d{2}\/\d{4}/.test(t) ? interp({ intencao: /errei|na verdade/.test(t) ? "corrigir_dado" : "informar_dado" })
      : interp({ intencao: "ininteligivel", confianca: 0.3 });
    return { ok: true, interpretacao: i, descartados: 0, meta: { latenciaMs: 1, modelo: "falso", tokensEntrada: 1, tokensSaida: 1 } };
  },
};

interface Conversa { estado: EstadoMaisa; historico: MensagemHistorico[]; agora: Date; simulacoes: number; ultimas: string[] }

function nova(estado: EstadoMaisa): Conversa {
  return { estado, historico: [], agora: new Date("2026-11-18T14:00:00Z"), simulacoes: 0, ultimas: [] };
}

function deps(c: Conversa): Dependencias {
  const motor = criarMotor({ interpretador: interpretadorFalso, redator: redatorReserva, confiancaMin: 0.6 });
  return {
    classificador: classificadorRegras,
    agora: () => c.agora,
    solicitarAutorizacao: async () => { throw new Error("não autoriza em teste"); },
    consultar: async () => { throw new Error("não consulta em teste"); },
    statusProposta: async () => null,
    simularPorExtrato: async () => {
      c.simulacoes++;
      return { tipo: "sem_saldo", banco: "extrato", motivo: "sem margem" };
    },
    digitacaoAtiva: false,
    extrairDados: async () => ({}),
    digitar: async () => { throw new Error("não digita em teste"); },
    conversa: criarConversaDeps({
      motor,
      etapas: ["numero_contrato", "extrato", "cpf", "nascimento", "coleta"],
      contexto: async () => ({
        historico: c.historico,
        arquivos: c.historico.filter((m) => m.tipoMidia).map((m) => ({ quando: m.quando, tipo: m.tipoMidia!, resumo: null })),
      }),
    }),
  };
}

// Uma mensagem do cliente: anda o relógio, guarda o histórico e devolve o que a Maisa disse.
async function cliente(c: Conversa, texto: string | null, o: { arquivo?: boolean; minutos?: number } = {}): Promise<string[]> {
  c.agora = new Date(c.agora.getTime() + (o.minutos ?? 1) * 60_000);
  c.historico.push({ de: "cliente", texto, tipoMidia: o.arquivo ? "application/pdf" : null, quando: c.agora });
  const entrada = o.arquivo
    ? { texto: null, temMidia: true, documento: true, documentoId: `doc-${c.historico.length}` }
    : { texto: texto ?? "", temMidia: false };
  const p = await avancar(c.estado, entrada, deps(c));
  c.estado = p.estado;
  for (const r of p.respostas) c.historico.push({ de: "maisa", texto: r, quando: new Date(c.agora.getTime() + 1000) });
  c.ultimas = p.respostas;
  if (VER) console.log(`   cliente: ${texto ?? "[PDF]"}\n   maisa:   ${p.respostas.join(" || ").replace(/\n+/g, " ") || "(sem resposta)"}`);
  return p.respostas;
}

// A Maisa já pediu o extrato com o passo a passo (como no fluxo real, depois da data).
async function noExtrato(): Promise<Conversa> {
  const c = nova({ etapa: "nascimento", tentativas: 0, produto: "siape", nome: "Afonso Rosa" });
  await cliente(c, "14/07/1952");
  assert.equal(c.estado.etapa, "extrato");
  assert.match(c.ultimas.join(" "), /SouGov/);
  return c;
}

const REPETE_ORIENTACAO = /SouGov|Consignações|clipe|Documento e selecione/;

let ok = 0;
const falhas: string[] = [];
async function caso(nome: string, fn: () => Promise<void>) {
  if (VER) console.log(`\n# ${nome}`);
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas.push(nome);
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

await caso("1. Promete enviar: reconhece curto, sem repetir como baixar", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "Ok, vou mandar agora mesmo");
  assert.equal(r.length, 1);
  assert.doesNotMatch(r[0], REPETE_ORIENTACAO);
  assert.match(r[0], /quando estiver com o arquivo|aguardando/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("2. Está procurando: fica aguardando, sem explicar de novo", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "estou procurando aqui");
  assert.match(r.join(" "), /aguardando/);
  assert.doesNotMatch(r.join(" "), REPETE_ORIENTACAO);
});

await caso("3. Baixando o arquivo depois de prometer: não manda nada, espera", async () => {
  const c = await noExtrato();
  await cliente(c, "vou mandar");
  const r = await cliente(c, "baixando o arquivo");
  assert.equal(r.length, 0);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("4. Envia o documento depois de prometer: simula na hora", async () => {
  const c = await noExtrato();
  await cliente(c, "vou mandar agora");
  await cliente(c, "só um momento");
  await cliente(c, null, { arquivo: true, minutos: 3 });
  assert.equal(c.simulacoes, 1);
  assert.equal(c.estado.etapa, "finalizada");
});

await caso("5. Diz que já mandou sem ter mandado: avisa que não chegou", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "já mandei");
  assert.match(r.join(" "), /não chegou/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("6. Agradece: responde ao agradecimento, sem repetir o passo a passo", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "obrigado");
  assert.match(r.join(" "), /Por nada/);
  assert.doesNotMatch(r.join(" "), REPETE_ORIENTACAO);
});

await caso("7. Pede ajuda: aí sim explica como tirar o extrato", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "não sei como baixar isso");
  assert.match(r.join(" "), /SouGov|Consignações|extrato/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("8. Impaciência: reconhece e pede desculpa, sem formulário", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "vocês demoram demais");
  assert.match(r.join(" "), /[Dd]esculpa/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("9. Só 'ok' depois do pedido: entende que o cliente entendeu", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "ok");
  assert.equal(r.length, 1);
  assert.doesNotMatch(r[0], REPETE_ORIENTACAO);
  assert.doesNotMatch(r[0], /não entendi/i);
});

await caso("9b. 'entendi' no consentimento continua sem autorizar nada (regra do motor)", async () => {
  const c = nova({ etapa: "consentimento", tentativas: 0, produto: "clt", nome: "Maria da Silva" });
  const r = await cliente(c, "entendi");
  assert.equal(c.estado.etapa, "consentimento");
  assert.match(r.join(" "), /SIM ou NÃO/);
});

await caso("10. Pergunta fora da etapa com resposta aprovada: responde direto", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "qual o limite de idade?");
  assert.match(r.join(" "), /74 anos/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("11. Muda de assunto: não repete o passo a passo e volta ao que falta", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "vocês fazem cartão consignado também");
  assert.doesNotMatch(r.join(" "), REPETE_ORIENTACAO);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("12. Manda o extrato antes da hora: guarda e usa quando chega a data", async () => {
  const c = nova({ etapa: "cpf", tentativas: 0, produto: "siape" });
  await cliente(c, null, { arquivo: true });
  assert.match(c.ultimas.join(" "), /Recebi o seu documento/);
  await cliente(c, "52998224725");
  await cliente(c, "14/07/1952");
  assert.equal(c.simulacoes, 1);
});

await caso("13. Some uns minutos e volta: retoma sem repetir tudo", async () => {
  const c = await noExtrato();
  await cliente(c, "vou procurar");
  const r = await cliente(c, "voltei", { minutos: 25 });
  assert.equal(r.length, 1);
  assert.doesNotMatch(r[0], REPETE_ORIENTACAO);
  assert.match(r[0], /extrato/);
});

await caso("14. Repete a data já informada: diz que já tem", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "14/07/1952");
  assert.match(r.join(" "), /já está anotada/);
});

await caso("15. Corrige a data: atualiza antes da simulação", async () => {
  const c = await noExtrato();
  const r = await cliente(c, "errei, é 16/07/1952");
  assert.equal(c.estado.dataNascimento, "1952-07-16");
  assert.match(r.join(" "), /16\/07\/1952/);
});

await caso("Continuidade: várias mensagens seguidas sem repetir nenhuma orientação", async () => {
  const c = await noExtrato();
  const falas = ["ok", "vou mandar", "pera aí", "estou procurando", "depois eu mando, to no trabalho"];
  const todas: string[] = [];
  for (const f of falas) todas.push(...(await cliente(c, f)));
  for (const r of todas) assert.doesNotMatch(r, REPETE_ORIENTACAO);
  assert.ok(todas.length <= 3, `respostas demais: ${todas.length}`);
  assert.equal(new Set(todas).size, todas.length, "repetiu a mesma resposta");
  assert.match(todas[todas.length - 1], /continuo de onde paramos/);
  assert.equal(c.estado.etapa, "extrato");
});

await caso("Mensagens curtas de andamento não chamam o modelo", async () => {
  const c = await noExtrato();
  const antes = chamadasModelo;
  for (const f of ["ok", "vou mandar", "pera aí", "depois eu mando"]) await cliente(c, f);
  assert.equal(chamadasModelo, antes);
});

await caso("Nenhuma chamada externa", async () => assert.equal(fetches, 0));

console.log(`\n${ok} de ${ok + falhas.length} passaram`);
if (falhas.length) process.exit(1);
