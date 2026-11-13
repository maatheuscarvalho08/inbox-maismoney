// Montagem da camada conversacional para o serviço da Maisa: motor, histórico da conversa,
// gravação do registro de interpretação e limpeza. O fluxo.ts não conhece nada disto.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma.js";
import { env } from "../../../config/env.js";
import { configFluxo, type ConversaDeps, type EstadoMaisa } from "../fluxo.js";
import { lerArquivo } from "../midia.js";
import type { MensagemHistorico } from "./contexto.js";
import { lerContratoDoArquivo } from "./documento.js";
import { criarInterpretadorOpenAI } from "./interpretador.js";
import { criarConversaDeps, type ContextoExtra } from "./ligacao.js";
import { criarMotor, type MotorConversacional } from "./motor.js";
import { criarRedatorOpenAI } from "./redator.js";
import type { RegistroInterpretacao } from "./tipos.js";

export const modoConversa = () => env.MAISA_CONVERSA_MODO;
// consentimento, oferta e confirmação não entram na lista por configuração: ali manda o motor.
export const etapasConversa = () => env.MAISA_CONVERSA_ETAPAS.split(",").map((s) => s.trim()).filter((s) => s && !["consentimento", "oferta", "oferta_port", "confirmacao", "aguardando"].includes(s));

configFluxo.reaproveitaDias = env.MAISA_CADASTRO_REAPROVEITA_DIAS;
// Reaproveitar cadastro é comportamento da fase 7: só com a camada ativa.
configFluxo.cadastroAtivo = env.MAISA_CONVERSA_MODO === "ativo";
configFluxo.confiancaMin = env.MAISA_CONVERSA_CONFIANCA_MIN;

let motor: MotorConversacional | null = null;
export function motorDoServico(): MotorConversacional {
  motor ??= criarMotor({ interpretador: criarInterpretadorOpenAI(), redator: criarRedatorOpenAI() });
  return motor;
}
// Só para os testes: troca o motor por um falso (null volta ao real).
export const substituirMotorParaTeste = (m: MotorConversacional | null) => {
  motor = m;
};

// A sombra roda em segundo plano. Esta lista deixa os testes esperarem por ela.
const sombras = new Set<Promise<void>>();
export const aguardarSombras = async () => {
  while (sombras.size) await Promise.all([...sombras]);
};

