import { useEffect } from "react";
import { Users, X } from "../icones";
import { ETAPAS_FLUXO, SAIDAS_MAISA, SAIDAS_NO_GUIA } from "../../lib/maisa";

interface Props {
  aberto: boolean;
  onFechar: () => void;
}

const SEMPRE_PASSA = [
  "Pedir para falar com um atendente.",
  "Mandar foto ou documento fora da etapa do extrato. Áudio ela escuta e responde.",
  "Fazer uma pergunta que ela não sabe responder.",
  "Não ser entendido três vezes seguidas.",
];

// Guia para a equipe: o roteiro que a Maisa segue e o que fazer quando ela passa a conversa.
export function MaisaFluxoModal({ aberto, onFechar }: Props) {
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="maisa-fluxo-titulo"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-surface p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="maisa-fluxo-titulo" className="text-base font-bold text-ink">
              Como a Maisa atende
            </h2>
            <p className="mt-1 text-sm text-muted">
              Ela segue sempre este roteiro. Se você responder, ela para e a conversa fica com você.
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <ol className="mt-5">
          {ETAPAS_FLUXO.map((etapa, i) => (
            <li key={etapa.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-indigo-claro text-xs font-bold text-indigo-claro">
                  {i + 1}
                </span>
                <span aria-hidden="true" className="w-px flex-1 bg-border" />
              </div>
              <div className="pb-4">
                <p className="text-sm font-semibold text-ink">{etapa.nome}</p>
                <p className="text-sm text-ink/90">{etapa.oQueFaz}</p>
              </div>
            </li>
          ))}
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-marca-indigo">
              <Users size={14} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Equipe</p>
              <p className="text-sm text-ink/90">Todo atendimento termina com uma pessoa da equipe.</p>
            </div>
          </li>
        </ol>

        <h3 className="mt-6 text-sm font-semibold text-ink">Em qualquer etapa, ela passa para a equipe se o cliente</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/90 marker:text-muted">
          {SEMPRE_PASSA.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-semibold text-ink">Quando a conversa chega para você</h3>
        <dl className="mt-3 divide-y divide-border rounded-md border border-border">
          {SAIDAS_NO_GUIA.map((id) => {
            const s = SAIDAS_MAISA[id];
            return (
              <div key={id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2 text-sm">
                <dt className={`font-medium ${s.quente ? "text-accent" : "text-ink"}`}>{s.titulo}</dt>
                <dd className="text-ink/90">{s.proximoPasso}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
