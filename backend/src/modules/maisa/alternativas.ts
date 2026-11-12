// Sem margem para empréstimo novo: a Maisa ainda olha se dá para refinanciar um contrato
// da Facta ou trazer um de outro banco (portabilidade, com ou sem refin). Se der, a equipe
// fecha. Se não der nada, não há o que fazer e ela encerra.
import type { AnaliseExtrato, ContratoAnalisado } from "../extratos/analise.js";
import type { BancoClt, DigitacaoPort, ReducaoParcela, ResultadoExtrato, SimulacaoPortabilidade } from "./bancos.js";

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
    const portas: string[] = [];
    const reducoes: ReducaoParcela[] = [];
    const simulacoes: DigitacaoPort[] = [];
    // Port pura: o contrato que mais baixa a parcela é o que ela conduz.
    let melhorPort: { reducao: number; digitacao: DigitacaoPort } | null = null;
    for (const contrato of candidatos) {
      try {
        const s = await p.banco.simularPortabilidadeSiape({ cpf: p.cpf, dataNascimento: p.dataNascimento, contrato });
        if (s.digitacao) simulacoes.push(s.digitacao);
        if (s.temPortabilidade) {
          algumaPort = true;
          portas.push(`parcela de ${contrato.parcela} cai para ${s.parcelaPortabilidade ?? "?"} na Facta`);
          if (s.parcelaPortabilidade) {
            reducoes.push({
              banco: contrato.banco,
              atual: contrato.parcela,
              nova: s.parcelaPortabilidade,
              restantes: contrato.parcelasRestantes,
              ...(s.digitacao?.port.taxa ? { taxa: s.digitacao.port.taxa } : {}),
            });
            const reducao = contrato.parcela - s.parcelaPortabilidade;
            if (s.digitacao && (!melhorPort || reducao > melhorPort.reducao)) melhorPort = { reducao, digitacao: s.digitacao };
          }
        }
        if (s.trocoCentavos && (!melhor?.trocoCentavos || s.trocoCentavos > melhor.trocoCentavos)) melhor = s;
      } catch (err) {
        falhou = true;
        console.error("Simulação de portabilidade falhou:", err instanceof Error ? err.message : err);
      }
    }
    if (melhor?.trocoCentavos) {
      return {
        tipo: "alternativa",
        operacao: "port_refin",
        trocoCentavos: melhor.trocoCentavos,
        motivo: `port + refin: ${melhor.motivo}`,
        simulada: true,
        simulacoes,
        ...(melhor.digitacao ? { digitacao: melhor.digitacao } : {}),
      };
    }
    // Abriu tabela de portabilidade, mesmo sem troco: cliente em potencial, a equipe
    // simula e mostra a ele. Se a simulação falhou, a equipe confere com o saldo real.
    if (algumaPort) {
      return { tipo: "alternativa", operacao: "portabilidade", trocoCentavos: null, motivo: `port sem refin: ${portas.join("; ")}`,
        simulada: true,
        reducoes,
        simulacoes,
        ...(melhorPort ? { digitacao: melhorPort.digitacao } : {}),
      };
    }
    if (falhou) {
      return { tipo: "alternativa", operacao: "portabilidade", trocoCentavos: null, motivo: "simulação da port falhou, conferir", simulada: false };
    }
  } else if (portaveis.length) {
    // INSS: a port ainda não é simulada aqui. A equipe simula com o contrato em mãos.
    return { tipo: "alternativa", operacao: "portabilidade", trocoCentavos: null, motivo: `${portaveis.length} contrato(s) para portar, simular na Facta`, simulada: false };
  }

  const refin = possivel("refin");
  if (refin.length) {
    return { tipo: "alternativa", operacao: "refin", trocoCentavos: null, motivo: `${refin.length} contrato(s) da Facta para refinanciar, simular`, simulada: false };
  }
  return null;
}
