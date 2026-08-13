import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatarSegundos } from "../../lib/tempoRelativo";

const DIAS_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatarDia(chaveISO: string) {
  const data = new Date(`${chaveISO}T12:00:00`);
  return DIAS_ABREV[data.getDay()];
}

export function TempoRespostaCard({ dias, valores }: { dias: string[]; valores: number[] }) {
  const chartData = dias.map((d, i) => ({ dia: formatarDia(d), segundos: valores[i] }));
  const ultimo = valores[valores.length - 1] ?? 0;
  const primeiroComDado = valores.find((v) => v > 0) ?? 0;
  const variacaoPct = primeiroComDado ? Math.round(((ultimo - primeiroComDado) / primeiroComDado) * 100) : 0;

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Tempo de resposta</h2>
          <p className="mt-1 text-xl font-bold text-white">{formatarSegundos(ultimo)}</p>
          {primeiroComDado > 0 && (
            <p className="text-xs text-primary">{variacaoPct >= 0 ? "+" : ""}{variacaoPct}% vs início do período</p>
          )}
        </div>
        <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted">Últimos 8 dias</span>
      </div>

      <div className="mt-4 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="tempoRespostaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dia"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-muted)" }}
              itemStyle={{ color: "var(--color-white)" }}
              formatter={(value) => [formatarSegundos(Number(value)), "Tempo médio"]}
            />
            <Area
              type="monotone"
              dataKey="segundos"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#tempoRespostaFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
