// Monta o contexto que o interpretador e o redator veem. Respeita um orçamento de tokens,
// corta do mais antigo e mascara CPF e números longos. Não é fonte de verdade de nada.

export interface MensagemHistorico {
  de: "cliente" | "maisa" | "equipe";
  texto: string | null;
  tipoMidia?: string | null;
  quando: Date;
}

export interface Pendencia {
  etapa: string;
  chave: string; // identifica a pergunta pendente: etapa + campo
  pergunta: string; // o que a Maisa pediu por último, em texto
  dadoPedido: string; // em linguagem natural: "o número do contrato do CEF"
  tipo: "dado" | "arquivo" | "confirmacao" | "decisao";
  topico: string | null; // tópico da base de conhecimento ligado à pergunta
  faltando: string[]; // rótulos do que ainda falta
  coletados: string[]; // rótulos do que já tem
}

export interface EntradaContexto {
  produto?: string;
  pendencia: Pendencia;
  contratoPedido?: string; // "CEF, parcela R$ 390,47"
  oferta?: string; // resumo da oferta já simulada, se houver
  historico: MensagemHistorico[];
  arquivos: { quando: Date; tipo: string; resumo: string | null }[];
  memoria: string; // resumo curto da memória (perguntas feitas, orientações dadas)
  mensagem: string;
  viaAudio?: boolean;
}

// Tokens aproximados: texto em português fica perto de 3,5 caracteres por token.
export const estimarTokens = (s: string) => Math.ceil(s.length / 3.5);

const CPF = /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/g;

export const mascararCpf = (t: string) => t.replace(CPF, "[cpf]");
// Histórico: qualquer sequência longa de dígitos vira "[número ...123]".
export const mascararNumeros = (t: string) =>
  mascararCpf(t).replace(/\d[\d.\-/]{5,}\d/g, (m) => `[número ...${m.replace(/\D/g, "").slice(-3)}]`);

const corta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const ORCAMENTO_TOKENS = 1500;

export function montarContexto(e: EntradaContexto, orcamento = ORCAMENTO_TOKENS): string {
  const p = e.pendencia;
  const cabecalho = [
    `ETAPA: ${p.etapa}${e.produto ? ` | PRODUTO: ${e.produto}` : ""}`,
    `PERGUNTA PENDENTE DA MAISA (tipo ${p.tipo}): "${corta(p.pergunta, 300)}"`,
    p.coletados.length ? `JÁ COLETADO: ${p.coletados.join(", ")}` : null,
    p.faltando.length ? `AINDA FALTA: ${p.faltando.join(", ")}` : null,
    e.contratoPedido ? `CONTRATO PEDIDO AO CLIENTE: ${e.contratoPedido}` : null,
    e.oferta ? `OFERTA JÁ SIMULADA: ${e.oferta}` : null,
    e.arquivos.length
      ? `ARQUIVOS RECEBIDOS: ${e.arquivos
          .slice(-3)
          .map((a) => `${a.tipo}${a.resumo ? ` (${corta(a.resumo, 80)})` : ""}`)
          .join("; ")}`
      : null,
    e.memoria ? `MEMÓRIA: ${e.memoria}` : null,
  ].filter(Boolean) as string[];
  const atual = `MENSAGEM ATUAL DO CLIENTE${e.viaAudio ? " (veio de áudio e foi transcrita)" : ""}:\n"""${mascararCpf(e.mensagem)}"""`;
  const fixo = [...cabecalho, atual].join("\n");

  // Histórico do mais novo para o mais antigo, até acabar o orçamento; sai do mais antigo.
  const linhas: string[] = [];
  let gasto = estimarTokens(fixo);
  const recentes = [...e.historico].sort((a, b) => b.quando.getTime() - a.quando.getTime());
  for (const m of recentes) {
    const quem = m.de === "cliente" ? "Cliente" : m.de === "maisa" ? "Maisa" : "Equipe";
    const corpo = m.texto ? corta(mascararNumeros(m.texto).replace(/\s+/g, " "), 280) : `[${m.tipoMidia ?? "arquivo"}]`;
    const linha = `${quem}: ${corpo}`;
    const custo = estimarTokens(linha);
    if (gasto + custo > orcamento || linhas.length >= 8) break;
    linhas.push(linha);
    gasto += custo;
  }
  const historico = linhas.length ? `ÚLTIMAS MENSAGENS (mais antigas primeiro):\n${linhas.reverse().join("\n")}` : "ÚLTIMAS MENSAGENS: (nenhuma)";
  return `${cabecalho.join("\n")}\n${historico}\n${atual}`;
}
