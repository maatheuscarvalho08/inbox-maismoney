export type Role = "admin" | "operador";
export type TipoConexao = "evolution" | "meta_cloud";
export type StatusInstancia = "conectado" | "desconectado";
export type StatusConversa = "aberta" | "em_atendimento" | "aguardando" | "encerrada";
export type RemetenteTipo = "cliente" | "operador";
export type StatusEntrega = "enviado" | "entregue" | "lido" | "falhou";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
  createdAt: string;
}

export interface Instancia {
  id: string;
  nome: string;
  numero: string;
  tipoConexao: TipoConexao;
  evolutionInstanceId: string | null;
  metaPhoneNumberId: string | null;
  metaWabaId: string | null;
  status: StatusInstancia;
  createdAt: string;
}

export interface Template {
  id: string;
  instanciaId: string;
  nome: string;
  metaTemplateId: string;
  idioma: string;
  createdAt: string;
}

export interface Contato {
  id: string;
  nome: string | null;
  numeroWhatsapp: string;
  createdAt: string;
}

export interface Mensagem {
  id: string;
  conversaId: string;
  remetenteTipo: RemetenteTipo;
  operadorId: string | null;
  conteudoTexto: string | null;
  tipoMidia: string | null;
  midiaPath: string | null;
  midiaDeleted: boolean;
  externalId: string | null;
  statusEntrega: StatusEntrega | null;
  timestamp: string;
  createdAt: string;
  operador?: { id: string; nome: string } | null;
}

export interface Etiqueta {
  id: string;
  nome: string;
  createdAt: string;
}

export interface Conversa {
  id: string;
  instanciaId: string;
  contatoId: string;
  status: StatusConversa;
  operadorId: string | null;
  lastMessageAt: string;
  createdAt: string;
  origemDisparo: boolean;
  respondida: boolean;
  contato: Contato;
  instancia: Pick<Instancia, "id" | "nome" | "numero" | "tipoConexao" | "status">;
  operador: { id: string; nome: string } | null;
  mensagens?: Mensagem[];
  etiquetas: { etiqueta: Etiqueta }[];
}

export interface ResumoMetricas {
  totalMensagens: number;
  atendimentosConcluidos: number;
  percentualNaoRespondidas: number;
  tempoMedioSegundos: number;
}

export type StatusCampanha = "rascunho" | "em_andamento" | "pausada" | "concluida";
export type StatusLigacao = "pendente" | "discando" | "atendeu" | "nao_atendeu" | "ocupado" | "erro";

export interface CampanhaNumero {
  id: string;
  campanhaId: string;
  numeroWhatsapp: string;
  nomeContato: string | null;
  statusLigacao: StatusLigacao;
  apertou1: boolean;
  hsmDisparado: boolean;
  twilioCallSid: string | null;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
}

export interface ResumoCampanha {
  total: number;
  pendente: number;
  discando: number;
  atendeu: number;
  naoAtendeu: number;
  ocupado: number;
  erro: number;
  convertido: number;
}

export interface Campanha {
  id: string;
  nome: string;
  audioPath: string;
  templateId: string;
  instanciaId: string;
  status: StatusCampanha;
  totalNumeros: number;
  criadoPor: string;
  createdAt: string;
  template: Template;
  instancia: Instancia;
  criador: { id: string; nome: string };
  numeros?: CampanhaNumero[];
  resumo?: ResumoCampanha;
}
