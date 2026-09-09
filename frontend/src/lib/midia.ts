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

// Baixa a foto sempre como JPG, mesmo que o cliente tenha mandado PNG/WEBP
// (sticker, print de tela) — a conversão acontece no backend (sharp).
export async function baixarFotoComoJpg(mensagemId: string) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${ORIGIN_URL}/api/midia/${mensagemId}?baixar=jpg`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error("Não foi possível baixar a foto");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${mensagemId}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
