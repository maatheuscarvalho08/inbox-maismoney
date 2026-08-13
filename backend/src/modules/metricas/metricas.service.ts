import { prisma } from "../../db/prisma.js";

function inicioDoMes() {
  const data = new Date();
  data.setDate(1);
  data.setHours(0, 0, 0, 0);
  return data;
}

function inicioDoDia(data = new Date()) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

function chaveDia(data: Date) {
  return data.toISOString().slice(0, 10);
}

async function calcularDeltasResposta(desde: Date) {
  const mensagens = await prisma.mensagem.findMany({
    where: { timestamp: { gte: desde } },
    orderBy: [{ conversaId: "asc" }, { timestamp: "asc" }],
    select: { conversaId: true, remetenteTipo: true, timestamp: true },
  });

  const deltas: { timestamp: Date; segundos: number }[] = [];
  let ultimaDoCliente: { conversaId: string; timestamp: Date } | null = null;

  for (const m of mensagens) {
    if (m.remetenteTipo === "cliente") {
      ultimaDoCliente = { conversaId: m.conversaId, timestamp: m.timestamp };
    } else if (ultimaDoCliente && ultimaDoCliente.conversaId === m.conversaId) {
      deltas.push({ timestamp: m.timestamp, segundos: (m.timestamp.getTime() - ultimaDoCliente.timestamp.getTime()) / 1000 });
      ultimaDoCliente = null;
    }
  }

  return deltas;
}

export async function resumoMetricas() {
  const inicioMes = inicioDoMes();
  const hoje = inicioDoDia();

  const [totalMensagensMes, atendimentosMes, atendimentosHoje, conversasEmAberto, deltas] = await Promise.all([
    prisma.mensagem.count({ where: { createdAt: { gte: inicioMes } } }),
    prisma.conversa.count({ where: { status: "encerrada", createdAt: { gte: inicioMes } } }),
    prisma.conversa.count({ where: { status: "encerrada", createdAt: { gte: hoje } } }),
    prisma.conversa.findMany({
      where: { status: { not: "encerrada" } },
      include: { mensagens: { take: 1, orderBy: { timestamp: "desc" } } },
    }),
    calcularDeltasResposta(inicioMes),
  ]);

  const naoRespondidas = conversasEmAberto.filter((c) => c.mensagens[0]?.remetenteTipo === "cliente").length;
  const percentualNaoRespondidas = conversasEmAberto.length
    ? Math.round((naoRespondidas / conversasEmAberto.length) * 1000) / 10
    : 0;
  const tempoMedioSegundos = deltas.length
    ? Math.round(deltas.reduce((a, b) => a + b.segundos, 0) / deltas.length)
    : 0;
  const percentualRespondidasEm1h = deltas.length
    ? Math.round((deltas.filter((d) => d.segundos <= 3600).length / deltas.length) * 100)
    : 100;

  return {
    conversasAbertas: conversasEmAberto.length,
    naoRespondidas,
    percentualNaoRespondidas,
    percentualRespondidasEm1h,
    atendimentosHoje,
    atendimentosMes,
    totalMensagensMes,
    tempoMedioSegundos,
  };
}

export async function historicoDiario(dias = 8) {
  const desde = new Date();
  desde.setDate(desde.getDate() - (dias - 1));
  desde.setHours(0, 0, 0, 0);

  const diasArr = Array.from({ length: dias }, (_, i) => {
    const d = new Date(desde);
    d.setDate(d.getDate() + i);
    return chaveDia(d);
  });

  const bucket = (itens: { createdAt: Date }[]) => {
    const mapa = new Map(diasArr.map((d) => [d, 0]));
    for (const item of itens) {
      const chave = chaveDia(item.createdAt);
      if (mapa.has(chave)) mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    }
    return diasArr.map((d) => mapa.get(d) ?? 0);
  };

  const [mensagens, conversasNovas, conversasEncerradas, deltas] = await Promise.all([
    prisma.mensagem.findMany({ where: { createdAt: { gte: desde } }, select: { createdAt: true } }),
    prisma.conversa.findMany({ where: { createdAt: { gte: desde } }, select: { createdAt: true } }),
    prisma.conversa.findMany({
      where: { status: "encerrada", createdAt: { gte: desde } },
      select: { createdAt: true },
    }),
    calcularDeltasResposta(desde),
  ]);

  const somaTempoPorDia = new Map(diasArr.map((d) => [d, { soma: 0, n: 0 }]));
  for (const delta of deltas) {
    const chave = chaveDia(delta.timestamp);
    const atual = somaTempoPorDia.get(chave);
    if (atual) {
      atual.soma += delta.segundos;
      atual.n += 1;
    }
  }

  return {
    dias: diasArr,
    mensagens: bucket(mensagens),
    conversasAbertas: bucket(conversasNovas),
    atendimentosConcluidos: bucket(conversasEncerradas),
    tempoMedioSegundos: diasArr.map((d) => {
      const { soma, n } = somaTempoPorDia.get(d)!;
      return n ? Math.round(soma / n) : 0;
    }),
  };
}

export async function volumeMensagensPorMes(meses = 12) {
  const desde = new Date();
  desde.setMonth(desde.getMonth() - (meses - 1));
  desde.setDate(1);
  desde.setHours(0, 0, 0, 0);

  const mensagens = await prisma.mensagem.findMany({
    where: { createdAt: { gte: desde } },
    select: { createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (const m of mensagens) {
    const chave = `${m.createdAt.getFullYear()}-${String(m.createdAt.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(chave, (buckets.get(chave) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, total]) => ({ mes, total }));
}

export async function atendimentosPorOperador() {
  const grupos = await prisma.conversa.groupBy({
    by: ["operadorId"],
    where: { operadorId: { not: null } },
    _count: { _all: true },
  });

  const ids = grupos.map((g) => g.operadorId).filter((id): id is string => Boolean(id));
  const operadores = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });

  return grupos.map((g) => ({
    operadorId: g.operadorId,
    nome: operadores.find((o) => o.id === g.operadorId)?.nome ?? "Desconhecido",
    total: g._count._all,
  }));
}

export async function distribuicaoPorStatus() {
  const grupos = await prisma.conversa.groupBy({ by: ["status"], _count: { _all: true } });
  return grupos.map((g) => ({ status: g.status, total: g._count._all }));
}
