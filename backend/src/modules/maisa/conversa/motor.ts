// Orquestra as camadas A e B: monta o contexto, interpreta, decide a ação e redige. Não
// altera estado financeiro e não fala com banco, WhatsApp ou Facta. Devolve uma decisão que
// o motor operacional (fluxo.ts) aplica: delegar, responder ou encaminhar.
import { env } from "../../../config/env.js";
import { TEXTOS } from "../textos.js";
import { BASE, orientacaoPara, type ItemConhecimento } from "./conhecimento.js";
import { montarContexto, type MensagemHistorico, type Pendencia } from "./contexto.js";
import { decidirDialogo } from "./dialogo.js";
import { leituraCurta } from "./leituraCurta.js";
import type { Interpretador, MetaChamada } from "./interpretador.js";
import { obter, proximaEstrategia, registrarOrientacao, registrarTentativa, tentativasDa } from "./memoria.js";
import { redigir, type PlanoMensagem, type Redator } from "./redator.js";
import type { AcaoDialogo, Interpretacao, MemoriaConversa, RegistroInterpretacao, SituacaoConversa } from "./tipos.js";

export interface EntradaMotor {
  modo: "ativo" | "sombra";
  produto?: string;
  texto: string;
  viaAudio?: boolean;
  pendencia: Pendencia;
  contratoPedido?: string; // "CEF, parcela R$ 390,47"
  banco?: string; // banco do contrato pedido, para escolher a orientação
  oferta?: string; // resumo da oferta já simulada
  fatosOferta: string[]; // frases que podem ser citadas ao responder dúvida sobre a oferta
  memoria?: MemoriaConversa;
  historico: MensagemHistorico[];
  arquivos: { quando: Date; tipo: string; resumo: string | null }[];
  agora: Date;
}

export type SaidaMotor =
  | { tipo: "delegar"; memoria: MemoriaConversa; registro: RegistroInterpretacao; interpretacao: Interpretacao | null }
  | { tipo: "responder"; respostas: string[]; memoria: MemoriaConversa; rotulo: string; registro: RegistroInterpretacao; interpretacao: Interpretacao }
  | { tipo: "encaminhar"; categoria: string; motivo: string; respostas: string[]; memoria: MemoriaConversa; rotulo: string; registro: RegistroInterpretacao; interpretacao: Interpretacao | null };

export interface MotorConversacional {
  decidir(entrada: EntradaMotor): Promise<SaidaMotor>;
}

const TEXTO_ENCAMINHAR: Record<string, string> = {
  irritacao_repetida: "Desculpa pela confusão. Vou chamar alguém da nossa equipe para continuar com você. Já já responde aqui.",
  pediu_humano: TEXTOS.transferindo,
};

function resumoMemoria(m: MemoriaConversa, chave: string): string {
  const q = m.perguntas[chave];
  const partes = [
    q ? `esta pergunta já foi feita ${q.tentativas} vez(es), abordagens: ${q.estrategias.join(", ")}` : "primeira vez que esta pergunta é tratada",
    m.orientacoes.length ? `orientações já dadas: ${m.orientacoes.map((o) => o.id).join(", ")}` : null,
    m.irritacoes + m.reclamacoesRepeticao > 0 ? `o cliente já demonstrou irritação ${m.irritacoes + m.reclamacoesRepeticao} vez(es)` : null,
  ];
  return partes.filter(Boolean).join("; ");
}

const registroBase = (modo: "ativo" | "sombra", etapa: string): RegistroInterpretacao => ({
  modo, etapa, intencao: null, confianca: null, tom: null, campos: [], descartados: 0, acao: "delegar", estrategia: null, tentativa: null,
  reformulou: false, fonteTexto: null, falha: null, latenciaMs: null, modelo: null, tokensEntrada: null, tokensSaida: null,
  rotuloReal: null, divergiu: null, textoSombra: null,
});

const somarMeta = (r: RegistroInterpretacao, m: MetaChamada | null | undefined) => {
  if (!m) return;
  r.latenciaMs = (r.latenciaMs ?? 0) + m.latenciaMs;
  r.modelo = m.modelo ?? r.modelo;
  r.tokensEntrada = m.tokensEntrada === null ? r.tokensEntrada : (r.tokensEntrada ?? 0) + m.tokensEntrada;
  r.tokensSaida = m.tokensSaida === null ? r.tokensSaida : (r.tokensSaida ?? 0) + m.tokensSaida;
};

