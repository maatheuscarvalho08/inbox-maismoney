import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { LABEL_CONVENIO } from "../lib/funil";
import { formatarCentavos, LABEL_STATUS_PROPOSTA, OPCOES_STATUS_PROPOSTA } from "../lib/propostas";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import type { Proposta, StatusProposta } from "../types/api";

interface TotalStatus {
  status: StatusProposta;
  quantidade: number;
  valorCentavos: number;
}

const COLUNAS = ["Cliente", "Banco", "Convênio", "Valor", "Parcela", "Responsável", "Data", "Status"];

function rotuloPropostas(quantidade: number) {
  return `${quantidade} ${quantidade === 1 ? "proposta" : "propostas"}`;
}

export function PropostasPage() {
  const [filtro, setFiltro] = useState<StatusProposta | "">("");
  const [propostas, setPropostas] = useState<Proposta[] | null>(null);
  const [totais, setTotais] = useState<TotalStatus[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await api.get<{ propostas: Proposta[]; totais: TotalStatus[] }>(`/propostas${filtro ? `?status=${filtro}` : ""}`);
    setPropostas(res.propostas);
    setTotais(res.totais);
  }, [filtro]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function atualizar(id: string, dados: { status?: string; motivoRecusa?: string | null }) {
    setErro(null);
    try {
      await api.patch(`/propostas/${id}`, dados);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível atualizar a proposta");
    }
  }

  const total = (status: StatusProposta) => totais.find((t) => t.status === status);
  const emAndamento = (["digitada", "em_analise", "aprovada"] as const).map(total);
  const qtdAndamento = emAndamento.reduce((soma, t) => soma + (t?.quantidade ?? 0), 0);
  const valorAndamento = emAndamento.reduce((soma, t) => soma + (t?.valorCentavos ?? 0), 0);

  return (
    <div>
      <PageHeader title="Propostas" subtitle="Acompanhe cada proposta, da digitação ao pagamento" />

      <div className="space-y-5 p-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium text-muted">Em andamento</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatarCentavos(valorAndamento)}</p>
            <p className="mt-0.5 text-xs text-muted">{rotuloPropostas(qtdAndamento)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium text-muted">Pagas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatarCentavos(total("paga")?.valorCentavos ?? 0)}</p>
            <p className="mt-0.5 text-xs text-muted">{rotuloPropostas(total("paga")?.quantidade ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-medium text-muted">Recusadas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{total("recusada")?.quantidade ?? 0}</p>
            <p className="mt-0.5 text-xs text-muted">{formatarCentavos(total("recusada")?.valorCentavos ?? 0)}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="w-52">
            <Select
              value={filtro}
              onChange={(v) => setFiltro(v as StatusProposta | "")}
              options={[{ value: "", label: "Todos os status" }, ...OPCOES_STATUS_PROPOSTA]}
            />
          </div>
          {erro && <p role="alert" className="text-sm font-medium text-accent">{erro}</p>}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {COLUNAS.map((c) => (
                  <th key={c} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!propostas && (
                <tr>
                  <td colSpan={COLUNAS.length} className="px-5 py-8 text-center text-muted">Carregando...</td>
                </tr>
              )}
              {propostas?.length === 0 && (
                <tr>
                  <td colSpan={COLUNAS.length} className="px-5 py-10 text-center text-muted">
                    {filtro
                      ? `Nenhuma proposta ${LABEL_STATUS_PROPOSTA[filtro].toLowerCase()}.`
                      : "Nenhuma proposta ainda. Registre a primeira em Mais opções, dentro da conversa."}
                  </td>
                </tr>
              )}
              {propostas?.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <Link to={`/conversas/${p.conversa.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                      {p.conversa.contato.nome ?? p.conversa.contato.numeroWhatsapp}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink">{p.banco}</td>
                  <td className="px-5 py-3 text-muted">{p.convenio ? LABEL_CONVENIO[p.convenio] : "—"}</td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-ink">{formatarCentavos(p.valorCentavos)}</td>
                  <td className="px-5 py-3 tabular-nums text-muted">
                    {p.parcelaCentavos ? `${p.prazoMeses ? `${p.prazoMeses}x ` : ""}${formatarCentavos(p.parcelaCentavos)}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted">{p.operador?.nome ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-muted">{new Date(p.createdAt).toLocaleDateString("pt-BR")}</td>
                  <td className="w-52 px-5 py-3">
                    <Select value={p.status} onChange={(status) => atualizar(p.id, { status })} options={OPCOES_STATUS_PROPOSTA} />
                    {p.status === "recusada" && (
                      <input
                        key={p.motivoRecusa ?? ""}
                        defaultValue={p.motivoRecusa ?? ""}
                        placeholder="Motivo da recusa"
                        aria-label="Motivo da recusa"
                        maxLength={200}
                        onBlur={(e) => {
                          const motivo = e.target.value.trim() || null;
                          if (motivo !== p.motivoRecusa) atualizar(p.id, { motivoRecusa: motivo });
                        }}
                        className="mt-1.5 w-full rounded-md border border-border bg-bg/60 px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
