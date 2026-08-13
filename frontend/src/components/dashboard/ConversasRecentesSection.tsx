import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "../Avatar";
import { StatusBadge } from "../StatusBadge";
import { tempoRelativo } from "../../lib/tempoRelativo";
import type { Conversa } from "../../types/api";

const COLUMNS = ["Contato", "Número", "Última mensagem", "Há quanto tempo", "Operador", "Status"];

function ultimaMensagemPreview(conversa: Conversa) {
  const ultima = conversa.mensagens?.[0];
  if (!ultima) return "—";
  if (ultima.conteudoTexto) return ultima.conteudoTexto;
  if (ultima.tipoMidia) return "📎 Mídia";
  return "—";
}

export function ConversasRecentesSection({ conversas, carregando }: { conversas: Conversa[]; carregando: boolean }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Conversas recentes</h2>
        <Link
          to="/conversas"
          className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 ease-out hover:bg-primary/10"
        >
          Ver todas
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-sm text-muted">
                  Carregando...
                </td>
              </tr>
            )}

            {!carregando && conversas.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-5 py-8 text-center text-sm text-muted">
                  Nenhuma conversa ainda.
                </td>
              </tr>
            )}

            {conversas.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(`/conversas/${c.id}`)}
                className="cursor-pointer border-t border-border transition-colors duration-150 ease-out hover:bg-white/[0.03]"
              >
                <td className="px-5 py-3">
                  <Link to={`/conversas/${c.id}`} className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                    <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} />
                    <span className="font-medium text-white">{c.contato.nome ?? "Sem nome"}</span>
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted">{c.contato.numeroWhatsapp}</td>
                <td className="max-w-[240px] truncate px-5 py-3 text-white">{ultimaMensagemPreview(c)}</td>
                <td className="px-5 py-3 text-muted">{tempoRelativo(c.lastMessageAt)}</td>
                <td className="px-5 py-3 text-muted">{c.operador?.nome ?? "—"}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
