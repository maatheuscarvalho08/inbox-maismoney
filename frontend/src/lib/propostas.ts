import type { StatusProposta } from "../types/api";

export const LABEL_STATUS_PROPOSTA: Record<StatusProposta, string> = {
  digitada: "Digitada",
  em_analise: "Em análise",
  aprovada: "Aprovada",
  paga: "Paga",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

export const OPCOES_STATUS_PROPOSTA = Object.entries(LABEL_STATUS_PROPOSTA).map(([value, label]) => ({ value, label }));

export function formatarCentavos(centavos: number) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Aceita o jeito que as pessoas digitam: "1500", "1.500,50" ou "1500.50".
export function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d.,]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null;
}
