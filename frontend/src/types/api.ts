export type Role = "admin" | "operador";
export type TipoConexao = "evolution" | "meta_cloud";
export type StatusInstancia = "conectado" | "desconectado";
export type StatusConversa = "aberta" | "em_atendimento" | "aguardando" | "encerrada";
export type RemetenteTipo = "cliente" | "operador" | "maisa" | "nota";
export type Convenio = "inss" | "clt" | "siape" | "servidor_prefeitura" | "marinha" | "militar" | "conta_de_luz" | "loas" | "credito_pessoal" | "fgts";
export type EtapaFunil = "lead" | "dados_coletados" | "simulacao" | "simulacao_com_saldo" | "proposta_digitada" | "proposta_paga";
export type ResultadoSimulacao = "com_saldo" | "sem_saldo" | "erro";
export type StatusProposta = "digitada" | "em_analise" | "aprovada" | "paga" | "recusada" | "cancelada";
export type StatusEntrega = "enviado" | "entregue" | "lido" | "falhou";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
  ativo: boolean;
  fotoPath: string | null;
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
  maisaAtiva: boolean;
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
  cpf: string | null;
  numeroWhatsapp: string;
  fotoUrl: string | null;
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
  erroEntrega?: string | null;
  // Quantas vezes a Maisa tentou entregar. Reenvio usa a mesma mensagem.
  tentativasEntrega?: number;
  // Resumo da análise do extrato guardada (da Maisa ou da equipe).
  analiseResumo?: string | null;
  editadaEm: string | null;
  respondeA?: { id: string; conteudoTexto: string | null; tipoMidia: string | null; remetenteTipo: RemetenteTipo } | null;
  timestamp: string;
  createdAt: string;
  operador?: { id: string; nome: string; fotoPath: string | null } | null;
}

export interface Simulacao {
  id: string;
  conversaId: string;
  banco: string;
  convenio: Convenio | null;
  resultado: ResultadoSimulacao;
  valorCentavos: number | null;
  motivo: string | null;
  createdAt: string;
  conversa: { id: string; contato: { id: string; nome: string | null; numeroWhatsapp: string } };
  operador: { id: string; nome: string } | null;
}

export interface Proposta {
  id: string;
  conversaId: string;
  banco: string;
  convenio: Convenio | null;
  valorCentavos: number;
  parcelaCentavos: number | null;
  prazoMeses: number | null;
  numeroContrato: string | null;
  status: StatusProposta;
  motivoRecusa: string | null;
  createdAt: string;
  conversa: { id: string; contato: { id: string; nome: string | null; numeroWhatsapp: string } };
  operador: { id: string; nome: string } | null;
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
  comMaisa: boolean;
  convenio: Convenio | null;
  etapaFunil: EtapaFunil | null;
  // Onde a Maisa está no fluxo e, se ela passou a conversa para a equipe, por quê.
  maisaEstado?: {
    etapa: string;
    tentativas: number;
    motivoTransferencia?: string;
    paradaEm?: string;
    saida?: string;
    oferta?: { banco: string; valorCentavos: number; parcelaCentavos: number; prazoMeses: number };
    ofertaEm?: string;
  } | null;
  // Ofertada e sem resposta por 24h: está no Carrinho.
  carrinhoEm?: string | null;
  contato: Contato;
  instancia: Pick<Instancia, "id" | "nome" | "numero" | "tipoConexao" | "status" | "maisaAtiva">;
  operador: { id: string; nome: string; fotoPath: string | null } | null;
  mensagens?: Mensagem[];
  etiquetas: { etiqueta: Etiqueta }[];
  // Ids de quem da equipe já abriu essa conversa desde a última mensagem do
  // cliente — zerada assim que chega mensagem nova dele.
  visualizacoes: { usuarioId: string }[];
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
