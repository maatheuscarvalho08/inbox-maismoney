export interface MetaProgresso {
  label: string;
  atual: string;
  meta: string;
  percentual: number;
}

export function MetasProgressCard({ dados }: { dados: MetaProgresso[] }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">Metas do time</h2>

      <div className="mt-4 space-y-4">
        {dados.map((meta) => (
          <div key={meta.label}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink">{meta.label}</span>
              <span className="text-muted">
                {meta.atual} / {meta.meta}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(meta.percentual, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
