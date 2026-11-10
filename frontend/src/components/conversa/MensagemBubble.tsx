import { useState } from "react";
import { Bot, FileText, Pencil, Reply } from "../icones";
import { api, ApiError } from "../../lib/api";
import { Avatar } from "../Avatar";
import { urlFotoOperador } from "../../lib/avatar";
import { MidiaMensagem } from "./MidiaMensagem";
import { StatusEntregaIcone } from "./StatusEntregaIcone";
import type { Mensagem } from "../../types/api";

function formatarHorario(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function previewDaMensagem(m: { conteudoTexto: string | null; tipoMidia: string | null }) {
  if (m.conteudoTexto) return m.conteudoTexto;
  if (m.tipoMidia?.startsWith("image/")) return "📷 Foto";
  if (m.tipoMidia?.startsWith("video/")) return "🎥 Vídeo";
  if (m.tipoMidia?.startsWith("audio/")) return "🎵 Áudio";
  if (m.tipoMidia) return "📎 Arquivo";
  return "Mensagem";
}

interface Props {
  mensagem: Mensagem;
  contatoNome: string;
  contatoFotoUrl?: string | null;
  podeEditar?: boolean;
  onEditada?: (mensagem: Mensagem) => void;
  onResponder?: (mensagem: Mensagem) => void;
  // Conversa criada pelo simulador da Maisa: nada dela vai para o WhatsApp.
  conversaDeTeste?: boolean;
  onAnalisarExtrato?: (mensagem: Mensagem) => void;
}

// Extrato de consignado chega como PDF ou foto.
const pareceExtrato = (tipo: string) => tipo === "application/pdf" || tipo.startsWith("image/");

export function MensagemBubble({ mensagem, contatoNome, contatoFotoUrl, podeEditar, onEditada, onResponder, conversaDeTeste, onAnalisarExtrato }: Props) {
  const doOperador = mensagem.remetenteTipo === "operador";
  const daMaisa = mensagem.remetenteTipo === "maisa";
  // Mensagem que sai da empresa, seja da equipe ou da Maisa: fica do lado direito.
  const saida = doOperador || daMaisa;
  // No modo copiloto a Maisa só sugere. A sugestão ainda não foi para o WhatsApp.
  const sugestao = daMaisa && !mensagem.externalId && mensagem.statusEntrega !== "falhou";
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

  const [reenviando, setReenviando] = useState(false);
  const [erroReenvio, setErroReenvio] = useState<string | null>(null);

  async function reenviar() {
    setReenviando(true);
    setErroReenvio(null);
    try {
      const res = await api.post<{ mensagem: Mensagem; erroEntrega?: string }>(`/mensagens/${mensagem.id}/reenviar`, {});
      onEditada?.(res.mensagem);
      if (res.erroEntrega) setErroReenvio("Falhou de novo");
    } catch (err) {
      setErroReenvio(err instanceof ApiError ? err.message : "Não foi possível reenviar");
    } finally {
      setReenviando(false);
    }
  }

  const [enviandoSugestao, setEnviandoSugestao] = useState(false);

  async function enviarSugestao() {
    setEnviandoSugestao(true);
    setErroReenvio(null);
    try {
      const res = await api.post<{ mensagem: Mensagem; erroEntrega?: string }>(`/maisa/mensagens/${mensagem.id}/enviar`, {});
      onEditada?.(res.mensagem);
      if (res.erroEntrega) setErroReenvio("Não foi enviada");
    } catch (err) {
      setErroReenvio(err instanceof ApiError ? err.message : "Não foi possível enviar");
    } finally {
      setEnviandoSugestao(false);
    }
  }

  const iconesAcao = (
    <div className="flex shrink-0 items-center gap-1.5 opacity-0 group-hover:opacity-100">
      {onResponder && (
        <button onClick={() => onResponder(mensagem)} title="Responder" className="text-muted hover:text-accent">
          <Reply size={13} />
        </button>
      )}
      {editavel && !editando && (
        <button
          onClick={() => {
            setTexto(mensagem.conteudoTexto ?? "");
            setEditando(true);
          }}
          title="Editar mensagem"
          className="text-muted hover:text-accent"
        >
          <Pencil size={13} />
        </button>
      )}
    </div>
  );

  const avatar = daMaisa ? (
    <span
      title="Maisa"
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-indigo-claro/30 bg-indigo-claro/15 text-indigo-claro"
    >
      <Bot size={14} aria-hidden="true" />
    </span>
  ) : doOperador ? (
    <Avatar nome={mensagem.operador?.nome ?? "Operador"} fotoUrl={urlFotoOperador(mensagem.operador?.fotoPath, mensagem.operador?.id)} tamanho={24} />
  ) : (
    <Avatar nome={contatoNome} fotoUrl={contatoFotoUrl} tamanho={24} />
  );

  return (
    <div className={`group flex items-end gap-1.5 ${saida ? "justify-end" : "justify-start"}`}>
      {!saida && avatar}
      {saida && iconesAcao}

      <div
        className={`relative max-w-[70%] rounded-lg border px-3 py-2 ${
          daMaisa
            ? `border-indigo-claro/25 bg-indigo-claro/10 ${sugestao ? "border-dashed" : ""}`
            : doOperador
              ? "border-primary/20 bg-primary/10"
              : "border-ink/10 bg-surface"
        }`}
      >
        {doOperador && mensagem.operador && (
          <p className="mb-0.5 text-[11px] font-medium text-accent">{mensagem.operador.nome}</p>
        )}
        {daMaisa && <p className="mb-0.5 text-[11px] font-medium text-indigo-claro">Maisa</p>}

        {mensagem.respondeA && (
          <div className="mb-2 rounded border-l-2 border-primary/60 bg-bg/30 px-2 py-1">
            <p className="text-[11px] font-medium text-accent">
              {mensagem.respondeA.remetenteTipo === "operador" ? "Você" : mensagem.respondeA.remetenteTipo === "maisa" ? "Maisa" : "Cliente"}
            </p>
            <p className="line-clamp-2 text-xs text-muted">{previewDaMensagem(mensagem.respondeA)}</p>
          </div>
        )}

        {mensagem.midiaDeleted ? (
          <p className="text-xs italic text-muted">Mídia removida após 4 dias de inatividade</p>
        ) : mensagem.tipoMidia && mensagem.midiaPath ? (
          <>
            <MidiaMensagem mensagemId={mensagem.id} tipoMidia={mensagem.tipoMidia} />
            {onAnalisarExtrato && mensagem.remetenteTipo === "cliente" && pareceExtrato(mensagem.tipoMidia) && (
              <button
                onClick={() => onAnalisarExtrato(mensagem)}
                className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
              >
                <FileText size={12} aria-hidden="true" />
                Analisar extrato
              </button>
            )}
          </>
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
              className="w-full rounded-md border border-primary bg-bg/60 px-2 py-1.5 text-sm text-ink outline-none"
            />
            {erro && <p className="text-[11px] text-accent">{erro}</p>}
            <div className="flex justify-end gap-2 text-[11px] font-medium">
              <button onClick={() => setEditando(false)} className="text-muted hover:text-ink">
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando} className="text-accent hover:underline disabled:opacity-50">
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        ) : (
          mensagem.conteudoTexto && (
            <p className="whitespace-pre-wrap text-sm text-ink">{mensagem.conteudoTexto}</p>
          )
        )}

        <div className="mt-1 flex items-center justify-end gap-1">
          {mensagem.editadaEm && <p className="text-[10px] italic text-muted">editada</p>}
          <p className="text-[10px] text-muted">{formatarHorario(mensagem.timestamp)}</p>
          {saida && !sugestao && (
            <span title={mensagem.statusEntrega === "falhou" ? `Não enviada: ${mensagem.erroEntrega ?? "motivo não registrado"}` : undefined}>
              <StatusEntregaIcone status={mensagem.statusEntrega} />
            </span>
          )}
        </div>

        {sugestao && (
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
            {erroReenvio && <span className="text-accent">{erroReenvio}</span>}
            {conversaDeTeste ? (
              <span className="italic text-muted">Teste: não vai para o WhatsApp</span>
            ) : (
              <>
                <span className="italic text-muted">Sugestão, não enviada</span>
                <button onClick={enviarSugestao} disabled={enviandoSugestao} className="font-medium text-indigo-claro hover:underline disabled:opacity-50">
                  {enviandoSugestao ? "Enviando..." : "Enviar"}
                </button>
              </>
            )}
          </div>
        )}

        {saida && mensagem.statusEntrega === "falhou" && (
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
            {erroReenvio && <span className="text-accent">{erroReenvio}</span>}
            <button onClick={reenviar} disabled={reenviando} className="font-medium text-accent hover:underline disabled:opacity-50">
              {reenviando ? "Reenviando..." : "Reenviar"}
            </button>
          </div>
        )}
      </div>

      {!saida && iconesAcao}
      {saida && avatar}
    </div>
  );
}
