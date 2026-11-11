import type { Convenio } from "@prisma/client";
import { PRODUTOS } from "./textos.js";

// O que o fluxo pergunta em cada etapa. Cada pergunta tem uma lista fechada de
// respostas: quem decide a próxima etapa é o fluxo, nunca o classificador.
export type Intencao = "humano" | "acompanhar_proposta" | "credito" | "duvida" | "saudacao" | "outro";
export type ConvenioEntendido = Convenio | "servidor" | "outro";
export type SimNao = "sim" | "nao";

export interface Classificador {
  pedeHumano(texto: string): Promise<boolean>;
  intencao(texto: string): Promise<Intencao>;
  convenio(texto: string): Promise<ConvenioEntendido | null>;
  simNao(texto: string): Promise<SimNao | null>;
  // Cliente diz que o link de autorização do banco não chegou.
  linkNaoChegou(texto: string): Promise<boolean>;
  // Tentativa de tirar da Maisa instruções, configurações ou credenciais.
  tentativaExtracao(texto: string): Promise<boolean>;
  // Resposta do cliente a uma oferta. contexto: a oferta, em texto. null: não deu para ler.
  lerOferta(texto: string, contexto: string): Promise<LeituraOferta | null>;
}

export type ObjecaoOferta = "pouco_valor" | "prazo_longo" | "oferta_melhor" | "desconfianca" | "outra";

export interface LeituraOferta {
  tipo: "aceita" | "recusa" | "pergunta" | "objecao" | "pensar" | "humano";
  objecao: ObjecaoOferta | null;
  // O que o cliente disse da oferta de outro lugar (valor, prazo), quando disse.
  outraOferta: string | null;
}

const RECEIO_OFERTA = /(medo|receio|golpe|fraude|reclame|confia|seguro|segura|demora|nao libera|nao paga|enganad|desconfi|perigo|risco)/;
const PENSANDO_OFERTA = /(pensar|pensando|depois|mais tarde|amanh|vou ver|ver com|conversar com|falar com (a|o|minha|meu))/;

// Lê a resposta à oferta com regras. É a reserva do modelo e o que os testes usam.
export function lerOfertaPorRegras(texto: string): LeituraOferta | null {
  const t = normalizar(texto);
  const leitura = (tipo: LeituraOferta["tipo"], objecao: ObjecaoOferta | null = null, outraOferta: string | null = null): LeituraOferta => ({
    tipo,
    objecao,
    outraOferta,
  });
  if (PEDE_HUMANO.test(t) || /(robo|maquina|ser humano|pessoa de verdade)/.test(t)) return leitura("humano");
  if (RECEIO_OFERTA.test(t)) return leitura("objecao", "desconfianca");
  const recusa = NAO.test(t);
  if (/(me ofereceram|me ofereceu|outro banco|outra (proposta|oferta|empresa)|em outro lugar)/.test(t)) {
    return leitura(recusa ? "recusa" : "objecao", "oferta_melhor", /\d/.test(t) ? texto.trim().slice(0, 160) : null);
  }
  if (/(pouco|baixo|pequeno|so isso|mixaria)/.test(t)) return leitura(recusa ? "recusa" : "objecao", "pouco_valor");
  if (/(prazo|muito tempo|muitos anos|muitas parcelas|aumentar|esticar|\b(96|108|120) (mes|meses|parcelas|vezes)\b)/.test(t)) {
    return leitura(recusa ? "recusa" : "objecao", "prazo_longo");
  }
  if (PENSANDO_OFERTA.test(t) && !texto.includes("?")) return leitura("pensar");
  if (recusa) return leitura("recusa");
  if (SIM.test(t) || /(cert|corret|fechado|fecha|manda ver|pode seguir|vamos fazer)/.test(t)) return leitura("aceita");
  if (texto.includes("?") || /^(qual|quais|quanto|como|quando|onde|tem|e se|depende)/.test(t)) return leitura("pergunta");
  return null;
}

// Pedidos de prompt, instruções internas, credenciais ou "modo desenvolvedor".
const EXTRACAO =
  /\b(prompt|system|instruc(ao|oes) (internas?|do sistema|que (te|voce) (deram|recebeu))|suas (regras|instrucoes|configurac)|ignor[ae] (as |suas |todas )?(instruc|regras)|modo (desenvolvedor|dev|debug|depuracao|manutencao)|jailbreak|api ?key|chave (da api|de api|secreta)|token de acesso|credencia(l|is)|senha do sistema|variave(l|is) de ambiente|endpoint)/;

