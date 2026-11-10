// O banco que a Maisa usa no CLT. O fluxo só conhece este formato: cada banco real
// traduz a resposta da API dele para cá.
import * as facta from "./facta.js";
import { REGRAS, avaliarVinculo } from "./regras.js";

export type ResultadoBanco =
  | { tipo: "com_saldo"; banco: string; valorCentavos: number; parcelaCentavos: number; prazoMeses: number }
  | { tipo: "sem_saldo"; banco: string; motivo: string }
  | { tipo: "erro"; banco: string; motivo: string };

export type ResultadoAutorizacao = facta.ResultadoAutorizacao;

// Antes de consultar, o cliente precisa autorizar num link que o banco manda.
export type ResultadoConsulta = { tipo: "nao_autorizado" } | { tipo: "indisponivel" } | ResultadoBanco;

export interface BancoClt {
  nome: string;
  solicitarAutorizacao(p: { cpf: string; nome: string; celular: string }): Promise<ResultadoAutorizacao>;
  consultar(cpf: string): Promise<ResultadoConsulta>;
}

const reais = (v: number) => Math.round(v * 100);

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

    // A oferta padrão é a de maior valor sem seguro. Seguro só se o consultor oferecer.
    const semSeguro = tabelas.filter((t) => t.valorSeguro === 0 && t.valorLiquido > 0);
    if (!semSeguro.length) {
      const motivo = tabelas.length ? "só há tabelas com seguro" : mensagem || "nenhuma tabela disponível";
      return { tipo: "sem_saldo", banco: this.nome, motivo };
    }
    const melhor = semSeguro.reduce((a, b) => (b.valorLiquido > a.valorLiquido ? b : a));
    return {
      tipo: "com_saldo",
      banco: this.nome,
      valorCentavos: reais(melhor.valorLiquido),
      parcelaCentavos: reais(melhor.parcela),
      prazoMeses: melhor.prazo,
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
};
