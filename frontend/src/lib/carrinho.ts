import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useRecargaAgrupada } from "../hooks/useRecargaAgrupada";
import type { Conversa } from "../types/api";

// Quantos clientes estão no Carrinho agora. Atualiza sozinho quando uma conversa muda.
export function useCarrinho() {
  const [total, setTotal] = useState(0);
  const [ultimo, setUltimo] = useState<Conversa | null>(null);

  const carregar = useCallback(() => {
    api
      // limite=0: só a contagem, sem a lista.
      .get<{ contagens: { carrinho?: number } }>("/conversas?aba=carrinho&limite=0")
      .then((r) => setTotal(r.contagens.carrinho ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => carregar(), [carregar]);
  const recarregar = useRecargaAgrupada(carregar, 3000);
  useSocketEvent("conversa:atualizada", recarregar);
  useSocketEvent<Conversa>("carrinho:novo", (c) => {
    setUltimo(c);
    carregar();
  });

  return { total, ultimo, limparUltimo: () => setUltimo(null) };
}
