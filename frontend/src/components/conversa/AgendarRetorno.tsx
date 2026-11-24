import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { dataDoRetorno } from "../../lib/retornos";
import { Modal } from "../Modal";
import type { Conversa } from "../../types/api";

// Combina com o cliente o dia para a equipe chamar de novo. Quando chega, o aviso aparece no topo do inbox.
export function AgendarRetorno({ conversa, onSalvo }: { conversa: Conversa; onSalvo: (c: Conversa) => void }) {
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  async function salvar(valor: string | null) {
    setSalvando(true);
    setErro(null);
    try {
      // 9h em Brasília (12h UTC): o aviso aparece quando a equipe começa o dia.
      const r = await api.patch<{ conversa: Conversa }>(`/conversas/${conversa.id}`, { retornoEm: valor ? `${valor}T12:00:00.000Z` : null });
      onSalvo(r.conversa);
      setAberto(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar o retorno");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setData(conversa.retornoEm ? conversa.retornoEm.slice(0, 10) : "");
          setAberto(true);
        }}
        className="h-8 rounded-md border border-border px-3 text-xs font-semibold text-muted hover:text-ink"
        title="Combinar o dia para chamar o cliente de novo"
      >
        {conversa.retornoEm ? `Retorno ${dataDoRetorno(conversa.retornoEm)}` : "Agendar retorno"}
      </button>
      {aberto && (
        <Modal onClose={() => setAberto(false)}>
          <div className="space-y-3 p-5 text-left">
            <h2 className="text-base font-semibold text-ink">Agendar retorno</h2>
            <p className="text-xs text-muted">No dia escolhido, o inbox mostra um aviso para a equipe chamar este cliente.</p>
            <label className="block text-xs font-medium text-muted">
              Dia
              <input
                type="date"
                min={amanha}
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            {erro && <p className="text-xs text-accent">{erro}</p>}
            <div className="flex justify-end gap-2 pt-1">
              {conversa.retornoEm && (
                <button onClick={() => salvar(null)} disabled={salvando} className="mr-auto rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-ink">
                  Cancelar retorno
                </button>
              )}
              <button onClick={() => setAberto(false)} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-ink">
                Fechar
              </button>
              <button
                onClick={() => salvar(data)}
                disabled={salvando || !data}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-marca-indigo hover:opacity-90 disabled:opacity-50"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
