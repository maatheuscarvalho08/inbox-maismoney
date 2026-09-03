import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Plus, Tag } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Etiqueta } from "../types/api";

interface EtiquetaFiltroDropdownProps {
  etiquetas: Etiqueta[];
  selecionada: string | null;
  onSelecionar: (etiquetaId: string | null) => void;
  onCriada: (etiqueta: Etiqueta) => void;
}

export function EtiquetaFiltroDropdown({ etiquetas, selecionada, onSelecionar, onCriada }: EtiquetaFiltroDropdownProps) {
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fecharSeFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
        setCriando(false);
      }
    }
    document.addEventListener("mousedown", fecharSeFora);
    return () => document.removeEventListener("mousedown", fecharSeFora);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setErro(null);
    try {
      const res = await api.post<{ etiqueta: Etiqueta }>("/etiquetas", { nome: nome.trim() });
      onCriada(res.etiqueta);
      setNome("");
      setCriando(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar a etiqueta");
    }
  }

  const etiquetaAtiva = etiquetas.find((et) => et.id === selecionada);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out ${
          selecionada || aberto
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted hover:text-white"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <Tag size={11} className="shrink-0" />
          <span className="truncate">{etiquetaAtiva ? etiquetaAtiva.nome : "Etiquetas"}</span>
        </span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-white/10 bg-surface p-2 shadow-xl">
          <button
            onClick={() => {
              onSelecionar(null);
              setAberto(false);
            }}
            className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
              selecionada === null ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"
            }`}
          >
            Todas etiquetas
          </button>

          {etiquetas.map((et) => (
            <button
              key={et.id}
              onClick={() => {
                onSelecionar(et.id);
                setAberto(false);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
                selecionada === et.id ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"
              }`}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              {et.nome}
            </button>
          ))}

          <div className="mt-1 border-t border-border pt-1">
            {criando ? (
              <form onSubmit={handleSubmit} className="px-1 py-1">
                <input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome da etiqueta"
                  className="w-full rounded-md border border-border bg-bg/60 px-2 py-1.5 text-xs text-white outline-none focus:border-primary"
                />
                {erro && <p className="mt-1 text-[10px] text-primary">{erro}</p>}
              </form>
            ) : (
              <button
                onClick={() => setCriando(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/10"
              >
                <Plus size={12} /> Nova etiqueta
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
