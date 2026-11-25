import { useEffect, useState } from "react";
import { api } from "./api";
import { useSocketEvent } from "../hooks/useSocketEvent";

export interface AlertaSistema {
  id: string;
  titulo: string;
  detalhe: string;
  desde: string;
}

// Alertas do sistema (Maisa, OpenAI, Facta, follow-ups). O backend só manda para quem está em ALERTAS_EMAILS;
// para os demais a lista vem sempre vazia.
export function useAlertasSistema() {
  const [alertas, setAlertas] = useState<AlertaSistema[]>([]);

  useEffect(() => {
    const carregar = () =>
      api
        .get<{ alertas: AlertaSistema[] }>("/alertas")
        .then((r) => setAlertas(r.alertas))
        .catch(() => {});
    carregar();
    // Reconexão perdida ou aba dormindo: confere de novo a cada 5 minutos.
    const t = setInterval(carregar, 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  useSocketEvent<AlertaSistema[]>("sistema:alertas", setAlertas);

  return alertas;
}
