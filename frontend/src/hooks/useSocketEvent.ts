import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";

export function useSocketEvent<T>(evento: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(evento, listener);
    return () => {
      socket.off(evento, listener);
    };
  }, [evento]);
}
