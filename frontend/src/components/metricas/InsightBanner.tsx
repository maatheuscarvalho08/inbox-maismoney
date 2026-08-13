import { TrendingUp } from "lucide-react";

export function InsightBanner({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/10 p-5 backdrop-blur-xl sm:flex-row sm:items-center">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
          <TrendingUp size={18} strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">Resumo do período</p>
          <p className="mt-1 max-w-lg text-sm text-muted">{mensagem}</p>
        </div>
      </div>

      <button className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
        Exportar relatório
      </button>
    </div>
  );
}
