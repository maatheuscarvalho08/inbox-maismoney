import type { ResultadoSimulacao } from "../types/api";

export const LABEL_RESULTADO: Record<ResultadoSimulacao, string> = {
  com_saldo: "Com saldo",
  sem_saldo: "Sem saldo",
  erro: "Erro no banco",
};

export const OPCOES_RESULTADO = Object.entries(LABEL_RESULTADO).map(([value, label]) => ({ value, label }));