export function criarMotor(deps: { interpretador: Interpretador; redator: Redator; confiancaMin?: number; base?: ItemConhecimento[] }): MotorConversacional {
  const base = deps.base ?? BASE;
  const confiancaMin = deps.confiancaMin ?? env.MAISA_CONVERSA_CONFIANCA_MIN;

  return {
    async decidir(e) {
      let memoria = obter(e.memoria);
      const registro = registroBase(e.modo, e.pendencia.etapa);
      const contexto = montarContexto({
        produto: e.produto,
        pendencia: e.pendencia,
        contratoPedido: e.contratoPedido,
        oferta: e.oferta,
        historico: e.historico,
        arquivos: e.arquivos,
        memoria: resumoMemoria(memoria, e.pendencia.chave),
        mensagem: e.texto,
        viaAudio: e.viaAudio,
      });

      // Mensagem curta de andamento numa espera de dado ou arquivo: lida sem o modelo.
      const curta = e.pendencia.tipo === "dado" || e.pendencia.tipo === "arquivo" ? leituraCurta(e.texto) : null;
      const r = curta
        ? { ok: true as const, descartados: 0, meta: { latenciaMs: 0, modelo: "regras", tokensEntrada: null, tokensSaida: null }, interpretacao: {
            intencao: curta, secundarias: [], respondeuPerguntaPendente: "nao_se_aplica" as const, dados: [], topicoAjuda: null, tom: "neutro" as const, reclamaRepeticao: false, confianca: 0.95,
          } satisfies Interpretacao }
        : await deps.interpretador.interpretar(contexto, e.texto, e.agora).catch((err): { ok: false; falha: string; meta: MetaChamada } => ({
        ok: false, falha: err instanceof Error ? err.message : "erro", meta: { latenciaMs: 0, modelo: null, tokensEntrada: null, tokensSaida: null },
      }));
      somarMeta(registro, r.meta);
      if (!r.ok) {
        // O modelo falhou: o fluxo de sempre assume, sem a camada nova.
        memoria = { ...memoria, falhasModelo: memoria.falhasModelo + 1 };
        registro.falha = r.falha;
        return { tipo: "delegar", memoria, registro, interpretacao: null };
      }
      const i = r.interpretacao;
      registro.intencao = i.intencao;
      registro.confianca = i.confianca;
      registro.tom = i.tom;
      registro.campos = i.dados.map((d) => d.campo);
      registro.descartados = r.descartados;

      // A orientação de como achar ou mandar já foi dada? Memória da camada, ou o pedido de
      // arquivo já veio com o passo a passo (mensagem longa da Maisa nas últimas).
      const ultimasMaisa = e.historico.filter((m) => m.de === "maisa" && m.texto).sort((a, b) => b.quando.getTime() - a.quando.getTime()).slice(0, 3).map((m) => m.texto!);
      const itemDoTopico = e.pendencia.topico ? orientacaoPara(e.pendencia.topico, { produto: e.produto, banco: e.banco }, base) : null;
      const orientacaoJaDada =
        Boolean(memoria.orientadas?.includes(e.pendencia.chave)) ||
        Boolean(itemDoTopico && memoria.orientacoes.some((o) => o.id === itemDoTopico.id)) ||
        (e.pendencia.tipo === "arquivo" && ultimasMaisa.some((t) => t.length >= 120));
      const acao: AcaoDialogo = decidirDialogo({
        orientacaoJaDada,
        agora: e.agora,
        interpretacao: i,
        pendencia: e.pendencia,
        memoria,
        confiancaMin,
        temOrientacao: (t) => orientacaoPara(t, { produto: e.produto, banco: e.banco }, base) !== null,
        temFatosDaOferta: e.fatosOferta.length > 0,
        temArquivoRecebido: e.arquivos.length > 0,
      });

      // Contadores de sinais do cliente, depois da decisão (a decisão olha o que veio antes).
      memoria = {
        ...memoria,
        irritacoes: memoria.irritacoes + (i.tom === "irritado" || i.intencao === "impaciencia" ? 1 : 0),
        reclamacoesRepeticao: memoria.reclamacoesRepeticao + (i.reclamaRepeticao ? 1 : 0),
        baixaConfianca: i.confianca < confiancaMin ? memoria.baixaConfianca + 1 : 0,
      };

      if (acao.tipo === "delegar") {
        registro.acao = `delegar:${acao.motivo}`;
        return { tipo: "delegar", memoria, registro, interpretacao: i };
      }

      if (acao.tipo === "encaminhar") {
        registro.acao = `encaminhar:${acao.categoria}`;
        registro.estrategia = "encaminhar";
        registro.tentativa = tentativasDa(memoria, e.pendencia.chave);
        const feitas = memoria.perguntas[e.pendencia.chave];
        const motivo = `${acao.motivo} (entendi: ${i.intencao}, confiança ${i.confianca.toFixed(2)}${feitas ? `; já tentei ${feitas.estrategias.join(", ")}` : ""})`;
        return {
          tipo: "encaminhar", categoria: acao.categoria, motivo, respostas: [TEXTO_ENCAMINHAR[acao.categoria] ?? TEXTOS.transferindo],
          memoria, rotulo: `conversa_encaminhou_${acao.categoria}`, registro, interpretacao: i,
        };
      }

      // Situação da conversa depois desta resposta (não muda etapa nem autoriza nada).
      const situar = (tipo: SituacaoConversa, m: MemoriaConversa): MemoriaConversa => ({ ...m, situacao: { tipo, chave: e.pendencia.chave, em: e.agora.toISOString() } });

      // Já reconheceu e o cliente segue executando: não manda nada, só espera.
      if (acao.acao === "aguardar") {
        registro.acao = "responder:aguardar";
        registro.estrategia = acao.estrategia;
        return { tipo: "responder", respostas: [], memoria: situar(i.intencao === "fazendo" ? "cliente_fazendo" : "cliente_vai_fazer", memoria), rotulo: "conversa_aguardar", registro, interpretacao: i };
      }

      // Responder: monta o plano com a orientação aprovada e os fatos permitidos.
      const topico = acao.topico;
      const item = acao.acao === "explicar_onde_achar" || acao.acao === "continuar_com_orientacao" || acao.acao === "explicar_proximo_passo" || acao.acao === "responder_duvida" || acao.acao === "reconhecer_e_mudar_abordagem"
        ? topico ? orientacaoPara(topico, { produto: e.produto, banco: e.banco }, base) : null
        : null;
      // Não repete a orientação já dada. Só quando o cliente pede ajuda (explicar_onde_achar).
      const orientacaoUsada = acao.acao === "responder_duvida" || (orientacaoJaDada && acao.acao !== "explicar_onde_achar") ? null : item;
      const plano: PlanoMensagem = {
        acao: acao.acao,
        estrategia: acao.estrategia,
        dadoPedido: e.pendencia.dadoPedido,
        pergunta: e.pendencia.pergunta,
        faltando: e.pendencia.faltando,
        coletados: e.pendencia.coletados,
        orientacao: orientacaoUsada ? orientacaoUsada.texto() : null,
        fatos: acao.acao === "responder_duvida" ? e.fatosOferta : [],
        tom: i.tom,
        intencao: i.intencao,
        tipoPendencia: e.pendencia.tipo,
        ultimasMaisa,
      };
      const redacao = await redigir(plano, deps.redator);
      somarMeta(registro, redacao.meta);
      registro.acao = `responder:${acao.acao}`;
      registro.estrategia = acao.estrategia;
      registro.tentativa = tentativasDa(memoria, e.pendencia.chave) + 1;
      registro.reformulou = acao.estrategia !== "pergunta_original";
      registro.fonteTexto = redacao.fonte;
      if (redacao.motivoReserva) registro.falha = `redator:${redacao.motivoReserva}`;

      // Reconhecer o que o cliente está fazendo não é nova tentativa da pergunta: não sobe o degrau.
      const andamento = acao.acao === "reconhecer_acao" || acao.acao === "combinar_pausa";
      if (!andamento) memoria = registrarTentativa(memoria, e.pendencia.chave, acao.estrategia, e.agora);
      if (orientacaoUsada) {
        memoria = registrarOrientacao(memoria, orientacaoUsada.id, orientacaoUsada.versao, e.agora);
        memoria = { ...memoria, orientadas: [...(memoria.orientadas ?? []).filter((c) => c !== e.pendencia.chave), e.pendencia.chave].slice(-8) };
      }
      memoria = situar(
        acao.acao === "combinar_pausa" ? "pausa"
          : acao.acao === "reconhecer_acao" ? (i.intencao === "fazendo" ? "cliente_fazendo" : "cliente_vai_fazer")
          : acao.acao === "responder_duvida" ? "duvida_pendente"
          : orientacaoUsada ? "orientacao_dada" : "aguardando_cliente",
        memoria,
      );
      if (["explicar_onde_achar", "alternativa_sem_orientacao", "continuar_com_orientacao", "explicar_proximo_passo", "confirmar_ambiguo"].includes(acao.acao)) {
        memoria = { ...memoria, ajudasSemProgresso: memoria.ajudasSemProgresso + 1 };
      }
      return { tipo: "responder", respostas: [redacao.texto], memoria, rotulo: `conversa_${acao.acao}`, registro, interpretacao: i };
    },
  };
}

export { proximaEstrategia };
