// Confere o cálculo de margem e as possibilidades com extratos fictícios.
// Não chama a OpenAI: npm run extrato:testar
import assert from "node:assert/strict";
import { analisarExtrato } from "../modules/extratos/analise.js";
import type { ContratoLido, ExtratoLido } from "../modules/extratos/leitor.js";
import { buscarAlternativa } from "../modules/maisa/alternativas.js";
import { bancoSimulado } from "../modules/maisa/bancos.js";

const contrato = (c: Partial<ContratoLido>): ContratoLido => ({
  banco_codigo: "001",
  banco_nome: "Banco Fictício",
  numero: "123",
  tipo: "emprestimo",
  situacao: "ativo",
  parcela: 100,
  total_parcelas: 84,
  parcelas_pagas: 10,
  parcelas_restantes: null,
  inicio: "2025-01",
  fim: "2031-12",
  valor_emprestado: 5000,
  taxa_mensal: 1.66,
  ...c,
});

const extrato = (e: Partial<ExtratoLido>): ExtratoLido => ({
  tipo_documento: "inss",
  legivel: true,
  problemas: [],
  competencia: "2026-11",
  especie_codigo: 42,
  especie_descricao: "Aposentadoria por tempo de contribuição",
  bloqueado_emprestimo: false,
  data_nascimento: "1958-04-10",
  base_calculo: 3000,
  margens_informadas: { emprestimo: null, rmc: null, rcc: null },
  contratos: [],
  ...e,
});

const pos = (a: ReturnType<typeof analisarExtrato>, tipo: string) => a.possibilidades.find((p) => p.tipo === tipo)!;

