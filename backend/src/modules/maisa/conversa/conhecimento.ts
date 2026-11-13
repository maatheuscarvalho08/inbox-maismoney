// Base de conhecimento: orientações verificadas que a Maisa pode dar. O modelo NUNCA inventa
// um caminho em aplicativo de banco: a orientação vem daqui, por tópico, ou não existe.
//
// status:
// - aprovado: o dono revisou e aprovou (a equipe operacional forneceu e validou o procedimento).
// - em_producao: texto que a Maisa já diz aos clientes hoje (vem do código). Pode ser usado,
//   mas continua na fila para o dono aprovar.
// - pendente: precisa do procedimento real do banco ou produto. NÃO é usado pela Maisa.
// Cada item tem id, versão, fonte e quem validou, para auditoria.
import { TEXTOS } from "../textos.js";

export type StatusConhecimento = "aprovado" | "em_producao" | "pendente";

export interface ItemConhecimento {
  id: string;
  versao: string;
  topico: string;
  titulo: string;
  produtos?: ("inss" | "siape" | "clt")[];
  bancos?: string[]; // nomes normalizados em minúsculas; vazio = vale para qualquer banco
  status: StatusConhecimento;
  fonte: string;
  validadoPor: string | null;
  validadoEm: string | null;
  texto: () => string | null;
}

const FONTE_TEXTOS = "texto já enviado a clientes pelo código (textos.ts), aguardando aprovação do dono";

export const BASE: ItemConhecimento[] = [
  {
    id: "numero_contrato.siape.extrato",
    versao: "1",
    topico: "numero_contrato",
    titulo: "Onde está o número do contrato no extrato de consignações (SIAPE)",
    produtos: ["siape"],
    status: "aprovado",
    fonte: "informado pelo dono em 13/11/2026, conferido no extrato de consignações enviado por cliente (coluna Número do Contrato)",
    validadoPor: "dono",
    validadoEm: "2026-11-13",
    texto: () => "O número de cada contrato aparece no extrato de consignações, na coluna Número do Contrato.",
  },
  {
    id: "extrato_siape.geral",
    versao: "1",
    topico: "extrato_siape",
    titulo: "Como tirar o extrato de consignações",
    produtos: ["siape"],
    status: "em_producao",
    fonte: FONTE_TEXTOS + " (comoTirarExtrato)",
    validadoPor: null,
    validadoEm: null,
    texto: () => TEXTOS.comoTirarExtrato("siape").split("\n")[0],
  },
  {
    id: "extrato_inss.geral",
    versao: "1",
    topico: "extrato_inss",
    titulo: "Como tirar o extrato de empréstimos do INSS",
    produtos: ["inss"],
    status: "em_producao",
    fonte: FONTE_TEXTOS + " (comoTirarExtrato)",
    validadoPor: null,
    validadoEm: null,
    texto: () => TEXTOS.comoTirarExtrato("inss").split("\n")[0],
  },
  // Procedimento por banco: a equipe operacional precisa fornecer e o dono aprovar.
  ...["cef", "brb", "banrisul", "prb", "bradesco", "itau", "santander", "banco do brasil"].map(
    (b): ItemConhecimento => ({
      id: `numero_contrato.${b.replace(/ /g, "_")}`,
      versao: "0",
      topico: "numero_contrato",
      titulo: `Onde achar o número do contrato no ${b.toUpperCase()}`,
      bancos: [b],
      status: "pendente",
      fonte: "pendente: procedimento real a ser fornecido pela equipe operacional",
      validadoPor: null,
      validadoEm: null,
      texto: () => null,
    }),
  ),
];

const usavel = (i: ItemConhecimento) => (i.status === "aprovado" || i.status === "em_producao") && i.texto() !== null;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// A orientação mais específica que a Maisa pode usar: do banco, depois a geral do produto.
export function orientacaoPara(topico: string, ctx: { produto?: string; banco?: string }, base: ItemConhecimento[] = BASE): ItemConhecimento | null {
  const banco = ctx.banco ? norm(ctx.banco) : "";
  // Aprovado vale mais que o texto que já estava em produção.
  const rank = (i: ItemConhecimento) => (i.status === "aprovado" ? 0 : 1);
  const candidatos = base
    .filter((i) => i.topico === topico && usavel(i) && (!i.produtos || !ctx.produto || (i.produtos as string[]).includes(ctx.produto)))
    .sort((a, b) => rank(a) - rank(b));
  const doBanco = candidatos.find((i) => i.bancos?.some((b) => banco.includes(b)));
  return doBanco ?? candidatos.find((i) => !i.bancos?.length) ?? null;
}

// O que ainda falta o dono aprovar ou a equipe fornecer.
export function pendentesDeAprovacao(base: ItemConhecimento[] = BASE) {
  return base.filter((i) => i.status !== "aprovado").map((i) => ({ id: i.id, status: i.status, fonte: i.fonte }));
}
