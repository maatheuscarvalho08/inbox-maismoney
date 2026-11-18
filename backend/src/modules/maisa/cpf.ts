// CPF no texto do cliente: extração, normalização e validação determinísticas. O modelo
// nunca é a única fonte: tudo o que vira CPF passa por aqui e pelos dígitos verificadores.

// Separadores aceitos entre os grupos: ponto, espaço, hífen e os traços que o teclado do
// celular troca sozinho (–, —, ‑, −). Barra não: "10/12/1966" é data, nunca CPF.
const SEP = "[.\\s\\-\\u2010-\\u2015\\u2212]?";
// 3-3-3-2 com ou sem separadores, sem dígito colado antes ou depois: os 11 primeiros dígitos
// de um número de contrato maior (14 dígitos) nunca viram CPF.
const PADRAO_CPF = new RegExp(`(?<!\\d)\\d{3}\\s*${SEP}\\s*\\d{3}\\s*${SEP}\\s*\\d{3}\\s*${SEP}\\s*\\d{2}(?!\\d)`, "g");

const soDigitos = (s: string) => s.replace(/\D/g, "");

// Trechos com cara de CPF, na ordem em que aparecem.
function candidatos(texto: string): { trecho: string; cpf: string }[] {
  return [...texto.matchAll(PADRAO_CPF)].map((m) => ({ trecho: m[0], cpf: soDigitos(m[0]) }));
}

// Acha um CPF no texto, com ou sem pontuação. Com mais de um candidato, prefere o válido.
export function extrairCpf(texto: string): string | null {
  const c = candidatos(texto);
  return (c.find((x) => cpfValido(x.cpf)) ?? c[0])?.cpf ?? null;
}

// O trecho do texto que foi lido como CPF (para tirar antes de procurar a data).
export function trechoDoCpf(texto: string): string | null {
  const c = candidatos(texto);
  return (c.find((x) => cpfValido(x.cpf)) ?? c[0])?.trecho ?? null;
}

// Número com cara de CPF, mas com dígitos a mais ou a menos (9, 10, 12 ou 13): devolve
// quantos dígitos tem, para a Maisa dizer isso ao cliente em vez de "não entendi".
export function cpfComTamanhoErrado(texto: string): number | null {
  if (candidatos(texto).length) return null;
  for (const bloco of texto.match(/\d[\d.\s\-‐-―−]*\d/g) ?? []) {
    const n = soDigitos(bloco).length;
    if (n >= 9 && n <= 13 && n !== 11) return n;
  }
  return null;
}

export type LeituraCpf =
  | { tipo: "valido"; cpf: string }
  | { tipo: "invalido"; cpf: string }
  | { tipo: "tamanho_errado"; digitos: number }
  | { tipo: "ausente" };

// A normalização completa: extrai, tira pontuação, confere os 11 dígitos e os verificadores.
export function normalizarCpf(texto: string): LeituraCpf {
  const cpf = extrairCpf(texto);
  if (cpf) return cpfValido(cpf) ? { tipo: "valido", cpf } : { tipo: "invalido", cpf };
  const n = cpfComTamanhoErrado(texto);
  return n ? { tipo: "tamanho_errado", digitos: n } : { tipo: "ausente" };
}

// Confere os dois dígitos verificadores. Sequências repetidas passam no cálculo,
// mas não são CPF de verdade.
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

// O que a Maisa e os logs podem mostrar.
export function mascararCpf(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.***-**`;
}