const CASOS: [string, () => void | Promise<void>][] = [
  [
    "Sem margem: SIAPE com contrato portável simula port + refin e acha troco",
    async () => {
      const analise = analisarExtrato(
        extrato({
          tipo_documento: "siape",
          especie_codigo: null,
          margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 },
          contratos: [contrato({ banco_nome: "CAIXA", parcela: 400, parcelas_restantes: 70 })],
        }),
      );
      const alt = await buscarAlternativa({ convenio: "siape", analise, banco: bancoSimulado, cpf: "00000000000", dataNascimento: "1970-01-01" });
      assert.equal(alt?.operacao, "port_refin");
      assert.ok(alt?.trocoCentavos && alt.trocoCentavos > 0);
    },
  ],
  [
    "Sem margem: SIAPE com port mas sem tabela de refin vai para a equipe como portabilidade",
    async () => {
      const analise = analisarExtrato(
        extrato({
          tipo_documento: "siape",
          especie_codigo: null,
          margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 },
          contratos: [contrato({ banco_nome: "CAIXA", parcela: 400, parcelas_restantes: 70 })],
        }),
      );
      const semRefin = { ...bancoSimulado, simularPortabilidadeSiape: async () => ({ trocoCentavos: null, temPortabilidade: true, parcelaPortabilidade: 395, motivo: "sem tabela" }) };
      const alt = await buscarAlternativa({ convenio: "siape", analise, banco: semRefin, cpf: "00000000000", dataNascimento: "1953-01-01" });
      assert.equal(alt?.operacao, "portabilidade");
      assert.match(alt?.motivo ?? "", /cai para 395/);
    },
  ],
  [
    "Sem margem: SIAPE sem nenhuma tabela da Facta encerra",
    async () => {
      const analise = analisarExtrato(
        extrato({
          tipo_documento: "siape",
          especie_codigo: null,
          margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 },
          contratos: [contrato({ banco_nome: "CAIXA", parcela: 400, parcelas_restantes: 70 })],
        }),
      );
      const nada = { ...bancoSimulado, simularPortabilidadeSiape: async () => ({ trocoCentavos: null, temPortabilidade: false, parcelaPortabilidade: null, motivo: "sem tabela" }) };
      const alt = await buscarAlternativa({ convenio: "siape", analise, banco: nada, cpf: "00000000000", dataNascimento: "1953-01-01" });
      assert.equal(alt, null);
    },
  ],
  [
    "Sem margem e sem contrato para portar ou refinanciar: nenhuma alternativa",
    async () => {
      const analise = analisarExtrato(extrato({ margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 }, contratos: [] }));
      const alt = await buscarAlternativa({ convenio: "inss", analise, banco: bancoSimulado, cpf: "00000000000", dataNascimento: "1958-03-15" });
      assert.equal(alt, null);
    },
  ],
  [
    "Sem margem: INSS com contrato portável vai para a equipe simular a port",
    async () => {
      const analise = analisarExtrato(
        extrato({ margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 }, contratos: [contrato({ banco_nome: "BRADESCO", parcela: 300, parcelas_restantes: 60 })] }),
      );
      const alt = await buscarAlternativa({ convenio: "inss", analise, banco: bancoSimulado, cpf: "00000000000", dataNascimento: "1958-03-15" });
      assert.equal(alt?.operacao, "portabilidade");
    },
  ],
  [
    "SIAPE: contrato do Agibank com 119 restantes é novo demais para portar",
    () => {
      const a = analisarExtrato(
        extrato({
          tipo_documento: "siape",
          especie_codigo: null,
          margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 },
          contratos: [
            contrato({ banco_nome: "AGIBANK", parcela: 394.76, total_parcelas: null, parcelas_pagas: null, parcelas_restantes: 119, taxa_mensal: null }),
            contrato({ banco_nome: "AGIBANK", parcela: 394.76, total_parcelas: null, parcelas_pagas: null, parcelas_restantes: 90, taxa_mensal: null }),
          ],
        }),
      );
      const porta = pos(a, "portabilidade");
      assert.ok(porta.tipo === "portabilidade" && porta.contratos.length === 1, "só o com 30 pagas no máximo");
      assert.equal(porta.tipo === "portabilidade" && porta.contratos[0].parcelasRestantes, 90);
    },
  ],
  [
    "Portabilidade segue o roteiro: banco que não porta, mínimo de pagas e saldo mínimo",
    () => {
      const a = analisarExtrato(
        extrato({
          margens_informadas: { emprestimo: 0, rmc: 0, rcc: 0 },
          contratos: [
            contrato({ banco_nome: "BANCO INBURSA", parcela: 300, parcelas_restantes: 60 }),
            contrato({ banco_nome: "BANCO PAN", parcela: 300, parcelas_pagas: 10, parcelas_restantes: 60 }),
            contrato({ banco_nome: "CAIXA", parcela: 30, parcelas_restantes: 20, taxa_mensal: null }),
            contrato({ banco_nome: "CAIXA", parcela: 300, parcelas_pagas: null, parcelas_restantes: 60, taxa_mensal: null }),
          ],
        }),
      );
      const porta = pos(a, "portabilidade");
      assert.ok(porta.tipo === "portabilidade" && porta.contratos.length === 1, "só o da Caixa com saldo");
      assert.equal(porta.tipo === "portabilidade" && porta.contratos[0].parcelasRestantes, 60);
      assert.equal(pos(a, "novo").possivel, false);
      assert.equal(pos(a, "refin").possivel, false);
    },
  ],
  [
    "INSS comum: sobra margem de empréstimo e RCC, RMC já usado",
    () => {
      const a = analisarExtrato(
        extrato({
          margens_informadas: { emprestimo: 150, rmc: 0, rcc: 150 },
          contratos: [
            contrato({ banco_nome: "FACTA FINANCEIRA", parcela: 500, parcelas_pagas: 24, taxa_mensal: 2.1 }),
            contrato({ parcela: 400, parcelas_pagas: 5 }),
            contrato({ tipo: "rmc", parcela: 150, total_parcelas: null, parcelas_pagas: null }),
            contrato({ parcela: 999, situacao: "excluido" }),
          ],
        }),
      );
      assert.equal(a.margens.emprestimo.calculada, 150);
      assert.equal(a.confiavel, true);
      assert.equal(pos(a, "novo").possivel, true);
      assert.equal(pos(a, "cartao_rmc").possivel, false);
      assert.equal(pos(a, "cartao_rcc").possivel, true);
      const refin = pos(a, "refin");
      assert.ok(refin.tipo === "refin" && refin.contratos.length === 1, "só o contrato da Facta com 24 pagas");
      const porta = pos(a, "portabilidade");
      assert.ok(porta.tipo === "portabilidade" && porta.contratos.length === 1, "contrato da Facta não é portado");
      assert.ok(porta.contratos[0].saldoDevedorEstimado! > 0, "saldo estimado pela taxa");
    },
  ],
  [
    "LOAS 87: limite de 30% e RMC vetado",
    () => {
      const a = analisarExtrato(extrato({ especie_codigo: 87, base_calculo: 1518, contratos: [] }));
      assert.equal(a.margens.emprestimo.calculada, 455.4);
      assert.equal(pos(a, "cartao_rmc").possivel, false);
      assert.match(pos(a, "cartao_rmc").motivo, /LOAS/);
    },
  ],
  [
    "Benefício bloqueado não permite nada novo",
    () => {
      const a = analisarExtrato(extrato({ bloqueado_emprestimo: true }));
      assert.equal(pos(a, "novo").possivel, false);
      assert.ok(a.alertas.some((x) => x.includes("bloqueado")));
    },
  ],
  [
    "Comprometimento acima de 45% trava operação nova",
    () => {
      const a = analisarExtrato(extrato({ contratos: [contrato({ parcela: 1000 }), contrato({ parcela: 400 })] }));
      assert.equal(pos(a, "novo").possivel, false);
      assert.ok(a.alertas.some((x) => x.includes("Comprometimento")));
    },
  ],
  [
    "Margem informada diferente da calculada gera alerta e tira a confiança",
    () => {
      const a = analisarExtrato(extrato({ margens_informadas: { emprestimo: 900, rmc: null, rcc: null }, contratos: [contrato({ parcela: 500 })] }));
      assert.equal(a.margens.emprestimo.usada, 900);
      assert.equal(a.confiavel, false);
    },
  ],
  [
    "Parcela restante calculada pela data de fim quando não há parcelas pagas",
    () => {
      const a = analisarExtrato(
        extrato({ contratos: [contrato({ parcela: 300, total_parcelas: null, parcelas_pagas: null, fim: "2027-10" })] }),
      );
      const porta = pos(a, "portabilidade");
      assert.equal(porta.tipo === "portabilidade" && porta.contratos.length, 1);
      assert.equal(porta.tipo === "portabilidade" && porta.contratos[0].parcelasRestantes, 12);
    },
  ],
  [
    "SIAPE usa só as margens informadas quando não há base",
    () => {
      const a = analisarExtrato(
        extrato({ tipo_documento: "siape", especie_codigo: null, base_calculo: null, margens_informadas: { emprestimo: 320, rmc: 80, rcc: 80 } }),
      );
      assert.equal(a.convenio, "siape");
      assert.equal(pos(a, "novo").possivel, true);
      assert.ok(a.alertas.some((x) => x.includes("Base de cálculo")));
    },
  ],
  [
    "Documento ilegível vai para conferência manual",
    () => {
      const a = analisarExtrato(extrato({ legivel: false, problemas: ["imagem borrada"] }));
      assert.equal(a.confiavel, false);
      assert.equal(a.possibilidades.length, 0);
    },
  ],
];

let falhas = 0;
for (const [nome, teste] of CASOS) {
  try {
    await teste();
    console.log(`ok     ${nome}`);
  } catch (err) {
    falhas++;
    console.log(`FALHOU ${nome}: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`\n${CASOS.length - falhas} de ${CASOS.length} passaram`);
process.exit(falhas ? 1 : 0);
