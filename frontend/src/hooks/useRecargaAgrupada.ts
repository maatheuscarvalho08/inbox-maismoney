import { useCallback, useEffect, useRef } from "react";

// Junta uma rajada de eventos ao vivo numa recarga só. Com a Maisa respondendo,
// chegam várias mensagens por minuto; recarregar a lista a cada uma deixava tudo lento.
// No máximo uma recarga por intervalo, e a última sempre acontece.
export function useRecargaAgrupada(recarregar: () => void, intervaloMs = 1500) {
  const recarregarRef = useRef(recarregar);
  recarregarRef.current = recarregar;
  const agendada = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (agendada.current) window.clearTimeout(agendada.current);
    },
    [],
  );

  return useCallback(() => {
    if (agendada.current) return;
    agendada.current = window.setTimeout(() => {
      agendada.current = null;
      recarregarRef.current();
    }, intervaloMs);
  }, [intervaloMs]);
}
