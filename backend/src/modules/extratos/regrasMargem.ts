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
