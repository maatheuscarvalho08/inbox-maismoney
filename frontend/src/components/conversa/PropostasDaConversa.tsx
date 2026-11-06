import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Plus } from "../icones";
import { api, ApiError } from "../../lib/api";
import { formatarCentavos, LABEL_STATUS_PROPOSTA, paraCentavos } from "../../lib/propostas";
import type { Conversa, Proposta } from "../../types/api";

const classeCampo = "w-full rounded-md border border-border bg-bg/60 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent";

export function PropostasDaConversa({ conversa }: { conversa: Conversa }) {
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [criando, setCriando] = useState(false);
  const [banco, setBanco] = useState("");
  const [valor, setValor] = useState("");
  const [parcela, setParcela] = useState("");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await api.get<{ propostas: Proposta[] }>(`/propostas?conversaId=${conversa.id}`);
    setPropostas(res.propostas);
  }, [conversa.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const valorCentavos = paraCentavos(valor);
    if (!valorCentavos) {
      setErro("Informe o valor da proposta, por exemplo 1.500,00");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api.post("/propostas", {
        conversaId: conversa.id,
        banco,
        valorCentavos,
        parcelaCentavos: paraCentavos(parcela),
        prazoMeses: Number(prazo) || null,
      });
      setBanco("");
      setValor("");
      setParcela("");
      setPrazo("");
      setCriando(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar a proposta");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <FileText size={12} /> Propostas
        </p>
        {!criando && (
          <button onClick={() => setCriando(true)} className="flex items-center gap-1 text-xs text-accent hover:underline">
            <Plus size={11} /> Nova
          </button>
        )}
      </div>

      {criando && (
        <form onSubmit={salvar} className="mb-2 space-y-2 rounded-md border border-border bg-bg/40 p-3">
          <input autoFocus required placeholder="Banco" aria-label="Banco" maxLength={80} value={banco} onChange={(e) => setBanco(e.target.value)} className={classeCampo} />
          <input required inputMode="decimal" placeholder="Valor, ex.: 1.500,00" aria-label="Valor" value={valor} onChange={(e) => setValor(e.target.value)} className={classeCampo} />
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="Parcela" aria-label="Parcela" value={parcela} onChange={(e) => setParcela(e.target.value)} className={classeCampo} />
            <input inputMode="numeric" placeholder="Prazo (meses)" aria-label="Prazo em meses" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={classeCampo} />
          </div>
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

      {propostas.length === 0 && !criando && <p className="text-xs text-muted">Nenhuma proposta nesta conversa.</p>}

      <div className="space-y-2">
        {propostas.map((p) => (
          <div key={p.id} className="rounded-md border border-border bg-bg/40 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-ink">{p.banco}</span>
              <span className="shrink-0 text-muted">{LABEL_STATUS_PROPOSTA[p.status]}</span>
            </div>
            <p className="mt-1 font-semibold tabular-nums text-ink">{formatarCentavos(p.valorCentavos)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
