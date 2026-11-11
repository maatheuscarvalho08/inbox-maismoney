// Sem margem para empréstimo novo: a Maisa ainda olha se dá para refinanciar um contrato
// da Facta ou trazer um de outro banco (portabilidade, com ou sem refin). Se der, a equipe
// fecha. Se não der nada, não há o que fazer e ela encerra.
import type { AnaliseExtrato, ContratoAnalisado } from "../extratos/analise.js";
import type { BancoClt, ResultadoExtrato, SimulacaoPortabilidade } from "./bancos.js";

type Alternativa = Extract<ResultadoExtrato, { tipo: "alternativa" }>;

// Simula no máximo estes contratos, os de maior saldo primeiro.
const MAX_SIMULACOES = 3;

export async function buscarAlternativa(p: {
  convenio: "inss" | "siape";
  analise: AnaliseExtrato;
  banco: BancoClt;
  cpf: string;
  dataNascimento: string;
}): Promise<Alternativa | null> {
  const possivel = (tipo: "refin" | "portabilidade") => {
    const pos = p.analise.possibilidades.find((x) => x.tipo === tipo);
    return pos && pos.tipo === tipo && pos.possivel ? pos.contratos : [];
  };

  const portaveis = possivel("portabilidade").filter(
    (c): c is ContratoAnalisado & { parcela: number; parcelasRestantes: number; saldoDevedorEstimado: number } =>
      c.parcela != null && c.parcelasRestantes != null && c.saldoDevedorEstimado != null,
  );

  if (portaveis.length && p.convenio === "siape" && p.dataNascimento) {
    const candidatos = [...portaveis].sort((a, b) => b.saldoDevedorEstimado - a.saldoDevedorEstimado).slice(0, MAX_SIMULACOES);
    let melhor: SimulacaoPortabilidade | null = null;
    let algumaPort = false;
    let falhou = false;
    for (const contrato of candidatos) {
      try {
        const s = await p.banco.simularPortabilidadeSiape({ cpf: p.cpf, dataNascimento: p.dataNascimento, contrato });
        algumaPort ||= s.temPortabilidade;
        if (s.trocoCentavos && (!melhor?.trocoCentavos || s.trocoCentavos > melhor.trocoCentavos)) melhor = s;
      } catch (err) {
        falhou = true;
        console.error("Simulação de portabilidade falhou:", err instanceof Error ? err.message : err);
      }
    }
    if (melhor?.trocoCentavos) {
      return { tipo: "alternativa", operacao: "port_refin", trocoCentavos: melhor.trocoCentavos, motivo: `port + refin: ${melhor.motivo}` };
    }
    // Sem tabela de refin não há troco, e só portar não compensa: não há o que fazer.
    // Só se a simulação falhou (rede, Facta fora) a equipe confere com o saldo real.
    if (falhou) {
      return { tipo: "alternativa", operacao: "portabilidade", trocoCentavos: null, motivo: "simulação da port falhou, conferir" };
    }
    if (algumaPort) console.log(`Port sem troco em ${candidatos.length} contrato(s): sem opção`);
  } else if (portaveis.length) {
    // INSS: a port ainda não é simulada aqui. A equipe simula com o contrato em mãos.
    return { tipo: "alternativa", operacao: "portabilidade", trocoCentavos: null, motivo: `${portaveis.length} contrato(s) para portar` };
  }

  const refin = possivel("refin");
  if (refin.length) {
    return { tipo: "alternativa", operacao: "refin", trocoCentavos: null, motivo: `${refin.length} contrato(s) da Facta para refinanciar` };
  }
  return null;
}
