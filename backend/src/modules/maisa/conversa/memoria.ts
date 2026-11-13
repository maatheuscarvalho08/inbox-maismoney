// Memória da conversa e controle de repetição. A segunda tentativa de uma pergunta nunca
// repete a primeira: sobe um degrau (reformular, orientar, alternativa) e, no fim, a equipe.
import { ORDEM_ESTRATEGIAS, memoriaVazia, type Estrategia, type MemoriaConversa } from "./tipos.js";

export const MAX_TENTATIVAS_PERGUNTA = 4;
const MAX_PERGUNTAS_GUARDADAS = 8;

export const obter = (m?: MemoriaConversa): MemoriaConversa => (m ? { ...memoriaVazia(), ...m, perguntas: { ...m.perguntas } } : memoriaVazia());

// Quantas vezes esta pergunta já foi feita ou ajudada.
export const tentativasDa = (m: MemoriaConversa, chave: string) => m.perguntas[chave]?.tentativas ?? 0;

// A próxima estratégia para a pergunta: sempre um degrau acima da última usada.
export function proximaEstrategia(m: MemoriaConversa, chave: string): Estrategia {
  const usadas = m.perguntas[chave]?.estrategias ?? [];
  if (!usadas.length) return "pergunta_original";
  const ultima = ORDEM_ESTRATEGIAS.indexOf(usadas[usadas.length - 1]);
  return ORDEM_ESTRATEGIAS[Math.min(ultima + 1, ORDEM_ESTRATEGIAS.length - 1)];
}

export function registrarTentativa(m: MemoriaConversa, chave: string, estrategia: Estrategia, agora: Date): MemoriaConversa {
  const atual = m.perguntas[chave] ?? { tentativas: 0, estrategias: [], ultimaEm: agora.toISOString() };
  const perguntas = { ...m.perguntas, [chave]: { tentativas: atual.tentativas + 1, estrategias: [...atual.estrategias, estrategia].slice(-6), ultimaEm: agora.toISOString() } };
  // Guarda só as mais recentes: a memória não cresce sem limite dentro do estado.
  const chaves = Object.keys(perguntas).sort((a, b) => perguntas[b].ultimaEm.localeCompare(perguntas[a].ultimaEm)).slice(0, MAX_PERGUNTAS_GUARDADAS);
  return { ...m, perguntas: Object.fromEntries(chaves.map((c) => [c, perguntas[c]])) };
}

export function registrarOrientacao(m: MemoriaConversa, id: string, versao: string, agora: Date): MemoriaConversa {
  return { ...m, orientacoes: [...m.orientacoes.filter((o) => o.id !== id), { id, versao, em: agora.toISOString() }].slice(-6) };
}

// A pergunta foi respondida: o contador dela zera.
export function resolvida(m: MemoriaConversa, chave: string): MemoriaConversa {
  const { [chave]: _, ...resto } = m.perguntas;
  return { ...m, perguntas: resto, ajudasSemProgresso: 0 };
}
