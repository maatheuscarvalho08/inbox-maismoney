import { useEffect, useRef, useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

interface FiltroDropdownProps {
  label: string;
  icon: LucideIcon;
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
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 ease-out ${
          selecionado || aberto
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted hover:text-white"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          <Icon size={11} />
          {itemAtivo ? itemAtivo.label : label}
        </span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-white/10 bg-surface p-2 shadow-xl">
          <button
            onClick={() => {
              onSelecionar(null);
              setAberto(false);
            }}
            className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
              selecionado === null ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"
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
                selecionado === item.id ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"
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
