// Percentuais de margem consignável. Mudam por lei e por política de banco, por isso
// ficam aqui, num lugar só. CONFIRMAR com a política vigente antes de usar com cliente.
//
// INSS (benefício comum): 45% no total, sendo 35% empréstimo, 5% cartão consignado (RMC)
// e 5% cartão benefício (RCC).
// INSS LOAS/BPC (espécies 87 e 88): 35% no total, 30% empréstimo e 5% cartão. A Facta não
// libera RMC para essas espécies (manual Portabilidade CIP INSS, regras de negócio).
// SIAPE: 45% no total, 35% empréstimo, 5% cartão de crédito e 5% cartão benefício.

export type Convenio = "inss" | "siape";

export interface Percentuais {
  total: number;
  emprestimo: number;
  rmc: number;
  rcc: number;
}

export const ESPECIES_LOAS = [87, 88];

export function percentuais(convenio: Convenio, especie: number | null): Percentuais {
  if (convenio === "inss" && especie !== null && ESPECIES_LOAS.includes(especie)) {
    return { total: 0.35, emprestimo: 0.3, rmc: 0, rcc: 0.05 };
  }
  return { total: 0.45, emprestimo: 0.35, rmc: 0.05, rcc: 0.05 };
}

// Portabilidade (roteiro operacional SIAPE da Facta, 04.11.2026). CONFIRMAR a cada versão.
export const REGRAS_PORTABILIDADE = {
  // Parcelas pagas que o banco de origem exige antes de portar. Os demais: 0.
  minimoPagasPorBanco: [
    [/agibank|agiplan/, 15],
    [/\bbmg\b/, 12],
    [/\bc6\b/, 12],
    [/daycoval/, 24],
    [/\bpan\b|panamericano/, 30],
    [/parana/, 15],
    [/santander|\bole\b/, 12],
  ] as [RegExp, number][],
  // Bancos de onde a Facta não compra contrato.
  bancosSemPortabilidade: [/inbursa/, /\bpine\b/, /socicred/],
  // Só portamos contrato de banco. Entidade de previdência, pecúlio ou seguradora não
  // (regra do dono, 12.11.2026).
  previdenciaSemPortabilidade: [
    /previd/, /\bsabemi\b/, /\bprevim/, /\bcomprev\b/, /\bfuturo\b/, /capemisa/, /gboex/,
    /mongeral/, /aspecir/, /icatu/, /montepio/, /pecul/, /segurador/,
  ],
  // Saldo devedor mínimo para portar.
  saldoMinimo: 2000,
  // Sem taxa no documento, o saldo é estimado com esta taxa ao mês. Taxa menor dá saldo
  // maior, ou seja, troco menor: a estimativa fica do lado conservador.
  taxaPadraoSaldo: 1.6,
  // Refin da portabilidade: valor bruto e troco mínimos.
  refinBrutoMinimo: 15000,
  trocoMinimo: 50,
  // Prazo máximo do SIAPE. Com o total de parcelas desconhecido, as pagas são no máximo
  // 120 menos as restantes: se nem isso chega ao mínimo do banco, não porta.
  prazoMaximoSiape: 120,
  // Prazo máximo por idade na assinatura (roteiro SIAPE): [idade até, prazo].
  prazoPorIdade: [
    [71, 120],
    [72, 108],
    [73, 96],
    [74, 84],
  ] as [number, number][],
};

// Maior prazo que a Facta aceita para a idade. null: idade fora da política.
export function prazoMaximoPorIdade(dataNascimento: string, hoje = new Date()): number | null {
  const nasc = new Date(dataNascimento);
  const aniversarioPassou = hoje >= new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate());
  const idade = hoje.getFullYear() - nasc.getFullYear() - (aniversarioPassou ? 0 : 1);
  return REGRAS_PORTABILIDADE.prazoPorIdade.find(([ate]) => idade <= ate)?.[1] ?? null;
}

export const REGRAS_OPERACAO = {
  // Abaixo disso, não compensa oferecer empréstimo novo.
  parcelaMinimaReais: 20,
  // Diferença aceitável entre a margem que o extrato informa e a que o código calcula.
  toleranciaDivergenciaReais: 1,
  // Refin costuma exigir um mínimo de parcelas pagas. CONFIRMAR com cada banco.
  refinMinimoParcelasPagas: 12,
  // Portabilidade só vale a pena com algumas parcelas pela frente.
  portabilidadeMinimoParcelasRestantes: 12,
  // Taxa acima disso indica que portar pode baratear. Teto do INSS muda: CONFIRMAR.
  taxaReferenciaMensal: 1.85,
};
