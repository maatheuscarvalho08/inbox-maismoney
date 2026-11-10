import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { Conversa } from "../types/api";

// Quantos clientes estão no Carrinho agora. Atualiza sozinho quando uma conversa muda.
export function useCarrinho() {
  const [total, setTotal] = useState(0);
  const [ultimo, setUltimo] = useState<Conversa | null>(null);

  const carregar = useCallback(() => {
    api
      .get<{ contagens: { carrinho?: number } }>("/conversas?aba=carrinho")
      .then((r) => setTotal(r.contagens.carrinho ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => carregar(), [carregar]);
  useSocketEvent("conversa:atualizada", carregar);
  useSocketEvent<Conversa>("carrinho:novo", (c) => {
    setUltimo(c);
    carregar();
  });

  return { total, ultimo, limparUltimo: () => setUltimo(null) };
}
