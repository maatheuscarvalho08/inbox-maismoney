import { useCallback, useEffect, useState } from "react";
import { MessageSquare, CheckCircle2, Percent, Clock } from "lucide-react";
import { api } from "../lib/api";
import { formatarSegundos } from "../lib/tempoRelativo";
import { calcularDelta } from "../lib/metricasDelta";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/metricas/StatCard";
import { VolumeMensagensCard } from "../components/metricas/VolumeMensagensCard";
import { AtendimentosPorOperadorCard } from "../components/metricas/AtendimentosPorOperadorCard";
import { TempoRespostaCard } from "../components/metricas/TempoRespostaCard";
import { MetasProgressCard, type MetaProgresso } from "../components/metricas/MetasProgressCard";
import { DistribuicaoStatusCard } from "../components/metricas/DistribuicaoStatusCard";
import { InsightBanner } from "../components/metricas/InsightBanner";
import type { StatusConversa } from "../types/api";

interface ResumoMetricas {
  conversasAbertas: number;
  naoRespondidas: number;
  percentualNaoRespondidas: number;
  percentualRespondidasEm1h: number;
  atendimentosHoje: number;
  atendimentosMes: number;
  totalMensagensMes: number;
  tempoMedioSegundos: number;
}

interface HistoricoDiario {
  dias: string[];
  mensagens: number[];
  conversasAbertas: number[];
  atendimentosConcluidos: number[];
  tempoMedioSegundos: number[];
}

const META_ATENDIMENTOS_MES = 700;
const META_TEMPO_RESPOSTA_SEGUNDOS = 5 * 60;

export function MetricasPage() {
  const [resumo, setResumo] = useState<ResumoMetricas | null>(null);
  const [historico, setHistorico] = useState<HistoricoDiario | null>(null);
  const [volume, setVolume] = useState<{ mes: string; total: number }[]>([]);
  const [operadores, setOperadores] = useState<{ operadorId: string | null; nome: string; total: number }[]>([]);
  const [distribuicao, setDistribuicao] = useState<{ status: StatusConversa; total: number }[]>([]);

  const carregar = useCallback(async () => {
    const [resumoRes, historicoRes, volumeRes, operadoresRes, distribuicaoRes] = await Promise.all([
      api.get<ResumoMetricas>("/metricas/resumo"),
      api.get<HistoricoDiario>("/metricas/historico-diario"),
      api.get<{ volume: { mes: string; total: number }[] }>("/metricas/volume-mensagens"),
      api.get<{ operadores: { operadorId: string | null; nome: string; total: number }[] }>(
        "/metricas/atendimentos-por-operador",
      ),
      api.get<{ distribuicao: { status: StatusConversa; total: number }[] }>("/metricas/distribuicao-status"),
    ]);
    setResumo(resumoRes);
    setHistorico(historicoRes);
    setVolume(volumeRes.volume);
    setOperadores(operadoresRes.operadores);
    setDistribuicao(distribuicaoRes.distribuicao);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useSocketEvent("mensagem:nova", () => carregar());
  useSocketEvent("conversa:atualizada", () => carregar());

  if (!resumo || !historico) {
    return (
      <div>
        <PageHeader title="Métricas" subtitle="Visão detalhada de atendimento" />
        <div className="p-8 text-sm text-muted">Carregando...</div>
      </div>
    );
  }

  const deltaMensagens = calcularDelta(historico.mensagens);
  const deltaAtendimentos = calcularDelta(historico.atendimentosConcluidos);
  const deltaTempo = calcularDelta(historico.tempoMedioSegundos);

  const metas: MetaProgresso[] = [
    {
      label: "Tempo médio de resposta",
      atual: formatarSegundos(resumo.tempoMedioSegundos),
      meta: `${META_TEMPO_RESPOSTA_SEGUNDOS / 60} min`,
      percentual: resumo.tempoMedioSegundos > 0
        ? Math.min(100, Math.round((META_TEMPO_RESPOSTA_SEGUNDOS / resumo.tempoMedioSegundos) * 100))
        : 100,
    },
    {
      label: "Respondidas em até 1h",
      atual: `${resumo.percentualRespondidasEm1h}%`,
      meta: "90%",
      percentual: Math.round((resumo.percentualRespondidasEm1h / 90) * 100),
    },
    {
      label: "Atendimentos no mês",
      atual: String(resumo.atendimentosMes),
      meta: String(META_ATENDIMENTOS_MES),
      percentual: Math.round((resumo.atendimentosMes / META_ATENDIMENTOS_MES) * 100),
    },
  ];

  const insight =
    resumo.tempoMedioSegundos > 0 && resumo.tempoMedioSegundos <= META_TEMPO_RESPOSTA_SEGUNDOS
      ? `Tempo médio de resposta em ${formatarSegundos(resumo.tempoMedioSegundos)}, dentro da meta de ${META_TEMPO_RESPOSTA_SEGUNDOS / 60} min. ${resumo.percentualRespondidasEm1h}% das respostas saem em até 1h.`
      : resumo.tempoMedioSegundos > META_TEMPO_RESPOSTA_SEGUNDOS
        ? `Tempo médio de resposta em ${formatarSegundos(resumo.tempoMedioSegundos)}, acima da meta de ${META_TEMPO_RESPOSTA_SEGUNDOS / 60} min. Vale reforçar o time nos horários de pico.`
        : "Ainda sem dados suficientes de resposta este mês para gerar um resumo.";

  return (
    <div>
      <PageHeader
        title="Métricas"
        subtitle="Visão detalhada de atendimento"
        right={<span className="rounded-md border border-border px-2.5 py-1 text-xs">Últimos 30 dias</span>}
      />

      <div className="space-y-4 p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={MessageSquare}
            label="Mensagens no mês"
            value={resumo.totalMensagensMes.toLocaleString("pt-BR")}
            trendLabel={deltaMensagens ? `${deltaMensagens.diff >= 0 ? "+" : ""}${deltaMensagens.diff} vs ontem` : undefined}
            trendDirection={deltaMensagens?.direction}
            sparkline={historico.mensagens}
          />
          <StatCard
            icon={CheckCircle2}
            label="Atendimentos concluídos"
            value={String(resumo.atendimentosMes)}
            trendLabel={
              deltaAtendimentos ? `${deltaAtendimentos.diff >= 0 ? "+" : ""}${deltaAtendimentos.diff} vs ontem` : undefined
            }
            trendDirection={deltaAtendimentos?.direction}
            sparkline={historico.atendimentosConcluidos}
          />
          <StatCard icon={Percent} label="Não respondidas" value={`${resumo.percentualNaoRespondidas}%`} />
          <StatCard
            icon={Clock}
            label="Tempo médio de resposta"
            value={formatarSegundos(resumo.tempoMedioSegundos)}
            trendLabel={deltaTempo ? `${formatarSegundos(Math.abs(deltaTempo.diff))} vs ontem` : undefined}
            trendDirection={deltaTempo?.direction}
            sparkline={historico.tempoMedioSegundos}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <VolumeMensagensCard dados={volume} />
          </div>
          <AtendimentosPorOperadorCard dados={operadores} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <DistribuicaoStatusCard dados={distribuicao} />
          <TempoRespostaCard dias={historico.dias} valores={historico.tempoMedioSegundos} />
          <MetasProgressCard dados={metas} />
        </div>

        <InsightBanner mensagem={insight} />
      </div>
    </div>
  );
}
