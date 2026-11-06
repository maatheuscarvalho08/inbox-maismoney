import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { LABEL_CONVENIO } from "../lib/funil";
import { formatarCentavos } from "../lib/propostas";
import { LABEL_RESULTADO, OPCOES_RESULTADO } from "../lib/simulacoes";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import type { ResultadoSimulacao, Simulacao } from "../types/api";

interface Resumo {
  bancos: { banco: string; total: number; comSaldo: number }[];
  motivos: { motivo: string; quantidade: number }[];
}

const COLUNAS = ["Cliente", "Banco", "Convênio", "Resultado", "Valor disponível", "Motivo", "Responsável", "Data"];

const COR_RESULTADO: Record<ResultadoSimulacao, string> = {
  com_saldo: "border-indigo-claro/30 bg-indigo-claro/10 text-indigo-claro",
  sem_saldo: "border-border text-muted",
  erro: "border-primary/30 bg-primary/15 text-accent",
};

export function SimulacoesPage() {
  const [filtro, setFiltro] = useState<ResultadoSimulacao | "">("");
  const [simulacoes, setSimulacoes] = useState<Simulacao[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  useEffect(() => {
    api.get<{ simulacoes: Simulacao[]; resumo: Resumo }>(`/simulacoes${filtro ? `?resultado=${filtro}` : ""}`).then((res) => {
      setSimulacoes(res.simulacoes);
      setResumo(res.resumo);
    });
  }, [filtro]);

  return (
    <div>
      <PageHeader title="Simulações" subtitle="Resultado por banco e motivos de recusa" />

      <div className="space-y-5 p-8">
        {resumo && resumo.bancos.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">Taxa de saldo por banco</h2>
              <div className="mt-3 space-y-3">
                {resumo.bancos.map((b) => {
                  const taxa = (b.comSaldo / b.total) * 100;
                  return (
                    <div key={b.banco}>
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate font-medium text-ink">{b.banco}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {b.comSaldo} de {b.total} · {taxa.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                        <div className="funil-barra h-full rounded-full bg-primary" style={{ width: `${taxa}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-ink">Principais motivos de falta de saldo</h2>
              {resumo.motivos.length === 0 ? (
                <p className="mt-3 text-xs text-muted">Nenhum motivo registrado ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {resumo.motivos.map((m) => (
                    <li key={m.motivo} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-ink">{m.motivo}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-ink">{m.quantidade}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="w-52">
          <Select
            value={filtro}
            onChange={(v) => setFiltro(v as ResultadoSimulacao | "")}
            options={[{ value: "", label: "Todos os resultados" }, ...OPCOES_RESULTADO]}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[960px] text-left text-sm">
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
              {!simulacoes && (
                <tr>
                  <td colSpan={COLUNAS.length} className="px-5 py-8 text-center text-muted">Carregando...</td>
                </tr>
              )}
              {simulacoes?.length === 0 && (
                <tr>
                  <td colSpan={COLUNAS.length} className="px-5 py-10 text-center text-muted">
                    {filtro ? "Nenhuma simulação com esse resultado." : "Nenhuma simulação ainda. Registre a primeira em Mais opções, dentro da conversa."}
                  </td>
                </tr>
              )}
              {simulacoes?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3">
                    <Link to={`/conversas/${s.conversa.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                      {s.conversa.contato.nome ?? s.conversa.contato.numeroWhatsapp}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink">{s.banco}</td>
                  <td className="px-5 py-3 text-muted">{s.convenio ? LABEL_CONVENIO[s.convenio] : "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${COR_RESULTADO[s.resultado]}`}>{LABEL_RESULTADO[s.resultado]}</span>
                  </td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-ink">{s.valorCentavos ? formatarCentavos(s.valorCentavos) : "—"}</td>
                  <td className="max-w-56 truncate px-5 py-3 text-muted">{s.motivo ?? "—"}</td>
                  <td className="px-5 py-3 text-muted">{s.operador?.nome ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-muted">{new Date(s.createdAt).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
