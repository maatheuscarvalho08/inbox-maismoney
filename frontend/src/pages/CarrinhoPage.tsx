import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { LABEL_CONVENIO } from "../lib/funil";
import { formatarCentavos } from "../lib/propostas";
import { tempoRelativo } from "../lib/tempoRelativo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useRecargaAgrupada } from "../hooks/useRecargaAgrupada";
import { PageHeader } from "../components/PageHeader";
import { Avatar } from "../components/Avatar";
import type { Conversa } from "../types/api";

// Clientes que receberam a oferta da Maisa e não responderam em 24 horas. A equipe
// liga ou manda mensagem para tentar fechar. Sai daqui quando o cliente responde ou
// quando alguém clica em "Tirar do carrinho".
export function CarrinhoPage() {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api
      .get<{ conversas: Conversa[] }>("/conversas?aba=carrinho")
      .then((r) => setConversas(r.conversas.filter((c) => c.status !== "encerrada")))
      .catch(() => setErro("Não foi possível carregar o carrinho"));
  }, []);

  useEffect(() => carregar(), [carregar]);
  const recarregar = useRecargaAgrupada(carregar, 1500);
  useSocketEvent("conversa:atualizada", recarregar);
  useSocketEvent("carrinho:novo", recarregar);

  async function tirar(id: string) {
    try {
      await api.patch(`/conversas/${id}`, { carrinho: false });
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível tirar do carrinho");
    }
  }

  return (
    <div>
      <PageHeader title="Carrinho" subtitle="Receberam a oferta e não responderam em 24 horas" />

      <div className="space-y-4 p-8">
        {erro && <p className="text-sm text-accent">{erro}</p>}
        {conversas === null && <p className="text-sm text-muted">Carregando...</p>}
        {conversas?.length === 0 && (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm font-semibold text-ink">Carrinho vazio</p>
            <p className="mt-1 text-sm text-muted">Todo cliente que recebeu oferta respondeu. Nada para recuperar agora.</p>
          </div>
        )}

        {conversas?.map((c) => {
          const oferta = c.maisaEstado?.oferta;
          const meta = c.instancia.tipoConexao === "meta_cloud";
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
              <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} fotoUrl={c.contato.fotoUrl} tamanho={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.contato.nome ?? "Sem nome"}</p>
                <p className="text-xs text-muted">
                  {c.convenio ? `${LABEL_CONVENIO[c.convenio]} · ` : ""}
                  {c.instancia.nome}
                  {c.carrinhoEm ? ` · no carrinho há ${tempoRelativo(c.carrinhoEm)}` : ""}
                </p>
                {meta && (
                  <p className="mt-1 text-xs text-accent">Número oficial: passou de 24h, só dá para chamar com um template.</p>
                )}
              </div>

              {oferta && (
                <div className="text-right">
                  <p className="text-sm font-bold text-ink tabular-nums">até {formatarCentavos(oferta.valorCentavos)}</p>
                  <p className="text-xs text-muted tabular-nums">
                    {oferta.prazoMeses}x de {formatarCentavos(oferta.parcelaCentavos)} · {oferta.banco}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Link
                  to={`/conversas/${c.id}`}
                  className="flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-marca-indigo hover:opacity-90"
                >
                  Chamar cliente
                </Link>
                <button
                  onClick={() => tirar(c.id)}
                  className="h-8 rounded-md border border-border px-3 text-xs font-semibold text-muted hover:text-ink"
                >
                  Tirar do carrinho
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
