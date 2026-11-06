import { Check, CheckCheck, Clock, TriangleAlert } from "../icones";
import type { StatusEntrega } from "../../types/api";

export function StatusEntregaIcone({ status }: { status: StatusEntrega | null }) {
  if (!status) return <Clock size={12} className="text-muted" />;

  if (status === "falhou") {
    return <TriangleAlert size={12} className="text-accent" />;
  }

  if (status === "enviado") {
    return <Check size={13} className="text-muted" />;
  }

  // entregue = dois tiques cinza, lido = dois tiques na cor de destaque (padrão do WhatsApp).
  return (
    <CheckCheck size={13} className={status === "lido" ? "text-accent" : "text-muted"} />
  );
}
