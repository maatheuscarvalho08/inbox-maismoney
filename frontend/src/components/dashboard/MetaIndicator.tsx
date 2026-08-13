export function MetaIndicator({ meta, dentroDaMeta }: { meta: string; dentroDaMeta: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-1.5 rounded-full ${dentroDaMeta ? "bg-primary" : "bg-muted"}`} />
      {meta}
    </div>
  );
}
