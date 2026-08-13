import { PageHeader } from "./PageHeader";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle={description} />
      <div className="p-8">
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted">
          Em construção
        </div>
      </div>
    </div>
  );
}
