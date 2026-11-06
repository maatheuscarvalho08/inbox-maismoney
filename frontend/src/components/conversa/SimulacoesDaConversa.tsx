import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Calculator, Plus } from "../icones";
import { api, ApiError } from "../../lib/api";
import { formatarCentavos, paraCentavos } from "../../lib/propostas";
import { LABEL_RESULTADO, OPCOES_RESULTADO } from "../../lib/simulacoes";
import { Select } from "../Select";
import type { Conversa, ResultadoSimulacao, Simulacao } from "../../types/api";

const classeCampo = "w-full rounded-md border border-border bg-bg/60 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent";

export function SimulacoesDaConversa({ conversa, onConversaAtualizada }: { conversa: Conversa; onConversaAtualizada: (c: Conversa) => void }) {
  const [simulacoes, setSimulacoes] = useState<Simulacao[]>([]);
  const [criando, setCriando] = useState(false);
  const [banco, setBanco] = useState("");
  const [resultado, setResultado] = useState<ResultadoSimulacao>("sem_saldo");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await api.get<{ simulacoes: Simulacao[] }>(`/simulacoes?conversaId=${conversa.id}`);
    setSimulacoes(res.simulacoes);
  }, [conversa.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const valorCentavos = paraCentavos(valor);
    if (resultado === "com_saldo" && !valorCentavos) {
      setErro("Informe o valor disponível, por exemplo 1.500,00");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api.post("/simulacoes", { conversaId: conversa.id, banco, resultado, valorCentavos, motivo: motivo.trim() || null });
      setBanco("");
      setValor("");
      setMotivo("");
      setCriando(false);
      await carregar();
      const res = await api.get<{ conversa: Conversa }>(`/conversas/${conversa.id}`);
      onConversaAtualizada(res.conversa);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar a simulação");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <Calculator size={12} /> Simulações
        </p>
        {!criando && (
          <button onClick={() => setCriando(true)} aria-label="Nova simulação" className="flex items-center gap-1 text-xs text-accent hover:underline">
            <Plus size={11} /> Nova
          </button>
        )}
      </div>

      {criando && (
        <form onSubmit={salvar} className="mb-2 space-y-2 rounded-md border border-border bg-bg/40 p-3">
          <input autoFocus required placeholder="Banco" aria-label="Banco da simulação" maxLength={80} value={banco} onChange={(e) => setBanco(e.target.value)} className={classeCampo} />
          <Select value={resultado} onChange={(v) => setResultado(v as ResultadoSimulacao)} options={OPCOES_RESULTADO} />
          {resultado === "com_saldo" ? (
            <input required inputMode="decimal" placeholder="Valor disponível" aria-label="Valor disponível" value={valor} onChange={(e) => setValor(e.target.value)} className={classeCampo} />
          ) : (
            <input placeholder="Motivo" aria-label="Motivo" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={classeCampo} />
          )}
          {erro && <p role="alert" className="text-xs text-accent">{erro}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={salvando} className="flex-1 rounded-md bg-primary py-1.5 text-xs font-semibold text-marca-indigo hover:opacity-90 disabled:opacity-50">
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" onClick={() => setCriando(false)} className="flex-1 rounded-md border border-border py-1.5 text-xs text-muted hover:text-ink">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {simulacoes.length === 0 && !criando && <p className="text-xs text-muted">Nenhuma simulação nesta conversa.</p>}

      <div className="space-y-2">
        {simulacoes.map((s) => (
          <div key={s.id} className="rounded-md border border-border bg-bg/40 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-ink">{s.banco}</span>
              <span className="shrink-0 text-muted">{LABEL_RESULTADO[s.resultado]}</span>
            </div>
            {s.valorCentavos ? <p className="mt-1 font-semibold tabular-nums text-ink">{formatarCentavos(s.valorCentavos)}</p> : null}
            {s.motivo && <p className="mt-1 text-muted">{s.motivo}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