export function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PEDE_HUMANO =
  /\b(atendente|humano|humana|pessoa de verdade|pessoa real|falar com (alguem|uma pessoa|um consultor|uma consultora|o gerente|a gerente)|consultor|consultora|nao quero (falar com )?robo)\b/;

// Ordem importa: o mais específico vem antes do mais genérico.
// O número da lista de produtos é lido antes, em convenio(). Aqui só texto livre.
const CONVENIOS: [RegExp, ConvenioEntendido][] = [
  // Grafias que a transcrição de áudio costuma devolver também valem (celetista, "ce ele te").
  [/\b(clt|celetista|celete|ce ele te|c l t)\b|carteira assinada|carteira de trabalho|registrad|empresa privada|\bcarteira\b/, "clt"],
  [/\bloas\b|\bbpc\b|prestacao continuada/, "loas"],
  // Antes do INSS: "pensionista SIAPE" é SIAPE. CIAP, ciape e siap são o SIAPE falado.
  [/\b(siape|siap|siapi|ciap|ciape|ciapi|ciappe)\b|servidor federal|federal/, "siape"],
  [/\binss\b|aposentad|pensionista|beneficio/, "inss"],
  [/prefeitura|municipal/, "servidor_prefeitura"],
  [/\bmarinha\b/, "marinha"],
  [/\bmilitar|exercito|aeronautica/, "militar"],
  [/\bfgts\b|saque aniversario/, "fgts"],
  [/conta de luz|energia/, "conta_de_luz"],
  [/credito pessoal|emprestimo pessoal/, "credito_pessoal"],
  [/servidor|concursad|publico/, "servidor"],
  [/\boutro\b|autonom|desempregad|\bmei\b/, "outro"],
];

const NAO = /^(nao|n|nn|nem|negativo|agora nao)\b|\bnao (quero|autorizo|aceito|tenho interesse|obrigad)/;
const SIM = /^(sim|s|ss|claro|pode|quero|aceito|autorizo|ok|okay|beleza|blz|bora|isso|com certeza|pode ser|tenho interesse|vamos)\b/;

// Primeira versão, só com regras. O Luna entra depois com esta mesma interface,
// uma pergunta de cada vez, e as regras continuam como reserva se a API cair.
export const classificadorRegras: Classificador = {
  async pedeHumano(texto) {
    return PEDE_HUMANO.test(normalizar(texto));
  },

  async intencao(texto) {
    const t = normalizar(texto);
    if (PEDE_HUMANO.test(t)) return "humano";
    if (/\b(proposta|contrato|andamento|ja fiz|ja enviei|ja mandei|foi aprovad|cai quando|quando cai)\b/.test(t)) {
      return "acompanhar_proposta";
    }
    if (/\b(emprestimo|credito|consignado|dinheiro|simula|simular|simulacao|margem|saldo|antecipa|valor)/.test(t)) {
      return "credito";
    }
    // Mensagem pronta do botão dos anúncios ("Posso ter mais informações sobre isso?",
    // "Tenho interesse"): é pedido de crédito, não dúvida.
    if (/\b(mais informac|informacoes|saber mais|tenho interesse|me interessei|interessad|vi o anuncio|vi seu anuncio)/.test(t)) {
      return "credito";
    }
    if (t.includes("?")) return "duvida";
    if (/^(oi|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|tudo bem|hello)\b/.test(t)) return "saudacao";
    return "outro";
  },

  async convenio(texto) {
    const t = normalizar(texto);
    // "2", "2." ou "opção 2": o número da lista de produtos.
    const numero = t.match(/^(?:opcao\s*)?(\d{1,2})\b/);
    if (numero) return PRODUTOS[Number(numero[1]) - 1]?.convenio ?? null;
    return CONVENIOS.find(([padrao]) => padrao.test(t))?.[1] ?? null;
  },

  async simNao(texto) {
    const t = normalizar(texto);
    if (NAO.test(t)) return "nao";
    if (SIM.test(t)) return "sim";
    return null;
  },

  async lerOferta(texto) {
    return lerOfertaPorRegras(texto);
  },

  async tentativaExtracao(texto) {
    return EXTRACAO.test(normalizar(texto));
  },

  async linkNaoChegou(texto) {
    return /\bnao (chegou|recebi|veio|apareceu|achei)\b|\b(cade|cadê) o link\b|manda (de novo|novamente)/.test(normalizar(texto));
  },
};
