// Replay: perguntas reais que foram para a fila, agora com a ficha do cliente e o modelo de
// verdade. Só lê: não manda nada a ninguém. Uso: npx tsx src/scripts/replayRespostaLivre.ts <estados.txt>
// estados.txt: uma linha por conversa, "nome|<maisa_estado em JSON>".
import { readFileSync } from "node:fs";
import { fichaCliente, type EstadoMaisa } from "../modules/maisa/fluxo.js";
import { responderLivre } from "../modules/maisa/intencao.js";

const linhas = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const estados = linhas.map((l) => {
  const i = l.indexOf("|");
  return { nome: l.slice(0, i), estado: JSON.parse(l.slice(i + 1)) as EstadoMaisa };
});
const de = (nome: string, saida: string) => {
  const e = estados.find((x) => x.nome === nome && x.estado.saida === saida)?.estado;
  if (!e) throw new Error(`sem estado de ${nome} ${saida}`);
  return { ...e, etapa: e.paradaEm ?? "inicio" } as EstadoMaisa;
};

const CASOS: { nome: string; saida: string; pergunta: string; texto: string }[] = [
  { nome: "Gelcylene", saida: "duvida", pergunta: "Me conta: qual é o seu vínculo?", texto: "Qual seria o banco?" },
  { nome: "Paulo", saida: "duvida", pergunta: "Me conta: qual é o seu vínculo?", texto: "As margens dos cartões não consegue fazer?" },
  { nome: "GUERREIRO", saida: "duvida", pergunta: "Me conta: qual é o seu vínculo?", texto: "VC PODE VER SE TENHO ALGUM DIREITO A ESTA MARGEM ?" },
  { nome: "IRIMARQUE", saida: "objecao", pergunta: "Quer seguir com a portabilidade? Responda SIM ou NÃO.", texto: "Qual banco vai ficar o contrato e quanto cai na minha conta?" },
  { nome: "IRIMARQUE", saida: "objecao", pergunta: "Quer seguir com a portabilidade? Responda SIM ou NÃO.", texto: "E os contratos do QI e do C6, dá pra fazer?" },
  { nome: "Carlos", saida: "objecao", pergunta: "Quer seguir com a portabilidade? Responda SIM ou NÃO.", texto: "E o contrato do BRB, dá pra fazer?" },
  { nome: "Carlos", saida: "objecao", pergunta: "Quer seguir com a portabilidade? Responda SIM ou NÃO.", texto: "Qual a taxa de juros?" },
];

for (const c of CASOS) {
  const estado = de(c.nome, c.saida);
  const ficha = fichaCliente(estado);
  const t0 = Date.now();
  const r = await responderLivre(c.texto, estado.etapa, estado.produto, c.pergunta, ficha, "").catch((e) => `ERRO ${e.message}`);
  console.log(`\n## ${c.nome} (${estado.etapa}) ${Date.now() - t0}ms\nficha: ${ficha.replace(/\n/g, " | ").slice(0, 400)}\ncliente: ${c.texto}\nmaisa:   ${r ?? "(null: iria para a equipe)"}`);
}