// Histórico recente da conversa, do horário do WhatsApp (createdAt), sem notas internas.
export async function contextoDaConversa(conversaId: string): Promise<ContextoExtra> {
  const ms = await prisma.mensagem.findMany({
    where: { conversaId, remetenteTipo: { in: ["cliente", "operador", "maisa"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { remetenteTipo: true, conteudoTexto: true, tipoMidia: true, createdAt: true, analiseResumo: true },
  });
  const historico: MensagemHistorico[] = ms.map((m) => ({
    de: m.remetenteTipo === "cliente" ? "cliente" : m.remetenteTipo === "maisa" ? "maisa" : "equipe",
    texto: m.conteudoTexto,
    tipoMidia: m.tipoMidia,
    quando: m.createdAt,
  }));
  const arquivos = ms.filter((m) => m.tipoMidia && m.remetenteTipo === "cliente").map((m) => ({ quando: m.createdAt, tipo: m.tipoMidia!.split(";")[0], resumo: m.analiseResumo }));
  return { historico, arquivos };
}

// Camada ativa: monta o ConversaDeps. A leitura do contrato pelo arquivo usa o arquivo da mensagem atual.
export function conversaAtiva(conversaId: string, arquivo: { midiaPath: string; tipo: string } | null): ConversaDeps {
  return criarConversaDeps({
    motor: motorDoServico(),
    etapas: etapasConversa(),
    modo: "ativo",
    contexto: () => contextoDaConversa(conversaId),
    lerContratoDeArquivo: async () => {
      if (!arquivo) return null;
      const { lido, meta } = await lerContratoDoArquivo(await lerArquivo(arquivo.midiaPath), arquivo.tipo);
      console.log(`Maisa leu contrato no arquivo da conversa ${conversaId}: legível=${lido.legivel} ${meta.latenciaMs}ms`);
      return lido;
    },
  });
}

export const dadosDoRegistro = (conversaId: string, mensagemId: string | null, r: RegistroInterpretacao): Prisma.MaisaInterpretacaoUncheckedCreateInput => ({
  conversaId,
  mensagemId,
  modo: r.modo,
  etapa: r.etapa,
  intencao: r.intencao,
  confianca: r.confianca,
  tom: r.tom,
  campos: r.campos,
  descartados: r.descartados,
  acao: r.acao,
  estrategia: r.estrategia,
  tentativa: r.tentativa,
  reformulou: r.reformulou,
  fonteTexto: r.fonteTexto,
  falha: r.falha,
  latenciaMs: r.latenciaMs === null ? null : Math.round(r.latenciaMs),
  modelo: r.modelo,
  tokensEntrada: r.tokensEntrada,
  tokensSaida: r.tokensSaida,
  rotuloReal: r.rotuloReal,
  divergiu: r.divergiu,
  textoSombra: r.textoSombra ? r.textoSombra.slice(0, 500) : null,
});

// Modo sombra: interpreta e decide como se fosse responder, grava o que teria feito e NÃO envia
// nada. Roda depois da resposta real, em segundo plano, e nunca derruba o atendimento.
export function rodarSombra(p: Parameters<typeof rodarSombraInterno>[0]): Promise<void> {
  const t = rodarSombraInterno(p).finally(() => sombras.delete(t));
  sombras.add(t);
  return t;
}

async function rodarSombraInterno(p: {
  conversaId: string;
  mensagemId: string | null;
  estado: EstadoMaisa;
  texto: string;
  viaAudio: boolean;
  rotuloReal: string;
  respostaReal: string[];
  agora: Date;
}): Promise<void> {
  try {
    if (!etapasConversa().includes(p.estado.etapa)) return;
    const { descreverPendencia } = await import("../fluxo.js");
    const extra = await contextoDaConversa(p.conversaId);
    const d = p.estado.alternativa?.digitacao;
    const saida = await motorDoServico().decidir({
      modo: "sombra",
      produto: p.estado.produto,
      texto: p.texto,
      viaAudio: p.viaAudio,
      pendencia: descreverPendencia(p.estado),
      contratoPedido: d ? `${d.banco}, parcela R$ ${d.parcela.toFixed(2).replace(".", ",")}` : undefined,
      banco: d?.banco,
      fatosOferta: [],
      memoria: p.estado.memoria,
      historico: extra.historico,
      arquivos: extra.arquivos,
      agora: p.agora,
    });
    const r = saida.registro;
    r.rotuloReal = p.rotuloReal;
    // Divergiu: a camada nova teria falado ou encaminhado onde o fluxo de hoje seguiu ou errou.
    r.divergiu = saida.tipo !== "delegar";
    r.textoSombra = saida.tipo === "delegar" ? null : (saida.respostas[0] ?? null);
    await prisma.maisaInterpretacao.create({ data: dadosDoRegistro(p.conversaId, p.mensagemId, r) });
  } catch (err) {
    console.error(`Modo sombra da conversa ${p.conversaId} falhou:`, err instanceof Error ? err.message : err);
  }
}

// Limpeza diária: cadastro anterior velho e registros de interpretação com mais de 90 dias.
export async function limparConversa(): Promise<{ cadastros: number; registros: number }> {
  const dias = Math.max(env.MAISA_CADASTRO_REAPROVEITA_DIAS, 1);
  const cadastros = await prisma.$executeRaw`
    UPDATE conversas SET maisa_estado = maisa_estado - 'contratoSalvo'
    WHERE maisa_estado ? 'contratoSalvo'
      AND (maisa_estado #>> '{contratoSalvo,salvoEm}')::timestamptz < now() - make_interval(days => ${dias}::int)`;
  const registros = await prisma.maisaInterpretacao.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
  return { cadastros: Number(cadastros), registros: registros.count };
}
