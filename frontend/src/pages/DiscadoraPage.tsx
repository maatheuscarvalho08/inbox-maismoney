import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Plus } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { DiscagensAoVivo } from "../components/DiscagensAoVivo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { Campanha, StatusCampanha } from "../types/api";

type Aba = "campanhas" | "aovivo";

const STATUS_LABEL: Record<StatusCampanha, string> = {
  rascunho: "Rascunho",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  concluida: "Concluída",
};

const STATUS_STYLE: Record<StatusCampanha, string> = {
  rascunho: "border-border bg-border/60 text-muted",
  em_andamento: "border-primary/30 bg-primary/15 text-primary",
  pausada: "border-accent/30 bg-accent/15 text-[var(--color-accent-fg)]",
  concluida: "border-border bg-border/60 text-muted",
};

export function DiscadoraPage() {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("campanhas");

  function carregar() {
    api.get<{ campanhas: Campanha[] }>("/campanhas").then((res) => {
      setCampanhas(res.campanhas);
      setCarregando(false);
    });
  }

  useEffect(() => {
    carregar();
  }, []);

  useSocketEvent("campanha:atualizada", () => carregar());

  return (
    <div>
      <PageHeader
        title="Discadora"
        subtitle="Campanhas de ligação automática com IVR"
        right={
          <Link
            to="/discadora/nova"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
          >
            <Plus size={14} /> Nova campanha
          </Link>
        }
      />

      <div className="p-8">
        <div className="mb-6 flex items-center gap-1 border-b border-border">
          {(
            [
              { id: "campanhas", label: "Campanhas" },
              { id: "aovivo", label: "Discagens ao vivo" },
            ] satisfies { id: Aba; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                aba === t.id ? "border-primary text-white" : "border-transparent text-muted hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {aba === "aovivo" && <DiscagensAoVivo />}

        {aba === "campanhas" && (
          <>
            {!carregando && campanhas.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
                <Phone size={22} className="text-muted" />
                <p className="text-sm text-muted">Nenhuma campanha criada ainda.</p>
                <Link to="/discadora/nova" className="text-xs font-medium text-primary hover:underline">
                  Criar a primeira campanha
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {campanhas.map((c) => (
                <Link
                  key={c.id}
                  to={`/discadora/${c.id}`}
                  className="rounded-lg border border-border bg-surface p-4 hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{c.nome}</p>
                    <span
                      className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[c.status]}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {c.template?.nome} · {c.instancia?.numero}
                  </p>
                  <p className="mt-3 text-xs text-muted">{c.totalNumeros} número(s) na lista</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
