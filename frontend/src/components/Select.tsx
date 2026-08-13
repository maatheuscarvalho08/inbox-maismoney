import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function Select({ value, onChange, options, className = "", disabled, placeholder }: SelectProps) {
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

  const selecionado = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs font-medium outline-none transition-colors duration-150 ease-out disabled:opacity-50 ${
          aberto ? "border-primary text-white" : "border-border text-white hover:border-primary/60"
        } bg-bg/60`}
      >
        <span className="truncate">{selecionado ? selecionado.label : (placeholder ?? "Selecione...")}</span>
        <ChevronDown size={12} className={`shrink-0 text-muted transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full min-w-max overflow-y-auto rounded-md border border-white/10 bg-surface p-1 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setAberto(false);
              }}
              className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors duration-150 ease-out ${
                opt.value === value ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
