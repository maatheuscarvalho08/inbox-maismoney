import type { ReactNode } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  deltaLabel?: string;
  deltaDirection?: "up" | "down";
  children?: ReactNode;
}

export function MetricCard({ label, value, deltaLabel, deltaDirection, children }: MetricCardProps) {
  const ArrowIcon = deltaDirection === "down" ? ArrowDown : ArrowUp;

  return (
    <div className="group rounded-lg border border-white/10 bg-surface/40 p-4 backdrop-blur-xl transition-[border-color,box-shadow] duration-150 ease-out hover:border-primary hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_15%,transparent)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>

      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-[2rem] font-bold leading-none text-white">{value}</p>
      </div>

      {deltaLabel && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary">
          <ArrowIcon size={12} strokeWidth={2.5} />
          {deltaLabel}
        </p>
      )}

      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
