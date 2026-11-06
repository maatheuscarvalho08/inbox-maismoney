import type { StatusConversa } from "../types/api";

const LABELS: Record<StatusConversa, string> = {
  aberta: "Aberta",
  em_atendimento: "Em Atendimento",
  encerrada: "Encerrada",
  aguardando: "Aguardando",
};

const STYLES: Record<StatusConversa, string> = {
  aberta: "border-primary/30 bg-primary/15 text-accent",
  em_atendimento: "border-indigo-claro/30 bg-indigo-claro/15 text-indigo-claro",
  encerrada: "border-border bg-border/60 text-muted",
  aguardando: "border-primary bg-transparent text-accent",
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
