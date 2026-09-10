// O WhatsApp entrega o número no remoteJid às vezes no formato antigo de 12
// dígitos (55 + DDD + 8 dígitos), sem o "9" que virou obrigatório em celular
// no Brasil desde 2016. Isso é só pra exibição — o envio continua usando o
// número cru salvo, que o WhatsApp roteia certo dos dois jeitos.
export function formatarTelefone(numero: string): string {
  const d = numero.replace(/\D/g, "");

  // 55 + DDD (2) + 8 dígitos, e o local começa com 6-9 (faixa de celular) →
  // falta o 9. Fixo (começa com 2-5) fica como está.
  let nacional = d;
  if (d.startsWith("55") && d.length === 12 && /^[6-9]/.test(d.slice(4))) {
    nacional = `${d.slice(0, 4)}9${d.slice(4)}`;
  }

  // 55 + DDD + 9 dígitos → +55 (DD) 9XXXX-XXXX
  if (nacional.startsWith("55") && nacional.length === 13) {
    const ddd = nacional.slice(2, 4);
    const parte1 = nacional.slice(4, 9);
    const parte2 = nacional.slice(9);
    return `+55 (${ddd}) ${parte1}-${parte2}`;
  }

  // 55 + DDD + 8 dígitos (fixo) → +55 (DD) XXXX-XXXX
  if (nacional.startsWith("55") && nacional.length === 12) {
    const ddd = nacional.slice(2, 4);
    return `+55 (${ddd}) ${nacional.slice(4, 8)}-${nacional.slice(8)}`;
  }

  return numero;
}
