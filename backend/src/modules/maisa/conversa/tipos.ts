// Contratos da camada conversacional (fase 7). Nada aqui toca banco, WhatsApp ou Facta.
// A camada só interpreta e conduz a conversa; quem muda estado financeiro é o motor
// operacional (fluxo.ts), que valida tudo de novo.

export const INTENCOES = [
  "informar_dado", // trouxe um dado pedido (ou outro dado do cadastro)
  "corrigir_dado", // corrige algo que já tinha dito
  "confirmar", // "sim", "isso mesmo" respondendo a uma pergunta de confirmação
  "negar", // "não" respondendo a uma pergunta de confirmação
  "disponibilidade", // "sim" a "você consegue me informar?": pode fazer, mas ainda não fez
  "aguardando_orientacao", // "estou só esperando você"
  "nao_sabe_encontrar", // "não sei onde acho esse número"
  "pedir_ajuda", // "pode me explicar?", "não estou entendendo"
  "perguntar", // pergunta sobre a oferta, o processo, o produto
  "impaciencia", // "você já me perguntou isso", "estou esperando há muito tempo"
  "pedir_humano",
  "recusar",
  "enviar_arquivo",
  "fora_do_fluxo", // assunto que não tem a ver com o atendimento
  "social", // cumprimento, agradecimento, "ok"
  "ininteligivel",
] as const;
export type Intencao = (typeof INTENCOES)[number];

export const CAMPOS_DADO = [
  "numero_contrato", "cpf", "data_nascimento", "renda", "matricula", "nome", "cep", "numero_casa",
  "email", "sexo", "estado_civil", "agencia", "conta", "banco_conta", "outro",
] as const;
export type CampoDado = (typeof CAMPOS_DADO)[number];

export const TONS = ["neutro", "confuso", "irritado", "satisfeito"] as const;
export type Tom = (typeof TONS)[number];

export interface DadoInterpretado {
  campo: CampoDado;
  valor: string; // como o modelo entendeu
  evidencia: string; // trecho EXATO da mensagem que sustenta o valor
  correcao: boolean;
}

// O que o modelo devolve, já validado no formato. Ainda NÃO vale como verdade: o código
// confere cada dado contra a mensagem e contra os validadores de sempre.
export interface Interpretacao {
  intencao: Intencao;
  secundarias: Intencao[];
  respondeuPerguntaPendente: "sim" | "nao" | "parcial" | "nao_se_aplica";
  dados: DadoInterpretado[];
  topicoAjuda: string | null; // tópico da base de conhecimento a que o cliente se refere
  tom: Tom;
  reclamaRepeticao: boolean;
  confianca: number; // 0 a 1
}

export type Estrategia = "pergunta_original" | "reformular" | "orientar" | "alternativa" | "encaminhar";
export const ORDEM_ESTRATEGIAS: Estrategia[] = ["pergunta_original", "reformular", "orientar", "alternativa", "encaminhar"];

export interface PerguntaFeita {
  tentativas: number;
  estrategias: Estrategia[];
  ultimaEm: string;
}

// Memória da conversa, guardada em maisa_estado. NÃO é fonte de verdade de dado financeiro
// ou cadastral: essas continuam sendo o cadastro, a simulação e a operação Facta.
export interface MemoriaConversa {
  perguntas: Record<string, PerguntaFeita>;
  orientacoes: { id: string; versao: string; em: string }[];
  // Número de contrato achado num arquivo ou áudio, esperando o "sim" do cliente.
  contratoProposto?: { numero: string; banco: string | null; origem: "arquivo" | "audio"; em: string };
  irritacoes: number;
  reclamacoesRepeticao: number;
  baixaConfianca: number;
  falhasModelo: number;
  ajudasSemProgresso: number;
}

export const memoriaVazia = (): MemoriaConversa => ({
  perguntas: {}, orientacoes: [], irritacoes: 0, reclamacoesRepeticao: 0, baixaConfianca: 0, falhasModelo: 0, ajudasSemProgresso: 0,
});

export type AcaoResposta =
  | "continuar_com_orientacao" // "sim, consigo": vai em frente e diz como
  | "explicar_proximo_passo" // "só esperando": o que falta e o que o cliente faz
  | "explicar_onde_achar" // orientação da base de conhecimento
  | "reformular" // a pergunta de outro jeito
  | "confirmar_ambiguo" // não tenho certeza se entendi
  | "responder_duvida" // pergunta fora do pedido, com fatos já simulados
  | "reconhecer_e_mudar_abordagem" // impaciência ou "já respondi"
  | "aproveitar_dado" // diz o que já tem e o que falta
  | "alternativa_sem_orientacao" // não tenho essa instrução: oferece outro caminho
  | "documento_sem_dado"; // recebi o arquivo mas não achei o dado

export type AcaoDialogo =
  | { tipo: "delegar"; motivo: string }
  | { tipo: "responder"; acao: AcaoResposta; estrategia: Estrategia; topico: string | null; chave: string }
  | { tipo: "encaminhar"; categoria: string; motivo: string };

// Um registro por interpretação. Sem texto do cliente, sem CPF, sem dado bancário.
export interface RegistroInterpretacao {
  modo: "ativo" | "sombra";
  etapa: string;
  intencao: Intencao | null;
  confianca: number | null;
  tom: Tom | null;
  campos: string[]; // só nomes de campo
  descartados: number; // dados que o modelo citou e o código recusou
  acao: string; // delegar, responder:<acao>, encaminhar:<categoria>
  estrategia: Estrategia | null;
  tentativa: number | null;
  reformulou: boolean;
  fonteTexto: "modelo" | "reserva" | null;
  falha: string | null; // timeout, json_invalido, schema_invalido, sem_chave...
  latenciaMs: number | null;
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  // Só no modo sombra: o que a Maisa de hoje fez nessa mesma mensagem.
  rotuloReal: string | null;
  divergiu: boolean | null;
  textoSombra: string | null;
}
