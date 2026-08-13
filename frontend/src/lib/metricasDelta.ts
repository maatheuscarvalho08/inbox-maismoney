export function calcularDelta(serie: number[]) {
  if (serie.length < 2) return null;
  const hoje = serie[serie.length - 1];
  const ontem = serie[serie.length - 2];
  const diff = hoje - ontem;
  return { diff, direction: (diff >= 0 ? "up" : "down") as "up" | "down" };
}
