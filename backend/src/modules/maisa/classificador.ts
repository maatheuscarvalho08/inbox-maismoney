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

// Receio de verdade. "Seguro" (o seguro do contrato) e "demora" ("desculpa a demora") ficaram
// de fora; "sem medo" e "confio" não são receio.
const RECEIO_OFERTA = /(medo|receio|golpe|fraude|reclame aqui|desconfi|nao confio|perigo|enganad|nao libera|demora (pra|para|a|muito pra) liberar)/;
const SEM_RECEIO = /\b(sem|nao tenho|nenhum|zero) (medo|receio|risco|desconfianca)\b|\bconfio\b|confianca total/;
export const temReceio = (t: string) => RECEIO_OFERTA.test(t) && !SEM_RECEIO.test(t);

const PENSANDO_OFERTA = /(pensar|pensando|depois|mais tarde|amanh|vou ver|ver com|conversar com|falar com (a|o|minha|meu))/;

// Lê a resposta à oferta com regras. É a reserva do modelo e o que os testes usam.
export function lerOfertaPorRegras(texto: string): LeituraOferta | null {
  const t = normalizar(texto);
  const leitura = (tipo: LeituraOferta["tipo"], objecao: ObjecaoOferta | null = null, outraOferta: string | null = null): LeituraOferta => ({
    tipo,
    objecao,
    outraOferta,
  });
  if (pedeHumanoTexto(t) || /(robo|maquina|ser humano)/.test(t)) return leitura("humano");
  if (temReceio(t)) return leitura("objecao", "desconfianca");
  // "Não tenho dúvida, quero": o fim da frase manda.
  if (/(^|[,.!;]\s*|\b(entao|ta)\s+)(quero|quero sim|sim+|aceito|pode fazer|pode seguir)\s*[.!]*$/.test(t) && !NAO_QUERO.test(t)) return leitura("aceita");
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
  // Aceite só com intenção clara. "pode ser que sim" e "quero saber mais" não são aceite.
  // "sim, e também quero saber de cartão" começa com sim: é aceite. "quero saber mais" não.
  if (/^(sim+|s|ss|claro|aceito|isso|bora|fechado|fechou)\b/.test(t) || SIM_FORTE.test(t)) return leitura("aceita");
  if (/(pode ser que|talvez|acho que|quero (saber|entender))/.test(t)) return texto.includes("?") ? leitura("pergunta") : leitura("pensar");
  if (/^quero\b/.test(t)) return leitura("aceita");
  if (texto.includes("?") || /^(qual|quais|quanto|como|quando|onde|tem|e se|depende)/.test(t)) return leitura("pergunta");
  return null;
}

// Pedidos de prompt, instruções internas, credenciais ou "modo desenvolvedor".
const EXTRACAO =
  /\b(prompt|system|instruc(ao|oes) (internas?|do sistema|que (te|voce) (deram|recebeu))|suas (regras|instrucoes|configurac)|ignor[ae] (as |suas |todas )?(instruc|regras)|modo (desenvolvedor|dev|debug|depuracao|manutencao)|jailbreak|repit[ae] tudo|repete tudo|login e senha|senha da facta|codigo master|voce agora e|finj[ae] que|modo (dan|admin)|api ?key|chave (da api|de api|secreta)|token de acesso|credencia(l|is)|senha do sistema|variave(l|is) de ambiente|endpoint)/;

