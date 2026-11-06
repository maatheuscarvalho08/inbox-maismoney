import type { Convenio, EtapaFunil } from "../types/api";

export const LABEL_CONVENIO: Record<Convenio, string> = {
  inss: "INSS",
  clt: "CLT",
  siape: "SIAPE",
  servidor_prefeitura: "Servidor Prefeitura",
  marinha: "Marinha",
  militar: "Militar",
  conta_de_luz: "Conta de Luz",
  loas: "LOAS",
  credito_pessoal: "Crédito Pessoal",
  fgts: "FGTS",
};

export const LABEL_ETAPA: Record<EtapaFunil, string> = {
  lead: "Leads",
  dados_coletados: "Dados coletados",
  simulacao: "Simulações",
  simulacao_com_saldo: "Simulações com saldo",
  proposta_digitada: "Propostas digitadas",
  proposta_paga: "Propostas pagas",
};

export const OPCOES_CONVENIO = Object.entries(LABEL_CONVENIO).map(([value, label]) => ({ value, label }));
export const OPCOES_ETAPA = Object.entries(LABEL_ETAPA).map(([value, label]) => ({ value, label }));
