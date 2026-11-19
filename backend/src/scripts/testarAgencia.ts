// Agência para a Facta: 4 dígitos, sem o dígito verificador. Casos reais dos contracheques.
// Uso: npx tsx src/scripts/testarAgencia.ts
import assert from "node:assert/strict";
import { agenciaSemDigito } from "../modules/maisa/agencia.js";

const CASOS: [string | null, string | null][] = [
  ["002836", "0283"], ["000817", "0081"], ["00250X", "0250"], ["036005", "3600"], ["043270", "4327"], ["009261", "0926"],
  ["040924", "4092"], ["40924", "4092"], ["2893-2", "2893"], ["2893-X", "2893"], ["4086", "4086"], ["8529", "8529"], ["6408", "6408"],
  ["817", "0817"], ["12", null], ["", null], [null, null], ["123456", null], ["ag 4086", "4086"],
];
let ok = 0;
for (const [entrada, esperado] of CASOS) {
  assert.equal(agenciaSemDigito(entrada), esperado, String(entrada));
  ok++;
}
console.log(`${ok} de ${CASOS.length} passaram`);
