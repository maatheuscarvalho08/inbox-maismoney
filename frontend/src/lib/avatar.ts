import { ORIGIN_URL } from "./api";

// Foto de operador é servida sem exigir Authorization (ver usuarios.routes.ts) —
// <img src> não manda esse header, mesma lógica já usada pro áudio de campanha.
export function urlFotoOperador(fotoPath: string | null | undefined, usuarioId: string | undefined) {
  if (!fotoPath || !usuarioId) return null;
  return `${ORIGIN_URL}/api/usuarios/${usuarioId}/foto`;
}
