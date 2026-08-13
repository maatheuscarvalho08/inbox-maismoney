import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const CORES = [
  "var(--color-primary)",
  "color-mix(in oklab, var(--color-primary) 55%, white)",
  "color-mix(in oklab, var(--color-primary) 40%, var(--color-border))",
];

interface OperadorAtendimentos {
  operadorId: string | null;
  nome: string;
  total: number;
}

export function AtendimentosPorOperadorCard({ dados }: { dados: OperadorAtendimentos[] }) {
  const total = dados.reduce((acc, o) => acc + o.total, 0);

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-white">Atendimentos por operador</h2>
        <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted">Total</span>
      </div>

      {total === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border p-8 text-center text-sm text-muted">
          Nenhum atendimento registrado ainda.
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-6">
          <div className="relative h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dados}
                  dataKey="total"
                  nameKey="nome"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {dados.map((entry, i) => (
                    <Cell key={entry.operadorId ?? entry.nome} fill={CORES[i % CORES.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--color-muted)" }}
                  itemStyle={{ color: "var(--color-white)" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-white">{total}</span>
              <span className="text-[10px] text-muted">Total</span>
            </div>
          </div>

          <div className="flex-1 space-y-3">
            {dados.map((op, i) => (
              <div key={op.operadorId ?? op.nome} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-white">
                  <span className="size-2 rounded-full" style={{ backgroundColor: CORES[i % CORES.length] }} />
                  {op.nome}
                </span>
                <span className="text-muted">
                  {op.total} · {Math.round((op.total / total) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
