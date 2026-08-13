import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatarMes(chave: string) {
  const [, mes] = chave.split("-");
  return MESES_ABREV[Number(mes) - 1] ?? chave;
}

export function VolumeMensagensCard({ dados }: { dados: { mes: string; total: number }[] }) {
  const total = dados.reduce((acc, m) => acc + m.total, 0);
  const chartData = dados.map((d) => ({ mes: formatarMes(d.mes), total: d.total }));

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Volume de mensagens</h2>
          <p className="mt-1 text-xl font-bold text-white">{total.toLocaleString("pt-BR")}</p>
        </div>
        <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted">Últimos 12 meses</span>
      </div>

      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "var(--color-border)" }}
              contentStyle={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-muted)" }}
              itemStyle={{ color: "var(--color-white)" }}
              formatter={(value) => [Number(value).toLocaleString("pt-BR"), "Mensagens"]}
            />
            <Bar dataKey="total" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
