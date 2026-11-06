import { useEffect, useRef, useState } from "react";
import { ChevronDown, type Icone } from "./icones";

interface FiltroDropdownProps {
  label: string;
  icon: Icone;
  itens: { id: string; label: string }[];
  selecionado: string | null;
  onSelecionar: (id: string | null) => void;
}

export function FiltroDropdown({ label, icon: Icon, itens, selecionado, onSelecionar }: FiltroDropdownProps) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fecharSeFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", fecharSeFora);
    return () => document.removeEventListener("mousedown", fecharSeFora);
  }, []);

  const itemAtivo = itens.find((i) => i.id === selecionado);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border h-8 px-2.5 text-xs font-medium transition-colors duration-150 ease-out ${
          selecionado || aberto
            ? "border-primary bg-primary/10 text-accent"
            : "border-border text-muted hover:text-ink"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon size={13} className="shrink-0" />
          <span className="truncate">{itemAtivo ? itemAtivo.label : label}</span>
        </span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-ink/10 bg-surface p-2 shadow-xl">
          <button
            onClick={() => {
              onSelecionar(null);
              setAberto(false);
            }}
            className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
              selecionado === null ? "bg-primary/10 text-accent" : "text-ink hover:bg-ink/5"
            }`}
          >
            Todos
          </button>

          {itens.length === 0 && <p className="px-2 py-1.5 text-xs text-muted">Nada disponível.</p>}

          {itens.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onSelecionar(item.id);
                setAberto(false);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
                selecionado === item.id ? "bg-primary/10 text-accent" : "text-ink hover:bg-ink/5"
              }`}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
