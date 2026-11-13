import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CircleAlert } from "../icones";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useSocketEvent } from "../../hooks/useSocketEvent";

interface Operacao {
  id: string;
  status: string;
  tipo: string;
  etapa: string | null;
  codigoAf: string | null;
  erro: string | null;
  tentativas: number;
  liberadaEm: string | null;
  motivoLiberacao: string | null;
  createdAt: string;
}

// O que cada situação quer dizer para a equipe.
const SITUACAO: Record<string, string> = {
  preparada: "preparando (antes do ponto sem volta)",
  irreversivel: "cadastrando a proposta na Facta",
  concluida: "proposta criada",
  falhou: "parou antes do cadastro da proposta",
  desconhecida: "resultado incerto: conferir no portal",
  invalidada: "cancelada: o cliente escreveu antes do ponto sem volta",
  liberada: "liberada para nova tentativa",
};
const LIBERAVEL = new Set(["desconhecida", "concluida", "falhou", "invalidada"]);

const classeCampo = "w-full rounded-md border border-border bg-bg/60 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent";

// Digitações automáticas na Facta desta conversa. Uma nova tentativa da mesma oferta, ou
// para o mesmo CPF, só acontece depois de alguém conferir no portal e liberar aqui.
export function OperacoesFacta({ conversaId }: { conversaId: string }) {
  const { usuario } = useAuth();
  const [operacoes, setOperacoes] = useState<Operacao[]>([]);
  const [liberando, setLiberando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await api.get<{ operacoes: Operacao[] }>(`/maisa/conversas/${conversaId}/operacoes`);
    setOperacoes(r.operacoes);
  }, [conversaId]);
  useEffect(() => {
    carregar().catch(() => {});
  }, [carregar]);
  useSocketEvent<{ conversaId: string }>("maisa:aviso", (a) => {
    if (a.conversaId === conversaId) carregar().catch(() => {});
  });

  async function liberar(e: FormEvent) {
    e.preventDefault();
    if (!liberando) return;
    setErro(null);
    try {
      await api.post(`/maisa/operacoes/${liberando}/liberar`, { motivo });
      setLiberando(null);
      setMotivo("");
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível liberar");
    }
  }

  if (!operacoes.length) return null;
  return (
    <section className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <CircleAlert size={13} aria-hidden="true" /> Digitações na Facta
      </p>
      {operacoes.map((o) => (
        <div key={o.id} className="rounded-md border border-border bg-bg/40 p-2.5 text-xs">
          <p className="font-medium text-ink">{SITUACAO[o.status] ?? o.status}</p>
          <p className="text-muted">
            {o.tipo === "port_refin" ? "Port + refin" : "Empréstimo novo"}
            {o.codigoAf ? ` · proposta ${o.codigoAf}` : ""} · {o.tentativas} tentativa(s) · {new Date(o.createdAt).toLocaleString("pt-BR")}
          </p>
          {o.erro && <p className="mt-1 text-muted">{o.erro}</p>}
          {o.motivoLiberacao && <p className="mt-1 text-muted">Liberada: {o.motivoLiberacao}</p>}
          {usuario?.role === "admin" && LIBERAVEL.has(o.status) && liberando !== o.id && (
            <button onClick={() => setLiberando(o.id)} className="mt-1.5 text-accent hover:underline">
              Liberar nova tentativa
            </button>
          )}
          {liberando === o.id && (
            <form onSubmit={liberar} className="mt-2 space-y-1.5">
              <input
                autoFocus
                required
                minLength={5}
                maxLength={500}
                placeholder="O que você conferiu no portal da Facta?"
                aria-label="Motivo da liberação"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className={classeCampo}
              />
              {erro && <p className="text-accent">{erro}</p>}
              <div className="flex gap-2">
                <button type="submit" className="rounded-md bg-primary px-2.5 py-1 font-semibold text-marca-indigo hover:opacity-90">
                  Liberar
                </button>
                <button type="button" onClick={() => setLiberando(null)} className="text-muted hover:text-ink">
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}
