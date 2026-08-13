import { ArrowUp, ArrowDown, type LucideIcon } from "lucide-react";
import { SparklineLine } from "../dashboard/Sparkline";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  trendLabel?: string;
  trendDirection?: "up" | "down";
  sparkline?: number[];
}

export function StatCard({ icon: Icon, label, value, trendLabel, trendDirection, sparkline }: StatCardProps) {
  const ArrowIcon = trendDirection === "down" ? ArrowDown : ArrowUp;

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon size={14} strokeWidth={2} />
        </span>
        <p className="text-xs font-medium text-muted">{label}</p>
      </div>

      <p className="mt-3 text-2xl font-bold text-white">{value}</p>

      {trendLabel && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
          <ArrowIcon size={11} strokeWidth={2.5} />
          {trendLabel}
        </p>
      )}

      {sparkline && (
        <div className="mt-2">
          <SparklineLine data={sparkline} color="var(--color-primary)" />
        </div>
      )}
    </div>
  );
}
