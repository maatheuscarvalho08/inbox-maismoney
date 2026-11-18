// Sexo pelo primeiro nome, para não perguntar o óbvio. Só responde quando o nome é claro.
// Nome que serve para os dois (Darci, Ariel, Andrea...) ou desconhecido: null, e a Maisa
// pergunta. O cliente confere o sexo no resumo antes do contrato.
const AMBIGUOS = new Set([
  "DARCI", "DARCY", "ARIEL", "ANDREA", "ANDREIA", "JACI", "JURACI", "ALDACI", "DENI", "RENE", "ALI", "JOSUE",
  "CRIS", "DANI", "GABI", "ALEX", "SASHA", "IVANI", "ADAIR", "DALVA", "NOEL", "MARI", "LUCI", "CLAUDE", "JEAN",
  "IRANI", "ELI", "ELY", "SIDNEY", "WILLIAN", "KELLY", "KELI", "DIONE", "ARACI", "IRACI", "NILSA", "JOSA",
]);
const MASCULINOS = new Set([
  "JOSE", "LUIZ", "LUIS", "JOAO", "RAFAEL", "MANOEL", "MANUEL", "DANIEL", "GABRIEL", "MIGUEL", "SAMUEL", "ISRAEL",
  "ABEL", "CARLOS", "MARCOS", "LUCAS", "MATHEUS", "MATEUS", "JONAS", "ELIAS", "MOISES", "TOMAS", "THOMAS", "NICOLAS",
  "JORGE", "HENRIQUE", "ANDRE", "FELIPE", "FILIPE", "ALEXANDRE", "VICENTE", "GUILHERME", "JAIME", "JOAQUIM",
  "CEZAR", "CESAR", "VALTER", "WALTER", "NILTON", "MILTON", "AFONSO", "DAVI", "DAVID", "LEVI", "RUI", "ADEMIR",
  "VALMIR", "ALMIR", "OSMAR", "OMAR", "EDMAR", "DIMAS", "BRAZ", "BRAS", "ARTUR", "ARTHUR", "VITOR", "VICTOR",
  "HEITOR", "IGOR", "NESTOR", "OSCAR", "EDGAR", "WAGNER", "RENAN", "ALAN", "ALLAN", "IVAN", "JULIAN", "ADRIAN",
  "BENJAMIN", "RUBENS", "LUAN", "JHONATAN", "JONATHAN", "NATAN", "ERIC", "ERICK", "PATRICK", "FREDERICO",
  "LUCA", "NICOLA", "JOSHUA", "BATISTA", "ISAIAS", "MESSIAS", "ADAO", "SEBASTIAO", "ESTEVAO", "CRISTIANO",
  "EDUARDO", "RONALDO", "GERALDO", "EDNALDO", "WILSON", "NELSON", "EDSON", "ANDERSON", "JEFFERSON", "EMERSON",
]);
const FEMININOS = new Set([
  "ISABEL", "RAQUEL", "IVONE", "SIMONE", "ROSE", "ALICE", "BEATRIZ", "NAIR", "NOEMI", "RUTH", "RUTE", "ESTHER",
  "ESTER", "LIZ", "INES", "MIRIAM", "CARMEN", "SUELI", "SUELY", "NEIDE", "CLEIDE", "DIRCE", "LOURDES", "MERCEDES",
  "IRENE", "LEONOR", "ELIZABETH", "ISABELLE", "GISELE", "MICHELE", "LILIAN", "VIVIAN", "MARIAN", "CRISTIANE",
  "ELIANE", "JOSIANE", "DAIANE", "ARIANE", "LUCIANE", "TATIANE", "SOCORRO", "CONCEICAO", "APARECIDA", "LUZ",
  "DORIS", "ADELE", "SOLANGE", "ROSANE", "JANE", "JANETE", "IVETE", "CLARICE", "EUNICE", "BERENICE", "NICE",
  "HELOISE", "ELOISE", "KAREN", "KATIA", "ELLEN", "HELEN", "SHIRLEY", "MARLY", "MARLI", "NELI", "NELY", "ZULEIDE",
  "DARLETE", "ARLETE", "GRACE", "INGRID", "ASTRID", "MADALENA", "ODETE", "MARINETE", "CLOTILDE", "MATILDE", "HILDA", "EDILEUZA", "ELIZETE", "LIDIANE",
]);
const MASC_FIM = /(O|OS|SON|TON|ALDO|ARDO|BERTO|ILDO|IR)$/;
const FEM_FIM = /(A|ANE|IANE|ETE|ETTE|ICE|ILDE|ENE|LENE|EIDE|ELMA|ELIA)$/;

export function sexoPeloNome(nomeCompleto: string | undefined | null): "M" | "F" | null {
  const primeiro = (nomeCompleto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().split(/\s+/)[0] ?? "";
  if (primeiro.length < 3 || AMBIGUOS.has(primeiro)) return null;
  if (MASCULINOS.has(primeiro)) return "M";
  if (FEMININOS.has(primeiro)) return "F";
  if (MASC_FIM.test(primeiro)) return "M";
  if (FEM_FIM.test(primeiro)) return "F";
  return null;
}
