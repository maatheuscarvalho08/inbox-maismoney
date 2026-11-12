import { normalizar } from "./classificador.js";

// Perguntas que a Maisa responde sozinha. Fora daqui, ela passa para um atendente.
// Revisar com o dono antes de ligar em produção: só entra o que a empresa confirma.
const FAQ: { padrao: RegExp; resposta: string }[] = [
  {
    // "A Facta é confiável?": fala da Facta, não da Mais Money. Vem antes da regra geral.
    padrao: /\bfacta\b.{0,25}(confiavel|seria|segura|banco mesmo|e banco|existe)|(confiavel|confiar).{0,20}\bfacta\b/,
    resposta:
      "A Facta Financeira é o banco que faz o contrato. Você pode conferir direto com ela pelo SAC 0800 942 0462, que também atende pelo WhatsApp. " +
      "A Mais Money é a correspondente que cuida da sua proposta: CNPJ 45.027.472/0001-76, Instagram @maismoneyrj.",
  },
  {
    // Sem "verdade" ("na verdade sou siape") e sem "seguro" solto ("tem seguro?", "seguro desemprego").
    padrao: /\b(golpe|confiavel|confiar|seguranca|cnpj|empresa seria|voces sao serios|e serio|e de verdade|e verdade isso)\b|\b(e|eh|sera que e) seguro\b|\bseguro (mandar|passar|enviar)\b/,
    resposta:
      "A Mais Money é uma promotora de crédito, correspondente bancário, com CNPJ 45.027.472/0001-76, no Rio de Janeiro. " +
      "Você pode conferir a gente no Instagram @maismoneyrj.",
  },
  {
    // SAC tirado do roteiro operacional SIAPE da Facta (atende também por WhatsApp).
    padrao: /\b(contato|telefone|numero|whats|sac)\b.*\bfacta\b|\bfacta\b.*\b(contato|telefone|numero|whats|sac)\b/,
    resposta:
      "Claro! O SAC da Facta Financeira, o banco do seu contrato, é o 0800 942 0462, que também atende pelo WhatsApp. " +
      "Pode ligar para conferir. E a Mais Money é a correspondente que cuida da sua proposta: CNPJ 45.027.472/0001-76, Instagram @maismoneyrj.",
  },
  {
    padrao: /\b(robo|bot|inteligencia artificial|e uma pessoa|e humano|e gente)\b/,
    resposta: "Eu sou a Maisa, assistente virtual da Mais Money. Se preferir falar com uma pessoa, é só pedir.",
  },
  {
    padrao: /\b(o que e|como funciona)\b.*\bconsignado\b/,
    resposta:
      "No consignado, as parcelas são descontadas direto do seu salário. Por isso as taxas costumam ser menores que as de um empréstimo comum.",
  },
];

export function buscarFaq(texto: string): string | null {
  const t = normalizar(texto);
  return FAQ.find((f) => f.padrao.test(t))?.resposta ?? null;
}
