import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { LABEL_CONVENIO } from "../lib/funil";
import { dataDoRetorno, retornoVencido } from "../lib/retornos";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useRecargaAgrupada } from "../hooks/useRecargaAgrupada";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/Avatar";
import type { Conversa } from "../types/api";

// Clientes que pediram para ser chamados em outro dia. Quando o dia chega, o aviso aparece no topo do inbox.
// Sai daqui quando a equipe marca como feito.
export function RetornosPage() {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api
      .get<{ conversas: Conversa[] }>("/conversas?aba=retornos")
      .then((r) => setConversas([...r.conversas].sort((a, b) => new Date(a.retornoEm ?? 0).getTime() - new Date(b.retornoEm ?? 0).getTime())))
      .catch(() => setErro("Não foi possível carregar os retornos"));
  }, []);

  useEffect(() => carregar(), [carregar]);
  const recarregar = useRecargaAgrupada(carregar, 1500);
  useSocketEvent("conversa:atualizada", recarregar);
  useSocketEvent("retorno:vencido", recarregar);

  async function feito(id: string) {
    try {
      await api.patch(`/conversas/${id}`, { retornoEm: null });
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível marcar como feito");
    }
  }

  return (
    <div>
      <PageHeader title="Retornos" subtitle="Clientes que pediram para ser chamados em outro dia" />
      <div className="space-y-4 p-8">
        {erro && <p className="text-sm text-accent">{erro}</p>}
        {conversas === null && <p className="text-sm text-muted">Carregando...</p>}
        {conversas?.length === 0 && (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm font-semibold text-ink">Nenhum retorno agendado</p>
            <p className="mt-1 text-sm text-muted">Quando um cliente pedir para deixar para depois, o dia combinado aparece aqui.</p>
          </div>
        )}
        {conversas?.map((c) => {
          const vencido = !!c.retornoEm && retornoVencido(c.retornoEm);
          return (
            <div key={c.id} className={`flex flex-wrap items-center gap-4 rounded-lg border bg-surface p-4 ${vencido ? "border-primary/60" : "border-border"}`}>
              <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} fotoUrl={c.contato.fotoUrl} tamanho={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.contato.nome ?? "Sem nome"}</p>
                <p className="text-xs text-muted">
                  {c.convenio ? `${LABEL_CONVENIO[c.convenio]} · ` : ""}
                  {c.instancia.nome}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold tabular-nums ${vencido ? "text-accent" : "text-ink"}`}>{c.retornoEm ? dataDoRetorno(c.retornoEm) : ""}</p>
                <p className="text-xs text-muted">{vencido ? "Chegou o dia" : "Agendado"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link to={`/conversas/${c.id}`} className="flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-marca-indigo hover:opacity-90">
                  Chamar cliente
                </Link>
                <button onClick={() => feito(c.id)} className="h-8 rounded-md border border-border px-3 text-xs font-semibold text-muted hover:text-ink">
                  Feito
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
