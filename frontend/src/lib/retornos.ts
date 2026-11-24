import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useRecargaAgrupada } from "../hooks/useRecargaAgrupada";
import type { Conversa } from "../types/api";

// Quantos retornos já venceram: o dia combinado com o cliente chegou e ninguém chamou ainda.
export function useRetornos() {
  const [total, setTotal] = useState(0);
  const [ultimo, setUltimo] = useState<Conversa | null>(null);

  const carregar = useCallback(() => {
    api
      .get<{ contagens: { retornos?: number } }>("/conversas?aba=retornos&limite=0")
      .then((r) => setTotal(r.contagens.retornos ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => carregar(), [carregar]);
  // Confere a cada 30 min: o dia pode chegar com a tela aberta.
  useEffect(() => {
    const t = setInterval(carregar, 30 * 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  const recarregar = useRecargaAgrupada(carregar, 3000);
  useSocketEvent("conversa:atualizada", recarregar);
  useSocketEvent<Conversa>("retorno:vencido", (c) => {
    setUltimo(c);
    carregar();
  });

  return { total, ultimo, limparUltimo: () => setUltimo(null) };
}

export const dataDoRetorno = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
export const retornoVencido = (iso: string) => new Date(iso).getTime() <= Date.now();
