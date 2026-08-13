import { MessageSquare } from "lucide-react";

export function ConversasVazio() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <MessageSquare size={36} className="mb-3 text-muted" strokeWidth={1.5} />
      <p className="text-sm text-muted">Selecione uma conversa para começar</p>
    </div>
  );
}
