// Recebe o extrato lido e decide, com regras fixas, quanto de margem sobra e o que dá
// para oferecer. Nada aqui chama o modelo: os números saem de conta, não de opinião.
import type { ContratoLido, ExtratoLido } from "./leitor.js";
import { REGRAS_OPERACAO, percentuais, ESPECIES_LOAS, type Convenio } from "./regrasMargem.js";

export type Possibilidade =
  | { tipo: "novo"; possivel: boolean; parcelaMaxima: number; motivo: string }
  | { tipo: "cartao_rmc" | "cartao_rcc"; possivel: boolean; margem: number; motivo: string }
  | { tipo: "refin" | "portabilidade"; possivel: boolean; contratos: ContratoAnalisado[]; motivo: string };

export interface ContratoAnalisado {
  banco: string;
  numero: string | null;
  parcela: number | null;
  parcelasRestantes: number | null;
  taxaMensal: number | null;
  // Estimativa pelo valor presente das parcelas que faltam. Só existe se a taxa aparece.
  saldoDevedorEstimado: number | null;
}

export interface Margem {
  calculada: number | null;
  informada: number | null;
  // A que vale para a decisão: a informada pelo documento quando existe.
  usada: number;
}

export interface AnaliseExtrato {
  convenio: Convenio | null;
  confiavel: boolean;
  resumo: string;
  alertas: string[];
  margens: { emprestimo: Margem; rmc: Margem; rcc: Margem };
  comprometimento: { total: number; limite: number | null; percentual: number | null };
  possibilidades: Possibilidade[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "2024-03" para meses corridos. Aceita AAAA-MM ou AAAA-MM-DD.
function meses(data: string | null): number | null {
  const m = data?.match(/^(\d{4})-(\d{2})/);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

function parcelasRestantes(c: ContratoLido, competencia: string | null): number | null {
  if (c.total_parcelas != null && c.parcelas_pagas != null) return Math.max(0, c.total_parcelas - c.parcelas_pagas);
  const fim = meses(c.fim);
  const hoje = meses(competencia);
  if (fim != null && hoje != null) return Math.max(0, fim - hoje + 1);
  return null;
}

function parcelasPagas(c: ContratoLido, competencia: string | null): number | null {
  if (c.parcelas_pagas != null) return c.parcelas_pagas;
  const restantes = parcelasRestantes(c, competencia);
  return c.total_parcelas != null && restantes != null ? c.total_parcelas - restantes : null;
}

// Valor presente das parcelas que faltam: parcela * (1 - (1+i)^-n) / i.
function saldoEstimado(c: ContratoLido, restantes: number | null): number | null {
  if (c.parcela == null || restantes == null || !c.taxa_mensal) return null;
  const i = c.taxa_mensal / 100;
  return r2((c.parcela * (1 - Math.pow(1 + i, -restantes))) / i);
}

function analisarContrato(c: ContratoLido, competencia: string | null): ContratoAnalisado {
  const restantes = parcelasRestantes(c, competencia);
  return {
    banco: [c.banco_codigo, c.banco_nome].filter(Boolean).join(" - ") || "banco não identificado",
    numero: c.numero,
    parcela: c.parcela,
    parcelasRestantes: restantes,
    taxaMensal: c.taxa_mensal,
    saldoDevedorEstimado: saldoEstimado(c, restantes),
  };
}

function margem(base: number | null, pct: number, descontos: number, informada: number | null, alertas: string[], nome: string): Margem {
  const calculada = base != null ? r2(Math.max(0, base * pct - descontos)) : null;
  if (calculada != null && informada != null && Math.abs(calculada - informada) > REGRAS_OPERACAO.toleranciaDivergenciaReais) {
    alertas.push(`Margem de ${nome}: o extrato informa ${reais(informada)}, a conta dá ${reais(calculada)}. Conferir.`);
  }
  return { calculada, informada, usada: informada ?? calculada ?? 0 };
}

export function analisarExtrato(e: ExtratoLido): AnaliseExtrato {
  const alertas: string[] = [...e.problemas.map((p) => `Leitura: ${p}`)];
  const convenio: Convenio | null = e.tipo_documento === "outro" ? null : e.tipo_documento;
  const vazia = { calculada: null, informada: null, usada: 0 };

  if (!e.legivel || !convenio) {
    return {
      convenio,
      confiavel: false,
      resumo: "Não foi possível ler o documento como extrato de INSS ou SIAPE. Encaminhar para conferência manual.",
      alertas,
      margens: { emprestimo: vazia, rmc: vazia, rcc: vazia },
      comprometimento: { total: 0, limite: null, percentual: null },
      possibilidades: [],
    };
  }

  const pct = percentuais(convenio, e.especie_codigo);
  const ativos = e.contratos.filter((c) => c.situacao === "ativo");
  const soma = (tipo: ContratoLido["tipo"]) => ativos.filter((c) => c.tipo === tipo).reduce((s, c) => s + (c.parcela ?? 0), 0);
  const semParcela = ativos.filter((c) => c.parcela == null).length;
  if (semParcela) alertas.push(`${semParcela} contrato(s) ativo(s) sem valor de parcela legível. A margem calculada pode estar alta demais.`);

  const base = e.base_calculo;
  if (base == null) alertas.push("Base de cálculo não encontrada. Usando só as margens que o extrato informa.");

  const margens = {
    emprestimo: margem(base, pct.emprestimo, soma("emprestimo"), e.margens_informadas.emprestimo, alertas, "empréstimo"),
    rmc: margem(base, pct.rmc, soma("rmc"), e.margens_informadas.rmc, alertas, "cartão RMC"),
    rcc: margem(base, pct.rcc, soma("rcc"), e.margens_informadas.rcc, alertas, "cartão benefício RCC"),
  };

  // Limite total de comprometimento: mesmo com margem por tipo, o total não pode passar.
  const total = r2(ativos.reduce((s, c) => s + (c.parcela ?? 0), 0));
  const limite = base != null ? r2(base * pct.total) : null;
  const estourado = limite != null && total > limite;
  if (estourado) alertas.push(`Comprometimento total de ${reais(total)} passa do limite de ${reais(limite!)}. Nenhuma operação nova até reduzir.`);

  const bloqueado = e.bloqueado_emprestimo === true;
  if (bloqueado) alertas.push("Benefício bloqueado para empréstimo. O cliente precisa desbloquear no Meu INSS antes.");
  const impedido = bloqueado || estourado;
  const loas = convenio === "inss" && e.especie_codigo != null && ESPECIES_LOAS.includes(e.especie_codigo);

  const possibilidades: Possibilidade[] = [];

  const parcelaMaxima = impedido ? 0 : margens.emprestimo.usada;
  possibilidades.push({
    tipo: "novo",
    possivel: parcelaMaxima >= REGRAS_OPERACAO.parcelaMinimaReais,
    parcelaMaxima: r2(parcelaMaxima),
    motivo: impedido
      ? "Bloqueio ou comprometimento acima do limite."
      : parcelaMaxima >= REGRAS_OPERACAO.parcelaMinimaReais
        ? `Cabe uma parcela de até ${reais(parcelaMaxima)}.`
        : `Margem livre de ${reais(parcelaMaxima)}, abaixo do mínimo de ${reais(REGRAS_OPERACAO.parcelaMinimaReais)}.`,
  });

  for (const [tipo, m, nome] of [
    ["cartao_rmc", margens.rmc, "cartão consignado (RMC)"],
    ["cartao_rcc", margens.rcc, "cartão benefício (RCC)"],
  ] as const) {
    const contratoTipo = tipo === "cartao_rmc" ? "rmc" : "rcc";
    const jaTem = ativos.some((c) => c.tipo === contratoTipo);
    const vetadoLoas = tipo === "cartao_rmc" && loas;
    const possivel = !impedido && !jaTem && !vetadoLoas && m.usada > 0;
    possibilidades.push({
      tipo,
      possivel,
      margem: r2(m.usada),
      motivo: vetadoLoas
        ? "LOAS (espécie 87/88) não pode contratar RMC."
        : jaTem
          ? `Já tem ${nome} ativo.`
          : impedido
            ? "Bloqueio ou comprometimento acima do limite."
            : m.usada > 0
              ? `Margem de ${reais(m.usada)} livre para ${nome}.`
              : `Sem margem livre para ${nome}.`,
    });
  }

  const emprestimos = ativos.filter((c) => c.tipo === "emprestimo");

  const refin = emprestimos
    .filter((c) => (parcelasPagas(c, e.competencia) ?? 0) >= REGRAS_OPERACAO.refinMinimoParcelasPagas)
    .map((c) => analisarContrato(c, e.competencia));
  possibilidades.push({
    tipo: "refin",
    possivel: !bloqueado && refin.length > 0,
    contratos: refin,
    motivo: refin.length
      ? `${refin.length} contrato(s) com ${REGRAS_OPERACAO.refinMinimoParcelasPagas}+ parcelas pagas. Refin só no banco de origem: na Facta, conferir em contratos-refinanciamento.`
      : `Nenhum contrato com ${REGRAS_OPERACAO.refinMinimoParcelasPagas} parcelas pagas ou mais.`,
  });

  const porta = emprestimos
    .map((c) => analisarContrato(c, e.competencia))
    .filter((c) => (c.parcelasRestantes ?? 0) >= REGRAS_OPERACAO.portabilidadeMinimoParcelasRestantes);
  const caras = porta.filter((c) => c.taxaMensal != null && c.taxaMensal > REGRAS_OPERACAO.taxaReferenciaMensal);
  possibilidades.push({
    tipo: "portabilidade",
    possivel: !bloqueado && porta.length > 0,
    contratos: porta,
    motivo: porta.length
      ? caras.length
        ? `${caras.length} contrato(s) com taxa acima de ${REGRAS_OPERACAO.taxaReferenciaMensal}% ao mês: bons candidatos.`
        : `${porta.length} contrato(s) com ${REGRAS_OPERACAO.portabilidadeMinimoParcelasRestantes}+ parcelas restantes. Comparar a taxa antes de oferecer.`
      : "Nenhum contrato com parcelas suficientes pela frente.",
  });

  const viaveis = possibilidades.filter((p) => p.possivel).map((p) => NOME_POSSIBILIDADE[p.tipo]);
  return {
    convenio,
    confiavel: e.legivel && alertas.filter((a) => a.startsWith("Margem de") || a.startsWith("Leitura")).length === 0,
    resumo: viaveis.length ? `Dá para oferecer: ${viaveis.join(", ")}.` : "Nenhuma operação possível com este extrato.",
    alertas,
    margens,
    comprometimento: { total, limite, percentual: base ? r2((total / base) * 100) : null },
    possibilidades,
  };
}

export const NOME_POSSIBILIDADE: Record<Possibilidade["tipo"], string> = {
  novo: "empréstimo novo",
  cartao_rmc: "cartão consignado (RMC)",
  cartao_rcc: "cartão benefício (RCC)",
  refin: "refinanciamento",
  portabilidade: "portabilidade",
};
