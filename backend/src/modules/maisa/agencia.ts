// Agência para a Facta: 4 dígitos, sem o dígito verificador.
// O contracheque do SIAPE imprime a agência com o dígito no fim, completada com zeros até 6
// caracteres: "002836" é a agência 0283, dígito 6; "00250X" é 0250-X; "036005" é 3600-5.
// O cliente escreve "2893-2" ou "28932". Tirar só os zeros da esquerda ("002836" -> "2836")
// troca a agência: o último caractere é o dígito e sai.
export function agenciaSemDigito(bruto: string | null | undefined): string | null {
  const s = (bruto ?? "").toUpperCase().replace(/\s/g, "");
  if (!s) return null;
  let ag: string;
  const comTraco = s.match(/^(\d{1,5})[-.](\d|X)$/);
  if (comTraco) ag = comTraco[1];
  else {
    const so = s.replace(/[^0-9X]/g, "");
    if (/X/.test(so.slice(0, -1))) return null;
    ag = so.length >= 5 || so.endsWith("X") ? so.slice(0, -1) : so;
  }
  if (!/^\d+$/.test(ag)) return null;
  // Sobrou mais de 4: só vale se o excesso for zero de preenchimento.
  if (ag.length > 4) {
    if (!/^0+$/.test(ag.slice(0, ag.length - 4))) return null;
    ag = ag.slice(-4);
  }
  return ag.length >= 3 ? ag.padStart(4, "0") : null;
}
