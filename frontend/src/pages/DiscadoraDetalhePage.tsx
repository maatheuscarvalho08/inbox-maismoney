import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { Campanha, StatusLigacao } from "../types/api";

const LIGACAO_LABEL: Record<StatusLigacao, string> = {
  pendente: "Pendente",
  discando: "Discando",
  atendeu: "Atendeu",
  nao_atendeu: "Não atendeu",
  ocupado: "Ocupado",
  erro: "Erro",
};

const LIGACAO_STYLE: Record<StatusLigacao, string> = {
  pendente: "text-muted",
  discando: "text-[var(--color-accent-fg)]",
  atendeu: "text-primary",
  nao_atendeu: "text-muted",
  ocupado: "text-muted",
  erro: "text-primary",
};

function Card({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-4 backdrop-blur-xl">
      <p className="text-2xl font-bold text-white">{valor}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

export function DiscadoraDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  function carregar() {
    if (!id) return;
    api.get<{ campanha: Campanha }>(`/campanhas/${id}`).then((res) => setCampanha(res.campanha));
  }

  useEffect(() => {
    carregar();
  }, [id]);

  useSocketEvent<Campanha>("campanha:atualizada", (payload) => {
    if (payload.id === id) setCampanha(payload);
  });

  async function iniciar() {
    if (!id) return;
    setErro(null);
    setProcessando(true);
    try {
      await api.post(`/campanhas/${id}/iniciar`);
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível iniciar a campanha");
    } finally {
      setProcessando(false);
    }
  }

  async function pausar() {
    if (!id) return;
    setErro(null);
    setProcessando(true);
    try {
      await api.post(`/campanhas/${id}/pausar`);
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível pausar a campanha");
    } finally {
      setProcessando(false);
    }
  }

  if (!campanha) {
    return <div className="p-8 text-sm text-muted">Carregando...</div>;
  }

  const resumo = campanha.resumo;
  const progresso = resumo && resumo.total > 0 ? Math.round(((resumo.total - resumo.pendente - resumo.discando) / resumo.total) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={campanha.nome}
        subtitle={`${campanha.template?.nome} · ${campanha.instancia?.numero}`}
        right={
          <div className="flex items-center gap-2">
            {(campanha.status === "rascunho" || campanha.status === "pausada") && (
              <button
                onClick={iniciar}
                disabled={processando || campanha.totalNumeros === 0}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
              >
                <Play size={14} /> {campanha.status === "pausada" ? "Retomar" : "Iniciar"}
              </button>
            )}
            {campanha.status === "em_andamento" && (
              <button
                onClick={pausar}
                disabled={processando}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-white hover:border-primary disabled:opacity-50"
              >
                <Pause size={14} /> Pausar
              </button>
            )}
          </div>
        }
      />

      <div className="p-8">
        {erro && <p className="mb-4 text-sm text-primary">{erro}</p>}

        {resumo && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Total" valor={resumo.total} />
              <Card label="Discando" valor={resumo.discando} />
              <Card label="Atendeu" valor={resumo.atendeu} />
              <Card label="Converteu (apertou 1)" valor={resumo.convertido} />
              <Card label="Não atendeu" valor={resumo.naoAtendeu} />
              <Card label="Erro" valor={resumo.erro} />
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-primary transition-all duration-300 ease-out" style={{ width: `${progresso}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">{progresso}% concluído</p>
          </>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-surface/40 backdrop-blur-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Número</th>
                <th className="px-4 py-3">Contato</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Apertou 1</th>
                <th className="px-4 py-3">HSM disparado</th>
              </tr>
            </thead>
            <tbody>
              {campanha.numeros?.map((n) => (
                <tr key={n.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-white">{n.numeroWhatsapp}</td>
                  <td className="px-4 py-2.5 text-muted">{n.nomeContato ?? "—"}</td>
                  <td className={`px-4 py-2.5 font-medium ${LIGACAO_STYLE[n.statusLigacao]}`}>{LIGACAO_LABEL[n.statusLigacao]}</td>
                  <td className="px-4 py-2.5 text-muted">{n.apertou1 ? "Sim" : "Não"}</td>
                  <td className="px-4 py-2.5 text-muted">{n.hsmDisparado ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
