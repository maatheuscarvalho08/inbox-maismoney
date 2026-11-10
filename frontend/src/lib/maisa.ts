import { useEffect, useState } from "react";
import { api } from "./api";
import type { Conversa } from "../types/api";

export interface MaisaConfig {
  modo: "desligado" | "copiloto" | "automatico";
  simulador: boolean;
  banco: "simulado" | "facta" | "nenhum";
}

// Muda só com restart do backend, então uma busca por sessão basta.
let pedido: Promise<MaisaConfig> | null = null;

export function useMaisaConfig() {
  const [config, setConfig] = useState<MaisaConfig | null>(null);
  useEffect(() => {
    pedido ??= api.get<MaisaConfig>("/maisa/config").catch((err) => {
      pedido = null;
      throw err;
    });
    pedido.then(setConfig).catch(() => {});
  }, []);
  return config;
}

// Mesmo prefixo do backend (maisa.service.ts). Conversa de teste nunca vai para o WhatsApp.
export const PREFIXO_NUMERO_TESTE = "5500000";

// O roteiro da Maisa, na ordem. Espelha as etapas de backend/src/modules/maisa/fluxo.ts.
export const ETAPAS_FLUXO = [
  {
    id: "convenio",
    nome: "Vínculo",
    oQueFaz: "Apresenta todos os produtos. CLT, INSS e SIAPE seguem com ela; os outros vão para a equipe.",
  },
  {
    id: "dados",
    nome: "Dados",
    oQueFaz: "CLT: CPF e nome completo. INSS e SIAPE: CPF e data de nascimento.",
  },
  {
    id: "autorizacao",
    nome: "Autorização",
    oQueFaz: "CLT: a Facta manda um link e ela espera o cliente autorizar. INSS e SIAPE: ela pede o extrato do Meu INSS ou o contracheque e calcula a margem.",
  },
  {
    id: "oferta",
    nome: "Oferta",
    oQueFaz: "Mostra até quanto o cliente pode receber e pergunta se quer seguir.",
  },
  {
    id: "contrato",
    nome: "Contrato",
    oQueFaz: "INSS e SIAPE: pede RG ou CNH, endereço e o resto do cadastro, mostra o resumo e faz a proposta na Facta. A Facta manda o link de assinatura.",
  },
] as const;

// Etapa do backend para a posição no roteiro. "inicio" ainda é a primeira pergunta.
const POSICAO: Record<string, number> = {
  inicio: 0,
  convenio: 0,
  cpf: 1,
  nome: 1,
  consentimento: 2,
  aguardando: 2,
  nascimento: 1,
  extrato: 2,
  oferta: 3,
  coleta: 4,
  confirmacao: 4,
};

export function indiceEtapa(etapa: string | undefined) {
  return POSICAO[etapa ?? "inicio"] ?? 0;
}

export function nomeEtapa(etapa: string | undefined) {
  return ETAPAS_FLUXO[indiceEtapa(etapa)].nome;
}

interface Saida {
  titulo: string;
  proximoPasso: string;
  // Cliente pronto para fechar: merece atenção primeiro.
  quente?: boolean;
}

// Por que ela passou a conversa e o que o atendente faz agora.
export const SAIDAS_MAISA: Record<string, Saida> = {
  aceitou: { titulo: "Aceitou a oferta", proximoPasso: "Finalizar a proposta com o cliente.", quente: true },
  recusou: { titulo: "Recusou a oferta", proximoPasso: "Perguntar o motivo e ver outra condição." },
  sem_saldo: { titulo: "Sem saldo no banco", proximoPasso: "Ver outros bancos ou outro convênio." },
  erro_banco: { titulo: "Banco não respondeu", proximoPasso: "Fazer a simulação direto no banco." },
  convenio: { titulo: "Convênio da equipe", proximoPasso: "Atender pelo convênio marcado na conversa." },
  servidor: { titulo: "Servidor público", proximoPasso: "Descobrir o órgão e simular." },
  outro: { titulo: "Vínculo fora da lista", proximoPasso: "Entender o vínculo do cliente." },
  humano: { titulo: "Pediu atendente", proximoPasso: "Responder o cliente." },
  duvida: { titulo: "Dúvida sem resposta pronta", proximoPasso: "Responder a dúvida do cliente." },
  acompanhar_proposta: { titulo: "Quer saber da proposta", proximoPasso: "Localizar a proposta e passar o status." },
  nao_entendeu: { titulo: "A Maisa não entendeu", proximoPasso: "Ler as últimas mensagens e continuar." },
  midia: { titulo: "Mandou um arquivo", proximoPasso: "Abrir o arquivo que o cliente enviou." },
  recusou_cpf: { titulo: "Não quis passar o CPF", proximoPasso: "Explicar por que o CPF é necessário." },
  nao_autorizou: { titulo: "Não autorizou a consulta", proximoPasso: "Explicar como a consulta funciona." },
  link_nao_autorizado: { titulo: "Não autorizou o link", proximoPasso: "Ajudar o cliente a abrir o link da Facta." },
  carrinho: { titulo: "Não respondeu a oferta", proximoPasso: "Ligar ou mandar mensagem para tentar fechar.", quente: true },
  telefone_outro_cpf: { titulo: "Celular de outro CPF", proximoPasso: "Pedir outro celular ao cliente." },
  contrato_enviado: { titulo: "Contrato feito na Facta", proximoPasso: "Acompanhar a assinatura do link até o pagamento.", quente: true },
  erro_digitacao: { titulo: "Contrato não entrou na Facta", proximoPasso: "Digitar a proposta direto na Facta.", quente: true },
  dados_contrato: { titulo: "Parou no cadastro do contrato", proximoPasso: "Terminar o cadastro com o cliente e digitar.", quente: true },
  extrato_invalido: { titulo: "Extrato não deu para ler", proximoPasso: "Pedir o PDF do documento e analisar o extrato." },
  sem_extrato: { titulo: "Não mandou o extrato", proximoPasso: "Ajudar o cliente a tirar o extrato ou o contracheque." },
};

// Ordem em que as saídas aparecem no guia.
export const SAIDAS_NO_GUIA = [
  "contrato_enviado",
  "aceitou",
  "erro_digitacao",
  "dados_contrato",
  "carrinho",
  "recusou",
  "sem_saldo",
  "erro_banco",
  "convenio",
  "servidor",
  "outro",
  "humano",
  "duvida",
  "acompanhar_proposta",
  "link_nao_autorizado",
  "telefone_outro_cpf",
  "extrato_invalido",
  "sem_extrato",
  "midia",
  "nao_entendeu",
  "recusou_cpf",
  "nao_autorizou",
] as const;

// Saída da Maisa numa conversa que ela já passou para a equipe. Conversas antigas,
// gravadas antes do campo "saida" existir, caem num texto genérico com o motivo.
export function saidaDaConversa(conversa: Pick<Conversa, "comMaisa" | "maisaEstado">): Saida | null {
  const estado = conversa.maisaEstado;
  if (conversa.comMaisa || estado?.etapa !== "finalizada") return null;
  if (estado.saida && SAIDAS_MAISA[estado.saida]) return SAIDAS_MAISA[estado.saida];
  if (!estado.motivoTransferencia) return null;
  const motivo = estado.motivoTransferencia;
  return { titulo: motivo[0].toUpperCase() + motivo.slice(1), proximoPasso:"Ler a conversa e continuar o atendimento." };
}
