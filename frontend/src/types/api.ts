export type Role = "admin" | "operador";
export type TipoConexao = "evolution" | "meta_cloud";
export type StatusInstancia = "conectado" | "desconectado";
export type StatusConversa = "aberta" | "em_atendimento" | "aguardando" | "encerrada";
export type RemetenteTipo = "cliente" | "operador";

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