export function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pedido de uma pessoa. Precisa de um verbo de pedido perto ("quero falar com", "me passa",
// "chama"); a palavra solta não basta: "sou atendente", "o atendente do banco disse",
// "meu consultor" e "falar com alguém da minha família" não são pedido.
const PEDIDO_HUMANO =
  /\b(falar|conversar|atendimento|atender|chama|chamar|passa|passar|transfere|transferir|quero|queria|preciso|prefiro)\b[^.!?]{0,25}\b(atendente|humano|humana|pessoa|consultor|consultora|gerente|alguem|especialista)\b/;
const SO_HUMANO = /^(atendente|humano|uma pessoa|pessoa|especialista)\W*(por favor|pf|pfv|por gentileza)?\W*$|\b(atendente|humano)\s*(por favor|pf|pfv|por gentileza)\b|nao quero (falar com )?(robo|maquina)/;
const NAO_E_PEDIDO = /\b(alguem|pessoa|consultor|atendente)\b[^.!?]{0,12}\b(da|de) (minha |nossa )?famil|\bnao,? pode (fazer|seguir)|voce mesma/;
export function pedeHumanoTexto(t: string): boolean {
  if (NAO_E_PEDIDO.test(t)) return false;
  return SO_HUMANO.test(t) || PEDIDO_HUMANO.test(t);
}

// Ordem importa: o mais específico vem antes do mais genérico.
// O número da lista de produtos é lido antes, em convenio(). Aqui só texto livre.
const CONVENIOS: [RegExp, ConvenioEntendido][] = [
  // Grafias que a transcrição de áudio costuma devolver também valem (celetista, "ce ele te").
  [/\b(clt|celetista|celete|ce ele te|c l t)\b|carteira assinada|carteira de trabalho|de carteira\b|\bregistrad|empresa privada/, "clt"],
  [/\bloas\b|\bbpc\b|prestacao continuada/, "loas"],
  // Representante legal, curador e procurador: a equipe confere quem assina.
  [/representante legal|curador|curatela|procurador/, "outro"],
  // Antes do INSS: "pensionista SIAPE" é SIAPE. CIAP, ciape e siap são o SIAPE falado.
  // Servidor do INSS e órgãos federais também são SIAPE.
  [/\b(siape|siap|siapi|ciap|ciape|ciapi|ciappe)\b|servidor(a)? federal|\bfederal\b|servidor(a)? (do|da) (inss|uniao)|\bibge\b|ministerio|universidade federal|instituto federal|\bagu\b|\bibama\b|\bfunai\b|\banvisa\b/, "siape"],
  [/\bmarinha\b/, "marinha"],
  [/\bmilitar|exercito|aeronautica|forcas armadas/, "militar"],
  [/prefeitura|municipal|municipio/, "servidor_prefeitura"],
  [/estadual|\bdo estado\b|governo do estado|secretaria (de|da|do) estado/, "servidor"],
  [/bolsa familia|auxilio brasil|\bauxilio\b/, "outro"],
  [/\binss\b|aposentad|pensionista|beneficio/, "inss"],
  [/\bfgts\b|saque aniversario/, "fgts"],
  [/conta de luz|energia/, "conta_de_luz"],
  [/credito pessoal|emprestimo pessoal/, "credito_pessoal"],
  [/servidor|concursad|publico/, "servidor"],
  // "outro banco", "outra empresa" não é o produto "outro".
  [/\b(outro|outra)\b(?! (banco|lugar|empresa|financeira|emprestimo))|autonom|desempregad|\bmei\b/, "outro"],
];

const NAO = /^(nao|n|nn|nem|negativo|agora nao)\b|\bnao (quero|autorizo|aceito|tenho interesse|obrigad)/;
// Sim forte, que vale mesmo começando com "não" ("não vejo problema, pode seguir").
export const SIM_FORTE =
  /\b(pode (fazer|seguir|mandar|prosseguir|consultar|sim)|quero sim|quero esse|quero essa|quero fazer|vamos nessa|vamos sim|vamos fazer|bora|fechado|fechou|manda bala|topo|claro que sim|com certeza|demorou|aceito|eu quero|pode ser feito|nao vejo problema|sem problema,? pode|autorizo)\b/;
export const NAO_QUERO = /\b(nao quero|nao tenho interesse|nao aceito|nao autorizo|nao permito|nao pode|nao topo|nao vou querer|deixa pra la|desisto|nao,? obrigad|agora nao)\b/;
const SIM = /^(sim+|s|ss|claro|pode|quero|aceito|autorizo|ok|okay|beleza|blz|bora|isso|com certeza|pode ser|tenho interesse|vamos|ta bom|tudo bem|manda o link|pode consultar)\b/;

// Primeira versão, só com regras. O Luna entra depois com esta mesma interface,
// uma pergunta de cada vez, e as regras continuam como reserva se a API cair.
export const classificadorRegras: Classificador = {
  async pedeHumano(texto) {
    return pedeHumanoTexto(normalizar(texto));
  },

  async intencao(texto) {
    const t = normalizar(texto);
    if (pedeHumanoTexto(t)) return "humano";
    if (/\b(minha proposta|meu contrato|meu pedido|andamento|status da|foi aprovad|cai quando|quando cai|ja (fiz|mandei|enviei) (a|uma|o|os) (proposta|contrato|documentos|pedido))\b/.test(t)) {
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
    if (SIM_FORTE.test(t) && !NAO_QUERO.test(t)) return "sim";
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
