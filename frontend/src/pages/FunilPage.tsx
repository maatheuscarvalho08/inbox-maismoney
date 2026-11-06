import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { LABEL_ETAPA, OPCOES_CONVENIO } from "../lib/funil";
import type { EtapaFunil } from "../types/api";

interface LinhaFunil {
  etapa: EtapaFunil;
  total: number;
  pctDoTopo: number;
  conversao: number | null;
  conversaoAnterior: number | null;
}

const PERIODOS = [7, 30, 90];
const MARGEM_PROXIMO_PP = 2;

function pct(valor: number) {
  return `${valor.toFixed(1).replace(".", ",")}%`;
}

function Comparacao({ conversao, anterior }: { conversao: number; anterior: number | null }) {
  if (anterior === null) return <span className="text-xs text-muted">Sem dados do período anterior</span>;
  const diferenca = conversao - anterior;
  const texto = `${diferenca > 0 ? "+" : ""}${diferenca.toFixed(1).replace(".", ",")} pp`;
  if (Math.abs(diferenca) < MARGEM_PROXIMO_PP) {
    return <span className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted">Estável {texto}</span>;
  }
  return diferenca > 0 ? (
    <span className="rounded border border-indigo-claro/30 bg-indigo-claro/10 px-2 py-0.5 text-xs font-medium text-indigo-claro">
      Melhorou {texto}
    </span>
  ) : (
    <span className="rounded border border-primary/30 bg-primary/15 px-2 py-0.5 text-xs font-medium text-accent">Piorou {texto}</span>
  );
}

export function FunilPage() {
  const [dias, setDias] = useState(30);
  const [convenio, setConvenio] = useState("");
  const [etapas, setEtapas] = useState<LinhaFunil[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ dias: String(dias) });
    if (convenio) params.set("convenio", convenio);
    api.get<{ etapas: LinhaFunil[] }>(`/funil?${params.toString()}`).then((res) => setEtapas(res.etapas));
  }, [dias, convenio]);

  // A etapa em que mais leads se perdem é a primeira coisa que vale olhar.
  const maiorPerda = useMemo(() => {
    const comPerda = (etapas ?? []).filter((e) => e.conversao !== null);
    return comPerda.length ? comPerda.reduce((pior, e) => ((e.conversao as number) < (pior.conversao as number) ? e : pior)) : null;
  }, [etapas]);

  return (
    <div>
      <PageHeader
        title="Funil"
        subtitle="Até onde chegam os leads que entraram no período"
        right={
          <div className="flex items-center gap-2">
            <Select
              value={convenio}
              onChange={setConvenio}
              options={[{ value: "", label: "Todos os convênios" }, ...OPCOES_CONVENIO]}
            />
            <div className="flex rounded-md border border-border p-0.5">
              {PERIODOS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDias(p)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${dias === p ? "bg-primary text-marca-indigo" : "text-muted hover:text-ink"}`}
                >
                  {p} dias
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="p-8">
        {!etapas && <p className="text-sm text-muted">Carregando...</p>}

        {etapas && etapas[0].total === 0 && (
          <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
            Nenhum lead entrou neste período.
          </p>
        )}

        {etapas && etapas[0].total > 0 && (
          <>
            {maiorPerda && (
              <p className="mb-4 text-sm text-ink">
                Maior perda: <strong className="font-semibold">{LABEL_ETAPA[maiorPerda.etapa]}</strong>, com{" "}
                {pct(maiorPerda.conversao as number)} de conversão da etapa anterior.
              </p>
            )}

            <div className="divide-y divide-border rounded-lg border border-border bg-surface">
              {etapas.map((e) => (
                <div key={e.etapa} className="px-6 py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-sm font-semibold text-ink">
                      {LABEL_ETAPA[e.etapa]} <span className="ml-1.5 text-lg font-bold tabular-nums">{e.total}</span>
                    </p>
                    <p className="text-xs tabular-nums text-muted">{pct(e.pctDoTopo)} dos leads</p>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                    <div className="funil-barra h-full rounded-full bg-primary" style={{ width: `${e.pctDoTopo}%` }} />
                  </div>

                  {e.conversao !== null && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>
                        Conversão da etapa: <strong className="font-semibold tabular-nums text-ink">{pct(e.conversao)}</strong>
                      </span>
                      <Comparacao conversao={e.conversao} anterior={e.conversaoAnterior} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
