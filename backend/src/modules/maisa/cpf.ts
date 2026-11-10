// Acha um CPF no texto do cliente, com ou sem pontuação.
export function extrairCpf(texto: string): string | null {
  const achado = texto.match(/\d{3}\.?\s?\d{3}\.?\s?\d{3}\s?-?\s?\d{2}/);
  if (!achado) return null;
  return achado[0].replace(/\D/g, "");
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
