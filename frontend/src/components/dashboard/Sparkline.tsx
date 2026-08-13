import { LineChart, Line, BarChart, Bar, ResponsiveContainer } from "recharts";

const MARGIN = { top: 4, right: 0, bottom: 0, left: 0 };

export function SparklineLine({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v) => ({ v }));

  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={chartData} margin={MARGIN}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SparklineBars({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v) => ({ v }));

  return (
    <ResponsiveContainer width="100%" height={48}>
      <BarChart data={chartData} margin={MARGIN} barCategoryGap="25%">
        <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
