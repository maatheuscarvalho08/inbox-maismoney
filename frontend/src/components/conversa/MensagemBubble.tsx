import { useState } from "react";
import { Pencil } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { MidiaMensagem } from "./MidiaMensagem";
import { StatusEntregaIcone } from "./StatusEntregaIcone";
import type { Mensagem } from "../../types/api";

function formatarHorario(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  mensagem: Mensagem;
  podeEditar?: boolean;
  onEditada?: (mensagem: Mensagem) => void;
}

export function MensagemBubble({ mensagem, podeEditar, onEditada }: Props) {
  const doOperador = mensagem.remetenteTipo === "operador";
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(mensagem.conteudoTexto ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Edição só faz sentido em texto puro do próprio operador, já enviado de
  // verdade (tem externalId) — mídia e mensagens do cliente não entram aqui.
  const editavel =
    podeEditar && doOperador && !mensagem.tipoMidia && Boolean(mensagem.externalId) && !!mensagem.conteudoTexto;

  async function salvar() {
    const novoTexto = texto.trim();
    if (!novoTexto || novoTexto === mensagem.conteudoTexto) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const res = await api.patch<{ mensagem: Mensagem }>(`/mensagens/${mensagem.id}`, { conteudoTexto: novoTexto });
      onEditada?.(res.mensagem);
      setEditando(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível editar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={`flex ${doOperador ? "justify-end" : "justify-start"}`}>
      <div
        className={`group relative max-w-[70%] rounded-lg border px-3 py-2 ${
          doOperador ? "border-primary/20 bg-primary/10" : "border-white/10 bg-surface/60"
        }`}
      >
        {doOperador && mensagem.operador && (
          <p className="mb-0.5 text-[11px] font-medium text-primary">{mensagem.operador.nome}</p>
        )}

        {mensagem.midiaDeleted ? (
          <p className="text-xs italic text-muted">Mídia removida após 4 dias de inatividade</p>
        ) : mensagem.tipoMidia && mensagem.midiaPath ? (
          <MidiaMensagem mensagemId={mensagem.id} tipoMidia={mensagem.tipoMidia} />
        ) : null}

        {editando ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  salvar();
                }
                if (e.key === "Escape") setEditando(false);
              }}
              rows={2}
              className="w-full rounded-md border border-primary bg-bg/60 px-2 py-1.5 text-sm text-white outline-none"
            />
            {erro && <p className="text-[11px] text-primary">{erro}</p>}
            <div className="flex justify-end gap-2 text-[11px] font-medium">
              <button onClick={() => setEditando(false)} className="text-muted hover:text-white">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando} className="text-primary hover:underline disabled:opacity-50">
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        ) : (
          mensagem.conteudoTexto && <p className="mt-1 whitespace-pre-wrap text-sm text-white">{mensagem.conteudoTexto}</p>
        )}

        {editavel && !editando && (
          <button
            onClick={() => {
              setTexto(mensagem.conteudoTexto ?? "");
              setEditando(true);
            }}
            title="Editar mensagem"
            className="absolute -left-7 top-1.5 hidden text-muted hover:text-primary group-hover:block"
          >
            <Pencil size={13} />
          </button>
        )}

        <div className="mt-1 flex items-center justify-end gap-1">
          {mensagem.editadaEm && <p className="text-[10px] italic text-muted">editada</p>}
          <p className="text-[10px] text-muted">{formatarHorario(mensagem.timestamp)}</p>
          {doOperador && <StatusEntregaIcone status={mensagem.statusEntrega} />}
        </div>
      </div>
    </div>
  );
}
