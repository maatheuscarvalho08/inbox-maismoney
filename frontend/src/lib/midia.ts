import { ORIGIN_URL } from "./api";

export async function carregarMidia(mensagemId: string): Promise<string> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${ORIGIN_URL}/api/midia/${mensagemId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error("Não foi possível carregar a mídia");
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
