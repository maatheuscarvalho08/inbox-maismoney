import type { StatusConversa } from "../../types/api";

const LABELS: Record<StatusConversa, string> = {
  aberta: "Aberta",
  em_atendimento: "Em atendimento",
  aguardando: "Aguardando",
  encerrada: "Encerrada",
};

const DOT_COLOR: Record<StatusConversa, string> = {
  aberta: "bg-primary",
  em_atendimento: "bg-accent",
  aguardando: "bg-primary",
  encerrada: "bg-muted",
};

export function DistribuicaoStatusCard({ dados }: { dados: { status: StatusConversa; total: number }[] }) {
  const total = dados.reduce((acc, s) => acc + s.total, 0);

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-white">Distribuição por status</h2>

      {total === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
          Nenhuma conversa ainda.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {dados.map((s) => (
            <div key={s.status} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-white">
                <span className={`size-2 rounded-full ${DOT_COLOR[s.status]}`} />
                {LABELS[s.status]}
              </span>
              <span className="text-muted">
                {s.total} · {Math.round((s.total / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
