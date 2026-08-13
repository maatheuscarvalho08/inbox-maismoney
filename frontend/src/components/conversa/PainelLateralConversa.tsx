import { useEffect, useState, type FormEvent } from "react";
import { X, Tag as TagIcon, Smartphone } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import type { Conversa, Etiqueta } from "../../types/api";

const LABEL_CONEXAO: Record<string, string> = {
  evolution: "Evolution API",
  meta_cloud: "Meta Cloud API",
};

interface PainelLateralProps {
  conversa: Conversa;
  onFechar: () => void;
  onConversaAtualizada: (conversa: Conversa) => void;
}

export function PainelLateralConversa({ conversa, onFechar, onConversaAtualizada }: PainelLateralProps) {
  const [etiquetasDisponiveis, setEtiquetasDisponiveis] = useState<Etiqueta[]>([]);
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ etiquetas: Etiqueta[] }>("/etiquetas").then((res) => setEtiquetasDisponiveis(res.etiquetas));
  }, []);

  async function adicionarEtiqueta(e: FormEvent) {
    e.preventDefault();
    const nome = novaEtiqueta.trim();
    if (!nome) return;

    setEnviando(true);
    setErro(null);
    try {
      const { etiqueta } = await api.post<{ etiqueta: Etiqueta }>("/etiquetas", { nome });
      const res = await api.post<{ conversa: Conversa }>(`/conversas/${conversa.id}/etiquetas`, {
        etiquetaId: etiqueta.id,
      });
      onConversaAtualizada(res.conversa);
      setNovaEtiqueta("");
      setEtiquetasDisponiveis((atual) => (atual.some((et) => et.id === etiqueta.id) ? atual : [...atual, etiqueta]));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível adicionar a etiqueta");
    } finally {
      setEnviando(false);
    }
  }

  async function removerEtiqueta(etiquetaId: string) {
    const res = await api.delete<{ conversa: Conversa }>(`/conversas/${conversa.id}/etiquetas/${etiquetaId}`);
    onConversaAtualizada(res.conversa);
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-surface/40 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-white">Mais opções</p>
        <button onClick={onFechar} className="text-muted hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-6 overflow-y-auto p-4">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Smartphone size={12} /> Número
          </p>
          <div className="rounded-md border border-border bg-bg/40 p-3">
            <p className="text-sm font-medium text-white">{conversa.instancia.nome}</p>
            <p className="mt-0.5 text-xs text-muted">{conversa.instancia.numero}</p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted">{LABEL_CONEXAO[conversa.instancia.tipoConexao]}</span>
              <span className="flex items-center gap-1.5 text-muted">
                <span
                  className={`size-1.5 rounded-full ${
                    conversa.instancia.status === "conectado" ? "bg-primary" : "bg-muted"
                  }`}
                />
                {conversa.instancia.status === "conectado" ? "Conectado" : "Desconectado"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <TagIcon size={12} /> Etiquetas
          </p>

          <div className="flex flex-wrap gap-1.5">
            {conversa.etiquetas.length === 0 && <p className="text-xs text-muted">Nenhuma etiqueta ainda.</p>}
            {conversa.etiquetas.map(({ etiqueta }) => (
              <span
                key={etiqueta.id}
                className="flex items-center gap-1 rounded border border-primary/30 bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {etiqueta.nome}
                <button onClick={() => removerEtiqueta(etiqueta.id)} className="hover:text-white">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>

          <form onSubmit={adicionarEtiqueta} className="mt-3">
            <input
              list="etiquetas-existentes"
              value={novaEtiqueta}
              onChange={(e) => setNovaEtiqueta(e.target.value)}
              placeholder="Nova etiqueta..."
              className="w-full rounded-md border border-border bg-bg/60 px-3 py-1.5 text-xs text-white outline-none focus:border-primary"
            />
            <datalist id="etiquetas-existentes">
              {etiquetasDisponiveis.map((et) => (
                <option key={et.id} value={et.nome} />
              ))}
            </datalist>
            {erro && <p className="mt-1 text-xs text-primary">{erro}</p>}
            <button
              type="submit"
              disabled={enviando || !novaEtiqueta.trim()}
              className="mt-2 w-full rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              Adicionar
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
