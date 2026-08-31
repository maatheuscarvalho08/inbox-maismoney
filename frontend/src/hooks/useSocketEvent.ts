import { useEffect, useRef, useState } from "react";
import { getSocket, onSocketReady } from "../lib/socket";

export function useSocketEvent<T>(evento: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Se o componente monta antes do socket existir (sessão restaurada, timing de
  // carregamento), esse contador força o efeito abaixo a tentar de novo assim que
  // conectarSocket() rodar — sem isso o componente ficava sem nenhum evento em
  // tempo real até um F5 remontar tudo do zero.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (getSocket()) return;
    return onSocketReady(() => setTentativa((n) => n + 1));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(evento, listener);
    return () => {
      socket.off(evento, listener);
    };
  }, [evento, tentativa]);
}
