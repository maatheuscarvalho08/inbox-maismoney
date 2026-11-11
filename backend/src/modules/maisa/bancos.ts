// O banco que a Maisa usa no CLT. O fluxo só conhece este formato: cada banco real
// traduz a resposta da API dele para cá.
import * as facta from "./facta.js";
import { REGRAS, avaliarVinculo } from "./regras.js";
import type { ContratoAnalisado } from "../extratos/analise.js";
import { REGRAS_PORTABILIDADE } from "../extratos/regrasMargem.js";

export type ResultadoBanco =
  | {
      tipo: "com_saldo";
      banco: string;
      valorCentavos: number;
      parcelaCentavos: number;
      prazoMeses: number;
      // Tabela escolhida, para digitar a proposta depois. Só a Facta preenche.
      tabela?: { codigoTabela: number; prazo: number; contrato: number; parcela: number; coeficiente: number };
      // Lidos do extrato: entram no cadastro sem perguntar de novo.
      renda?: number | null;
      especie?: number | null;
    }
  // revisar: a leitura do extrato ficou com dúvida, então a equipe confere antes de desistir.
  | { tipo: "sem_saldo"; banco: string; motivo: string; revisar?: boolean }
  | { tipo: "erro"; banco: string; motivo: string };

export type ResultadoAutorizacao = facta.ResultadoAutorizacao;

// INSS e SIAPE: o extrato pode não servir (outro documento, ilegível) antes de chegar ao banco.
// "servidor_outro": o cliente disse SIAPE, mas o contracheque é de estado ou prefeitura.
export type ResultadoExtrato =
  | ResultadoBanco
  | { tipo: "extrato_invalido"; motivo: string }
  | { tipo: "servidor_outro"; motivo: string }
  // Sem margem para novo, mas dá para portar ou refinanciar: a equipe fecha.
  | { tipo: "alternativa"; operacao: OperacaoAlternativa; trocoCentavos: number | null; motivo: string };

export type OperacaoAlternativa = "port_refin" | "portabilidade" | "refin";

// Melhor simulação de port + refin de um contrato. null: a Facta não devolveu tabela.
export interface SimulacaoPortabilidade {
  trocoCentavos: number | null;
  temPortabilidade: boolean;
  // Menor parcela que a Facta abriu para portar o contrato.
  parcelaPortabilidade: number | null;
  motivo: string;
}

// Antes de consultar, o cliente precisa autorizar num link que o banco manda.
export type ResultadoConsulta = { tipo: "nao_autorizado" } | { tipo: "link_expirado" } | { tipo: "indisponivel" } | ResultadoBanco;

export interface BancoClt {
  nome: string;
  solicitarAutorizacao(p: { cpf: string; nome: string; celular: string }): Promise<ResultadoAutorizacao>;
  consultar(cpf: string): Promise<ResultadoConsulta>;
  // INSS e SIAPE: a parcela máxima sai do extrato que o cliente mandou.
  simularConsignado(p: { convenio: "inss" | "siape"; cpf: string; dataNascimento: string; parcelaMaxima: number }): Promise<ResultadoBanco>;
  // SIAPE: port + refin de um contrato de outro banco, com o saldo estimado pelo extrato.
  simularPortabilidadeSiape(p: { cpf: string; dataNascimento: string; contrato: ContratoAnalisado }): Promise<SimulacaoPortabilidade>;
}

const reais = (v: number) => Math.round(v * 100);

// A oferta padrão é a de maior valor sem seguro. Seguro só se o consultor oferecer.
// Tabela "iletrado" é para cliente que não assina: só a equipe usa.
function melhorTabela(nome: string, tabelas: facta.Tabela[], mensagem: string): ResultadoBanco {
  const semSeguro = tabelas.filter((t) => t.valorSeguro === 0 && t.valorLiquido > 0 && !/iletrad/i.test(t.tabela));
  if (!semSeguro.length) {
    const motivo = tabelas.length ? "só há tabelas com seguro" : mensagem || "nenhuma tabela disponível";
    return { tipo: "sem_saldo", banco: nome, motivo };
  }
  const melhor = semSeguro.reduce((a, b) => (b.valorLiquido > a.valorLiquido ? b : a));
  return {
    tipo: "com_saldo",
    banco: nome,
    valorCentavos: reais(melhor.valorLiquido),
    parcelaCentavos: reais(melhor.parcela),
    prazoMeses: melhor.prazo,
    tabela: {
      codigoTabela: melhor.codigoTabela,
      prazo: melhor.prazo,
      contrato: melhor.contrato,
      parcela: melhor.parcela,
      coeficiente: melhor.coeficiente,
    },
  };
}

