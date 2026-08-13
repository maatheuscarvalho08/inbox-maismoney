export function MiniProgressBar({ percentual, caption }: { percentual: number; caption: string }) {
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentual}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">{caption}</p>
    </div>
  );
}
