export function tempoRelativo(data: string | Date) {
  const alvo = typeof data === "string" ? new Date(data) : data;
  const diffMs = Date.now() - alvo.getTime();
  const min = Math.floor(diffMs / 60_000);

  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;

  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas}h`;

  const dias = Math.floor(horas / 24);
  return `${dias}d`;
}

export function formatarSegundos(segundos: number) {
  const min = Math.floor(segundos / 60);
  const seg = Math.round(segundos % 60);
  return `${min}m ${seg.toString().padStart(2, "0")}s`;
}