export const bancoFacta: BancoClt = {
  nome: "Facta",

  async solicitarAutorizacao(p) {
    const { resultado, mensagem } = await facta.solicitarAutorizacao(p);
    if (resultado === "erro") console.error(`Facta recusou o pedido de autorização: ${mensagem}`);
    return resultado;
  },

  async consultar(cpf) {
    const consulta = await facta.consultarTrabalhador(cpf);
    if (consulta.tipo === "nao_autorizado") return { tipo: "nao_autorizado" };
    if (consulta.tipo === "link_expirado") return { tipo: "link_expirado" };
    if (consulta.tipo === "indisponivel") return { tipo: "indisponivel" };
    if (consulta.tipo === "erro") return { tipo: "erro", banco: this.nome, motivo: consulta.mensagem };

    // Com mais de um vínculo, simula o de maior margem entre os que passam nas regras.
    const avaliados = consulta.vinculos.map((v) => ({ v, recusa: avaliarVinculo(v) }));
    const aptos = avaliados.filter((a) => !a.recusa).sort((a, b) => (b.v.margemDisponivel ?? 0) - (a.v.margemDisponivel ?? 0));
    if (!aptos.length) {
      return { tipo: "sem_saldo", banco: this.nome, motivo: avaliados[0]?.recusa ?? "nenhum vínculo CLT encontrado" };
    }
    const v = aptos[0].v;
    const { tabelas, mensagem } = await facta.simular({
      cpf,
      dataNascimento: v.dataNascimento!,
      renda: v.renda!,
      valorParcela: v.margemDisponivel! * REGRAS.folgaMargem,
    });

    return melhorTabela(this.nome, tabelas, mensagem);
  },

  async simularConsignado(p) {
    const { tabelas, mensagem } = await facta.simularConsignado({
      convenio: p.convenio,
      cpf: p.cpf,
      dataNascimento: p.dataNascimento,
      valorParcela: p.parcelaMaxima * REGRAS.folgaMargem,
    });
    return melhorTabela(this.nome, tabelas, mensagem);
  },

  async simularPortabilidadeSiape({ cpf, dataNascimento, contrato }) {
    const restantes = contrato.parcelasRestantes!;
    const original = contrato.totalParcelas ?? (contrato.parcelasPagas != null ? restantes + contrato.parcelasPagas : restantes);
    const s = await facta.simularPortRefinSiape({
      cpf,
      dataNascimento,
      parcela: contrato.parcela!,
      prazoRestante: restantes,
      prazoOriginal: original,
      saldoDevedor: contrato.saldoDevedorEstimado!,
      prazo: REGRAS_PORTABILIDADE.prazoRefin,
    });
    // Troco do refin: sem seguro, com o bruto e o troco mínimos do roteiro.
    const refins = s.refin.filter(
      (t) =>
        t.valorSeguro === 0 &&
        t.contrato >= REGRAS_PORTABILIDADE.refinBrutoMinimo &&
        t.valorLiquido >= REGRAS_PORTABILIDADE.trocoMinimo,
    );
    const melhor = refins.sort((a, b) => b.valorLiquido - a.valorLiquido)[0];
    const port = [...s.portabilidade].sort((a, b) => a.parcela - b.parcela)[0];
    return {
      trocoCentavos: melhor ? reais(melhor.valorLiquido) : null,
      temPortabilidade: s.portabilidade.length > 0,
      parcelaPortabilidade: port ? port.parcela : null,
      motivo: melhor ? `${melhor.tabela}, troco ${melhor.valorLiquido}` : s.mensagem || "nenhuma tabela de refin da port",
    };
  },
};

// Banco de mentira, para testar o fluxo sem a Facta. O último dígito do CPF decide:
// 0 e 1 já autorizados; 9 celular ligado a outro CPF; os outros esperam o link.
// Depois de autorizar: 6 e 7 sem saldo, 8 erro, o resto com saldo.
const autorizadosNoSimulado = new Set<string>();

export const bancoSimulado: BancoClt & { autorizar(cpf: string): void; reiniciar(): void } = {
  nome: "Banco Simulado",

  autorizar(cpf) {
    autorizadosNoSimulado.add(cpf);
  },

  // Só para os testes: cada caso começa sem ninguém autorizado.
  reiniciar() {
    autorizadosNoSimulado.clear();
  },

  async solicitarAutorizacao({ cpf }) {
    const ultimo = Number(cpf[10]);
    if (ultimo === 9) return "telefone_de_outro_cpf";
    if (ultimo <= 1) {
      autorizadosNoSimulado.add(cpf);
      return "ja_autorizado";
    }
    return "enviada";
  },

  async consultar(cpf) {
    if (!autorizadosNoSimulado.has(cpf)) return { tipo: "nao_autorizado" };
    const ultimo = Number(cpf[10]);
    if (ultimo === 8) return { tipo: "erro", banco: this.nome, motivo: "tempo esgotado na consulta (simulado)" };
    if (ultimo >= 6) return { tipo: "sem_saldo", banco: this.nome, motivo: "margem insuficiente (simulado)" };
    const somaDigitos = [...cpf].reduce((s, d) => s + Number(d), 0);
    const valorCentavos = (1500 + ((somaDigitos * 431) % 9000)) * 100;
    const prazoMeses = [12, 24, 36, 48][Number(cpf[8]) % 4];
    // Juros fictícios de 2% ao mês, só para a parcela não sair absurda.
    const parcelaCentavos = Math.round((valorCentavos * (1 + 0.02 * prazoMeses)) / prazoMeses);
    return { tipo: "com_saldo", banco: this.nome, valorCentavos, parcelaCentavos, prazoMeses };
  },

  // Coeficiente parecido com o da Facta (1,85% em 84 meses), só para teste.
  async simularConsignado({ parcelaMaxima }) {
    const parcelaCentavos = Math.round(parcelaMaxima * REGRAS.folgaMargem * 100);
    const valorCentavos = Math.round(parcelaCentavos / 0.0245);
    const tabela = { codigoTabela: 1, prazo: 84, contrato: valorCentavos / 100, parcela: parcelaCentavos / 100, coeficiente: 0.0245 };
    return { tipo: "com_saldo", banco: this.nome, valorCentavos, parcelaCentavos, prazoMeses: 84, tabela, renda: 3000, especie: 42 };
  },

  // Troco fictício de 10% do saldo, só para teste.
  async simularPortabilidadeSiape({ contrato }) {
    const troco = Math.round((contrato.saldoDevedorEstimado ?? 0) * 10);
    return { trocoCentavos: troco || null, temPortabilidade: true, parcelaPortabilidade: contrato.parcela, motivo: "simulado" };
  },
};
