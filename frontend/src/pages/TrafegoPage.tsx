import { PageHeader } from "../components/PageHeader";
import { TrendingUp } from "../components/icones";

const COLUNAS = ["Campanha", "Status", "Investido", "Leads no WhatsApp", "Custo por lead", "Ofertas", "Propostas"];

// Campanhas pagas (Meta Ads) e o que elas trazem para o WhatsApp. A campanha é criada
// e acompanhada pelo Claude com o conector do Meta; esta tela vai cruzar o investimento
// com o que acontece depois no Inbox: lead, oferta da Maisa e proposta.
export function TrafegoPage() {
  return (
    <div>
      <PageHeader title="Tráfego" subtitle="Campanhas pagas e os clientes que elas trazem para o WhatsApp" />

      <div className="space-y-5 p-8">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-ink/5 text-muted">
            <TrendingUp size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Meta Ads ainda não conectado</p>
            <p className="text-xs text-muted">
              A conta de anúncios é conectada pelo Claude. Depois disso, as campanhas aparecem aqui com o resultado de cada uma.
            </p>
          </div>
          <span className="rounded border border-border px-2 py-0.5 text-xs font-semibold text-muted">Desconectado</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted">
                {COLUNAS.map((c) => (
                  <th key={c} className="px-4 py-3 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={COLUNAS.length} className="px-4 py-10 text-center">
                  <p className="text-sm text-ink">Nenhuma campanha ainda.</p>
                  <p className="mt-1 text-xs text-muted">A primeira vai ser criada pelo Claude, com o Meta Ads conectado.</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
