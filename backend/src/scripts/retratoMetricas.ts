// Grava uma foto das métricas atuais na tabela metricas_retratos.
// Uso: node dist/scripts/retratoMetricas.js "antes da Maisa"
import { prisma } from "../db/prisma.js";
import {
  atendimentosPorOperador,
  distribuicaoPorStatus,
  historicoDiario,
  resumoMetricas,
  volumeMensagensPorMes,
} from "../modules/metricas/metricas.service.js";

const rotulo = process.argv[2] ?? "retrato";
const trintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const [resumo, diario, porMes, porOperador, porStatus, porRemetente, conversas30d] = await Promise.all([
  resumoMetricas(),
  historicoDiario(30),
  volumeMensagensPorMes(12),
  atendimentosPorOperador(),
  distribuicaoPorStatus(),
  prisma.mensagem.groupBy({ by: ["remetenteTipo"], where: { timestamp: { gte: trintaDias } }, _count: true }),
  prisma.conversa.count({ where: { createdAt: { gte: trintaDias } } }),
]);

const dados = {
  geradoEm: new Date().toISOString(),
  resumo,
  ultimos30Dias: {
    conversasNovas: conversas30d,
    mensagensPorRemetente: Object.fromEntries(porRemetente.map((r) => [r.remetenteTipo, r._count])),
  },
  diario,
  porMes,
  porOperador,
  porStatus,
};

const salvo = await prisma.metricaRetrato.create({ data: { rotulo, dados: JSON.parse(JSON.stringify(dados)) } });
console.log(JSON.stringify({ id: salvo.id, rotulo, ...dados }, null, 2));
await prisma.$disconnect();
