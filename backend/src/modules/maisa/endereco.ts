// Endereço mandado em pedaços ("31320022", "Apto 102", "774"): leitura determinística de
// CEP, número e complemento de uma mensagem. Só vale quando a Maisa está esperando o
// endereço (ou o cliente corrige o endereço): fora disso, número solto não vira nada.

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface EnderecoLido {
  cep?: string;
  numero?: string;
  complemento?: string;
}

// CEP: 8 dígitos, com ou sem hífen ou ponto, sem dígito colado (não pega pedaço de CPF).
const CEP = /(?<![\d])(\d{2})\.?(\d{3})\s*-?\s*(\d{3})(?![\d])/;
// Complemento: apartamento, bloco, casa, lote, quadra, sala, torre, fundos, andar.
const COMPLEMENTO = /\b(ap(?:to|artamento|t)?|bl(?:oco)?|casa|lote|lt|quadra|qd|sala|torre|fundos|andar|cs)\b\.?\s*(?:n[º°o.]?\s*)?[\w-]{0,8}(?:\s*(?:bl(?:oco)?|torre|ap(?:to)?|casa)\b\.?\s*[\w-]{0,6})*/i;
const SEM_NUMERO = /\b(s\/n|sem numero|sem n[º°o]|nao tem numero)\b/;
const SEM_COMPLEMENTO = /\b(sem complemento|nao tem complemento|nao tenho complemento|nenhum complemento)\b/;

export function lerEndereco(texto: string): EnderecoLido {
  const out: EnderecoLido = {};
  let resto = texto;
  const cep = resto.match(CEP);
  if (cep) {
    out.cep = `${cep[1]}${cep[2]}${cep[3]}`;
    resto = resto.replace(cep[0], " ");
  }
  const t = norm(resto);
  if (SEM_COMPLEMENTO.test(t)) out.complemento = "";
  const comp = resto.match(COMPLEMENTO);
  if (comp && comp[0].trim().length > 2) {
    out.complemento = comp[0].replace(/\s+/g, " ").trim().slice(0, 40);
    resto = resto.replace(comp[0], " ");
  }
  if (SEM_NUMERO.test(norm(texto))) {
    out.numero = "SN";
    return out;
  }
  // Número da casa: "774", "nº 774", "número 774", "774A". Só em mensagem curta ou com o
  // rótulo de número: um número perdido no meio de um texto longo não é o da casa.
  const rotulado = resto.match(/\bn(?:umero|º|°|o)?\.?\s*(\d{1,5}[a-z]?)\b/i);
  const restoLimpo = norm(resto).replace(/\b(e|o|eh|e o|da casa|casa|numero|n)\b/g, " ").replace(/[^\w\s]/g, " ").trim();
  const solto = /^(\d{1,5}[a-z]?)$/i.exec(restoLimpo.replace(/\s+/g, " ").split(" ").filter(Boolean).join(" "));
  const curta = norm(resto).replace(/[^\w]/g, "").length <= 20;
  // Correção curta ("na verdade é 747", "errei, o número é 747"): um único número na frase.
  const corrige = /\b(errei|na verdade|o certo|correto|corrigindo|me enganei|desculpa)\b/.test(norm(resto));
  const numeros = norm(resto).match(/\b\d{1,5}[a-z]?\b/g) ?? [];
  if (rotulado) out.numero = rotulado[1].toUpperCase();
  else if (solto && curta) out.numero = solto[1].toUpperCase();
  else if (corrige && numeros.length === 1 && norm(resto).length <= 50) out.numero = numeros[0].toUpperCase();
  return out;
}

export const temAlgo = (e: EnderecoLido) => e.cep !== undefined || e.numero !== undefined || e.complemento !== undefined;
