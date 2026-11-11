// Guarda a análise dos extratos que a Maisa leu antes de a análise ser guardada.
// Só arquivos que ainda estão no disco (os de mais de 4 dias de inatividade já sumiram).
// Para não ler foto de RG como extrato, só vale o arquivo que a Maisa respondeu com
// oferta, falta de margem, extrato inválido ou recusa do banco.
// Uso: node dist/scripts/analisarExtratosAntigos.js            (só lista)
//      node dist/scripts/analisarExtratosAntigos.js --aplicar  (lê e guarda)
import { prisma } from "../db/prisma.js";
import { FORMATOS_EXTRATO, lerArquivo, parcelaPeloExtrato } from "../modules/maisa/midia.js";
import { guardarAnalise } from "../modules/extratos/guardadas.js";
import { TEXTOS } from "../modules/maisa/textos.js";

const aplicar = process.argv.includes("--aplicar");

type Convenio = "inss" | "siape";

// O que a Maisa respondeu logo depois do arquivo diz se ela leu como extrato.
function respostaDeExtrato(texto: string): Convenio | "?" | null {
  if (texto === TEXTOS.extratoInvalido("inss")) return "inss";
  if (texto === TEXTOS.extratoInvalido("siape")) return "siape";
  if (texto.startsWith("Boa notícia!")) {
    if (texto.includes("no seu benefício")) return "inss";
    if (texto.includes("no seu contracheque")) return "siape";
    return null; // CLT
  }
  if (texto === TEXTOS.semMargemExtrato || texto === TEXTOS.semSaldo || texto === TEXTOS.erroBanco) return "?";
  return null;
}

const arquivos = await prisma.mensagem.findMany({
  where: {
    remetenteTipo: "cliente",
    tipoMidia: { in: FORMATOS_EXTRATO },
    midiaDeleted: false,
    midiaPath: { not: null },
    analiseExtrato: null,
  },
  select: {
    id: true,
    conversaId: true,
    timestamp: true,
    midiaPath: true,
    tipoMidia: true,
    conversa: { select: { maisaEstado: true } },
  },
  orderBy: { timestamp: "asc" },
});

const fila: { id: string; midiaPath: string; tipo: string; convenio: Convenio }[] = [];
let semConvenio = 0;
for (const m of arquivos) {
  const seguinte = await prisma.mensagem.findFirst({
    where: { conversaId: m.conversaId, remetenteTipo: "maisa", timestamp: { gt: m.timestamp } },
    orderBy: { timestamp: "asc" },
    select: { conteudoTexto: true },
  });
  const pista = respostaDeExtrato(seguinte?.conteudoTexto ?? "");
  if (!pista) continue;
  const produto = (m.conversa.maisaEstado as { produto?: string } | null)?.produto;
  const convenio = pista !== "?" ? pista : produto === "inss" || produto === "siape" ? produto : null;
  if (!convenio) {
    semConvenio++;
    continue;
  }
  fila.push({ id: m.id, midiaPath: m.midiaPath!, tipo: m.tipoMidia!, convenio });
}

console.log(`${fila.length} extrato(s) para analisar. ${semConvenio} sem convênio conhecido, ficam de fora.`);
for (const f of fila) console.log(`- mensagem ${f.id} ${f.convenio}`);

if (aplicar) {
  for (const f of fila) {
    try {
      const { registro } = await parcelaPeloExtrato(await lerArquivo(f.midiaPath), f.tipo, f.convenio);
      await guardarAnalise(f.id, registro);
      console.log(`ok ${f.id}`);
    } catch (err) {
      console.error(`falhou ${f.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

await prisma.$disconnect();
