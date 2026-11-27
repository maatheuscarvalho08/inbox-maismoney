import { useEffect, useState } from "react";
import { api } from "./api";

export interface ConversaEsperando {
  id: string;
  nome: string | null;
  operador: string | null;
  operadorId: string | null;
  desde: string;
}

interface Esperando {
  total: number;
  minhas: number;
  conversas: ConversaEsperando[];
}

const VAZIO: Esperando = { total: 0, minhas: 0, conversas: [] };

// Horário da equipe, em Brasília: segunda a sexta das 9h às 18h, sábado das 9h às 13h.
function horarioDaEquipe(agora = new Date()) {
  const b = new Date(agora.getTime() - 3 * 60 * 60_000);
  const dia = b.getUTCDay();
  const h = b.getUTCHours();
  if (dia === 0) return false;
  if (dia === 6) return h >= 9 && h < 13;
  return h >= 9 && h < 18;
}

// Clientes esperando resposta da equipe há mais de 30 minutos. Só conta no horário da equipe.
export function useEsperando() {
  const [dados, setDados] = useState<Esperando>(VAZIO);

  useEffect(() => {
    const carregar = () => {
      if (!horarioDaEquipe()) return setDados(VAZIO);
      api
        .get<Esperando>("/conversas/esperando")
        .then(setDados)
        .catch(() => {});
    };
    carregar();
    const t = setInterval(carregar, 2 * 60_000);
    return () => clearInterval(t);
  }, []);

  return dados;
}

export function esperaTexto(desde: string) {
  const min = Math.floor((Date.now() - new Date(desde).getTime()) / 60_000);
  return min < 120 ? `${min} min` : `${Math.floor(min / 60)} h`;
}
