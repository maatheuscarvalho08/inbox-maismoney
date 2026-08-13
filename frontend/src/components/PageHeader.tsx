import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b border-border px-8 py-6">
      <div>
        <h1 className="text-[1.75rem] font-bold text-white">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      {right && <div className="pt-1 text-sm text-muted">{right}</div>}
    </div>
  );
}
