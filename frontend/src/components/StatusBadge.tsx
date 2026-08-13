import type { StatusConversa } from "../types/api";

const LABELS: Record<StatusConversa, string> = {
  aberta: "Aberta",
  em_atendimento: "Em Atendimento",
  encerrada: "Encerrada",
  aguardando: "Aguardando",
};

const STYLES: Record<StatusConversa, string> = {
  aberta: "border-primary/30 bg-primary/15 text-primary",
  em_atendimento: "border-accent/30 bg-accent/15 text-[var(--color-accent-fg)]",
  encerrada: "border-border bg-border/60 text-muted",
  aguardando: "border-primary bg-transparent text-primary",
};

export function StatusBadge({ status }: { status: StatusConversa }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
