import { ArrowRight, Check, Info, Users } from "../icones";
import { ETAPAS_FLUXO, indiceEtapa, saidaDaConversa } from "../../lib/maisa";
import type { Conversa } from "../../types/api";

interface Props {
  conversa: Conversa;
  onVerFluxo: () => void;
}

type EstadoPasso = "feito" | "atual" | "parou" | "pulado" | "pendente";

const CIRCULO: Record<EstadoPasso, string> = {
  feito: "bg-indigo-claro text-marca-indigo",
  atual: "border-2 border-indigo-claro text-indigo-claro",
  parou: "border-2 border-accent text-accent",
  pulado: "border border-border text-muted opacity-50",
  pendente: "border border-border text-muted",
};

const ROTULO: Record<EstadoPasso, string> = {
  feito: "text-ink",
  atual: "font-semibold text-indigo-claro",
  parou: "font-semibold text-accent",
  pulado: "text-muted opacity-50",
  pendente: "text-muted",
};

// Onde a conversa está no roteiro da Maisa. Enquanto ela atende, mostra a etapa atual.
// Depois que ela passa para a equipe, mostra onde parou, por quê e o próximo passo.
export function MaisaProgresso({ conversa, onVerFluxo }: Props) {
  const estado = conversa.maisaEstado;
  const saida = saidaDaConversa(conversa);
  if (conversa.status === "encerrada" || (!conversa.comMaisa && !saida)) return null;

  const transferida = Boolean(saida);
  const atual = indiceEtapa(transferida ? estado?.paradaEm : estado?.etapa);
  const tentativas = conversa.comMaisa ? (estado?.tentativas ?? 0) : 0;

  function estadoDoPasso(i: number): EstadoPasso {
    if (i < atual) return "feito";
    if (i === atual) return transferida ? "parou" : "atual";
    return transferida ? "pulado" : "pendente";
  }

  return (
    <div className="border-b border-border bg-surface/60 px-8 py-3">
      <div className="flex items-center gap-4">
        <ol aria-label="Roteiro da Maisa" className="flex min-w-0 flex-1 items-center">
          {ETAPAS_FLUXO.map((etapa, i) => {
            const e = estadoDoPasso(i);
            return (
              <li
                key={etapa.id}
                aria-current={e === "atual" || e === "parou" ? "step" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${CIRCULO[e]}`}>
                  {e === "feito" ? <Check size={12} aria-hidden="true" /> : i + 1}
                </span>
                <span className={`truncate text-xs ${ROTULO[e]}`}>{etapa.nome}</span>
                <span aria-hidden="true" className={`mx-1 h-px min-w-3 flex-1 ${i < atual ? "bg-indigo-claro/60" : "bg-border"}`} />
              </li>
            );
          })}
          <li aria-current={transferida ? "step" : undefined} className="flex shrink-0 items-center gap-2">
            <span
              className={`flex size-6 items-center justify-center rounded-full ${
                transferida ? "bg-primary text-marca-indigo" : "border border-border text-muted"
              }`}
            >
              <Users size={13} aria-hidden="true" />
            </span>
            <span className={`text-xs ${transferida ? "font-semibold text-ink" : "text-muted"}`}>Equipe</span>
          </li>
        </ol>

        <button
          onClick={onVerFluxo}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted hover:text-ink"
        >
          <Info size={14} aria-hidden="true" />
          Como funciona
        </button>
      </div>

      {saida && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={`font-semibold ${saida.quente ? "text-accent" : "text-ink"}`}>{saida.titulo}</span>
          <span className="flex items-center gap-1 text-ink">
            <ArrowRight size={12} className="text-muted" aria-hidden="true" />
            {saida.proximoPasso}
          </span>
        </p>
      )}

      {conversa.comMaisa && estado?.etapa === "aguardando" && (
        <p className="mt-2 text-xs text-muted">Esperando o cliente autorizar o link do banco.</p>
      )}

      {tentativas > 0 && estado?.etapa !== "aguardando" && (
        <p className="mt-2 text-xs text-muted">Ela não entendeu a última resposta do cliente.</p>
      )}
    </div>
  );
}
