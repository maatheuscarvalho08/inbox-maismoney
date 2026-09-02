import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Select } from "./Select";
import type { Conversa, Instancia } from "../types/api";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriada: (conversa: Conversa) => void;
}

export function NovaConversaModal({ aberto, onFechar, onCriada }: Props) {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  const [numero, setNumero] = useState("");
  const [nomeContato, setNomeContato] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    api.get<{ instancias: Instancia[] }>("/instancias").then((res) => {
      setInstancias(res.instancias);
      setInstanciaId((atual) => atual || res.instancias[0]?.id || "");
    });
  }, [aberto]);

  if (!aberto) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!instanciaId) {
      setErro("Selecione o número de origem");
      return;
    }
    setEnviando(true);
    try {
      const res = await api.post<{ conversa: Conversa }>("/conversas", {
        instanciaId,
        numeroWhatsapp: numero.replace(/\D/g, ""),
        nomeContato: nomeContato.trim() || undefined,
      });
      onCriada(res.conversa);
      setNumero("");
      setNomeContato("");
      onFechar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar a conversa");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-white">Nova conversa</p>
          <button onClick={onFechar} className="text-muted hover:text-white">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Select
            value={instanciaId}
            onChange={setInstanciaId}
            options={instancias.map((i) => ({ value: i.id, label: `${i.nome} · ${i.numero}` }))}
          />

          <input
            required
            autoFocus
            placeholder="Número (5521999999999)"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />

          <input
            placeholder="Nome do contato (opcional)"
            value={nomeContato}
            onChange={(e) => setNomeContato(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />

          {erro && <p className="text-xs text-primary">{erro}</p>}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? "Criando..." : "Iniciar conversa"}
          </button>
        </form>
      </div>
    </div>
  );
}
