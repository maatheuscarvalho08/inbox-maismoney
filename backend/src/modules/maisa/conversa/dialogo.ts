// Camada B: gerenciador de diálogo. Política determinística (não é um modelo) que escolhe a
// próxima ação conversacional a partir da interpretação, do estado e da memória.
//
// Regra de segurança central: este módulo só devolve ações de CONVERSA (responder, orientar,
// reformular, encaminhar) ou "delegar". Delegar entrega a mensagem ao motor operacional de
// sempre, que decide transições com as regras estritas. Aqui nada avança uma etapa
// financeira: aceite, consentimento, confirmação dos dados e digitação ficam no motor.
import { MAX_TENTATIVAS_PERGUNTA, proximaEstrategia, tentativasDa } from "./memoria.js";
import type { Pendencia } from "./contexto.js";
import type { AcaoDialogo, Interpretacao, MemoriaConversa } from "./tipos.js";

export interface EntradaDialogo {
  interpretacao: Interpretacao | null; // null: o modelo falhou
  pendencia: Pendencia;
  memoria: MemoriaConversa;
  confiancaMin: number;
  // Há orientação aprovada ou em produção para o tópico?
  temOrientacao: (topico: string) => boolean;
  // Há fatos já simulados para responder pergunta sobre a oferta?
  temFatosDaOferta: boolean;
}

const ESPERA_AJUDA = new Set(["disponibilidade", "aguardando_orientacao", "nao_sabe_encontrar", "pedir_ajuda", "ininteligivel"]);
const SEGUE_NO_MOTOR = new Set(["informar_dado", "corrigir_dado", "confirmar", "negar", "enviar_arquivo", "social", "recusar"]);

// Quantas vezes o cliente já se irritou ou reclamou de repetição antes desta mensagem.
const sinaisDeIrritacao = (m: MemoriaConversa) => m.irritacoes + m.reclamacoesRepeticao;

export function decidirDialogo(e: EntradaDialogo): AcaoDialogo {
  const bruta = e.interpretacao;
  if (!bruta) return { tipo: "delegar", motivo: "sem_interpretacao" };
  const { pendencia: p, memoria: m } = e;
  // "Sim" ou "não" só é confirmação quando a pergunta pendente é uma confirmação. Em resposta a um
  // pedido de dado, "sim" quer dizer "vou conseguir" e "não" quer dizer "não sei achar".
  const i =
    p.tipo !== "confirmacao" && p.tipo !== "decisao" && (bruta.intencao === "confirmar" || bruta.intencao === "negar")
      ? { ...bruta, intencao: bruta.intencao === "confirmar" ? ("disponibilidade" as const) : ("nao_sabe_encontrar" as const) }
      : bruta;
  const tent = tentativasDa(m, p.chave);

  if (i.intencao === "pedir_humano") return { tipo: "encaminhar", categoria: "pediu_humano", motivo: "o cliente pediu uma pessoa" };

  // Irritação ou "você já me perguntou isso": reconhece e muda de abordagem. Na segunda vez, a equipe.
  if (i.reclamaRepeticao || i.intencao === "impaciencia" || i.tom === "irritado") {
    if (sinaisDeIrritacao(m) >= 1) return { tipo: "encaminhar", categoria: "irritacao_repetida", motivo: "o cliente demonstrou irritação ou reclamou de repetição mais de uma vez" };
    const acao = i.reclamaRepeticao && p.coletados.length > 0 ? "aproveitar_dado" : "reconhecer_e_mudar_abordagem";
    return { tipo: "responder", acao, estrategia: proximaEstrategiaOuEquipe(m, p.chave, tent), topico: p.topico, chave: p.chave };
  }

  // Dado trazido, correção, confirmação, negativa, arquivo: o motor de sempre trata.
  if (SEGUE_NO_MOTOR.has(i.intencao)) {
    // Mensagem que diz trazer o dado, mas sem confiança, não passa batida: reformula antes.
    if (i.confianca < e.confiancaMin && i.intencao !== "social") return baixaConfianca(e, tent);
    return { tipo: "delegar", motivo: i.intencao };
  }

  if (i.confianca < e.confiancaMin) return baixaConfianca(e, tent);

  // Quem espera ajuda depois de muitas tentativas sem avançar vai para a equipe.
  if (ESPERA_AJUDA.has(i.intencao) && tent >= MAX_TENTATIVAS_PERGUNTA) {
    return { tipo: "encaminhar", categoria: "sem_progresso", motivo: `a pergunta "${p.chave}" foi feita ${tent} vezes sem avançar` };
  }

  const estrategia = proximaEstrategiaOuEquipe(m, p.chave, tent);
  if (estrategia === "encaminhar") return { tipo: "encaminhar", categoria: "sem_progresso", motivo: `esgotou as formas de ajudar na pergunta "${p.chave}"` };

  switch (i.intencao) {
    case "disponibilidade":
      return { tipo: "responder", acao: "continuar_com_orientacao", estrategia, topico: p.topico, chave: p.chave };
    case "aguardando_orientacao":
      return { tipo: "responder", acao: "explicar_proximo_passo", estrategia, topico: p.topico, chave: p.chave };
    case "nao_sabe_encontrar":
    case "pedir_ajuda": {
      if (m.ajudasSemProgresso >= 3) return { tipo: "encaminhar", categoria: "ajuda_sem_progresso", motivo: "pediu ajuda várias vezes e não avançou" };
      const topico = i.topicoAjuda ?? p.topico;
      if (topico && e.temOrientacao(topico)) return { tipo: "responder", acao: "explicar_onde_achar", estrategia, topico, chave: p.chave };
      return { tipo: "responder", acao: "alternativa_sem_orientacao", estrategia, topico, chave: p.chave };
    }
    case "perguntar":
    case "fora_do_fluxo":
      if (i.intencao === "perguntar" && e.temFatosDaOferta) return { tipo: "responder", acao: "responder_duvida", estrategia, topico: null, chave: p.chave };
      // Sem fatos para responder: diz o que falta e segue. Na repetição, a equipe responde melhor.
      if (tent >= 2) return { tipo: "encaminhar", categoria: "duvida_sem_resposta", motivo: "pergunta sem resposta aprovada, repetida" };
      return { tipo: "responder", acao: "explicar_proximo_passo", estrategia, topico: p.topico, chave: p.chave };
    case "ininteligivel":
      return { tipo: "responder", acao: "reformular", estrategia, topico: p.topico, chave: p.chave };
    default:
      return { tipo: "delegar", motivo: i.intencao };
  }
}

function baixaConfianca(e: EntradaDialogo, tent: number): AcaoDialogo {
  const { memoria: m, pendencia: p } = e;
  if (m.baixaConfianca >= 2) return { tipo: "encaminhar", categoria: "baixa_confianca", motivo: "a Maisa não conseguiu entender o cliente em mensagens seguidas" };
  const estrategia = proximaEstrategiaOuEquipe(m, p.chave, tent);
  if (estrategia === "encaminhar") return { tipo: "encaminhar", categoria: "sem_progresso", motivo: `esgotou as formas de perguntar "${p.chave}"` };
  return { tipo: "responder", acao: "confirmar_ambiguo", estrategia, topico: p.topico, chave: p.chave };
}

function proximaEstrategiaOuEquipe(m: MemoriaConversa, chave: string, tent: number) {
  if (tent >= MAX_TENTATIVAS_PERGUNTA) return "encaminhar" as const;
  return proximaEstrategia(m, chave);
}
