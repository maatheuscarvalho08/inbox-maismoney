// Devolve para a Maisa as conversas que ela passou para a fila por engano: dúvida sem
// resposta pronta logo na primeira mensagem, sem atendente e sem resposta da equipe.
// Usa a própria API, como o botão "Devolver para a Maisa", para a tela atualizar na hora.
// Uso: node dist/scripts/devolverParaMaisa.js            (só lista)
//      node dist/scripts/devolverParaMaisa.js --aplicar  (devolve)
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

const aplicar = process.argv.includes("--aplicar");
const desde = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const candidatas = await prisma.conversa.findMany({
  where: {
    comMaisa: false,
    operadorId: null,
    status: { not: "encerrada" },
    instancia: { maisaAtiva: true },
    lastMessageAt: { gte: desde },
    maisaEstado: { path: ["saida"], equals: "duvida" },
    mensagens: { none: { remetenteTipo: "operador" } },
  },
  select: { id: true, maisaEstado: true, contato: { select: { nome: true } } },
});
const conversas = candidatas.filter((c) => (c.maisaEstado as { paradaEm?: string } | null)?.paradaEm === "inicio");

console.log(`${conversas.length} conversa(s) para devolver:`);
for (const c of conversas) console.log(`- ${c.id} ${(c.contato.nome ?? "").split(" ")[0]}`);

if (aplicar && conversas.length) {
  const admin = await prisma.usuario.findFirst({ where: { role: "admin", ativo: true } });
  if (!admin) throw new Error("Nenhum admin ativo");
  const token = jwt.sign({ sub: admin.id, role: admin.role }, env.JWT_SECRET, { expiresIn: "5m" });
  for (const c of conversas) {
    const r = await fetch(`http://localhost:${env.PORT}/api/conversas/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ comMaisa: true }),
    });
    console.log(`${c.id}: HTTP ${r.status}`);
  }
}

await prisma.$disconnect();
