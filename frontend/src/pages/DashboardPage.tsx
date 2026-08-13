import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useClock } from "../lib/useClock";
import { api } from "../lib/api";
import { calcularDelta } from "../lib/metricasDelta";
import { formatarSegundos } from "../lib/tempoRelativo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { PageHeader } from "../components/PageHeader";
import { MetricCard } from "../components/dashboard/MetricCard";
import { SparklineLine, SparklineBars } from "../components/dashboard/Sparkline";
import { MiniProgressBar } from "../components/dashboard/MiniProgressBar";
import { MetaIndicator } from "../components/dashboard/MetaIndicator";
import { ConversasRecentesSection } from "../components/dashboard/ConversasRecentesSection";
import type { Conversa } from "../types/api";

interface ResumoDashboard {
  conversasAbertas: number;
  naoRespondidas: number;
  percentualNaoRespondidas: number;
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

const META_TEMPO_RESPOSTA_SEGUNDOS = 5 * 60;

export function DashboardPage() {
  const { usuario } = useAuth();
  const agora = useClock();

  const [resumo, setResumo] = useState<ResumoDashboard | null>(null);
  const [historico, setHistorico] = useState<HistoricoDiario | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [resumoRes, historicoRes, conversasRes] = await Promise.all([
      api.get<ResumoDashboard>("/metricas/resumo"),
      api.get<HistoricoDiario>("/metricas/historico-diario"),
      api.get<{ conversas: Conversa[] }>("/conversas"),
    ]);
    setResumo(resumoRes);
    setHistorico(historicoRes);
    setConversas(conversasRes.conversas.slice(0, 5));
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useSocketEvent("mensagem:nova", () => carregar());
  useSocketEvent("conversa:atualizada", () => carregar());

  const deltaConversas = historico ? calcularDelta(historico.conversasAbertas) : null;
  const deltaAtendimentos = historico ? calcularDelta(historico.atendimentosConcluidos) : null;
  const deltaTempo = historico ? calcularDelta(historico.tempoMedioSegundos) : null;

  return (
    <div>
      <PageHeader title={`Olá, ${usuario?.nome}`} subtitle="Visão geral do atendimento" right={agora} />

      <div className="space-y-6 p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Conversas abertas"
            value={carregando ? "—" : String(resumo?.conversasAbertas ?? 0)}
            deltaLabel={deltaConversas ? `${deltaConversas.diff >= 0 ? "+" : ""}${deltaConversas.diff} vs ontem` : undefined}
            deltaDirection={deltaConversas?.direction}
          >
            {historico && <SparklineLine data={historico.conversasAbertas} color="var(--color-primary)" />}
          </MetricCard>

          <MetricCard label="Não respondidas" value={carregando ? "—" : String(resumo?.naoRespondidas ?? 0)}>
            <MiniProgressBar
              percentual={resumo?.percentualNaoRespondidas ?? 0}
              caption={`${resumo?.percentualNaoRespondidas ?? 0}% do total em aberto`}
            />
          </MetricCard>

          <MetricCard
            label="Atendimentos hoje"
            value={carregando ? "—" : String(resumo?.atendimentosHoje ?? 0)}
            deltaLabel={
              deltaAtendimentos ? `${deltaAtendimentos.diff >= 0 ? "+" : ""}${deltaAtendimentos.diff} vs ontem` : undefined
            }
            deltaDirection={deltaAtendimentos?.direction}
          >
            {historico && <SparklineBars data={historico.atendimentosConcluidos} color="var(--color-primary)" />}
          </MetricCard>

          <MetricCard
            label="Tempo médio de resposta"
            value={carregando ? "—" : formatarSegundos(resumo?.tempoMedioSegundos ?? 0)}
            deltaLabel={deltaTempo ? `${formatarSegundos(Math.abs(deltaTempo.diff))} vs ontem` : undefined}
            deltaDirection={deltaTempo?.direction}
          >
            <MetaIndicator
              meta={`Meta: < ${META_TEMPO_RESPOSTA_SEGUNDOS / 60} min`}
              dentroDaMeta={(resumo?.tempoMedioSegundos ?? 0) <= META_TEMPO_RESPOSTA_SEGUNDOS}
            />
          </MetricCard>
        </div>

        <ConversasRecentesSection conversas={conversas} carregando={carregando} />
      </div>
    </div>
  );
}
