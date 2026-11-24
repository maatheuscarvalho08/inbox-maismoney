import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal } from "../Modal";
import { Mic, Paperclip, Send, Square, X } from "../icones";
import { api, ApiError } from "../../lib/api";
import { previewDaMensagem } from "./MensagemBubble";
import type { Conversa, Instancia, Mensagem, TipoConexao } from "../../types/api";

function formatarTempo(segundos: number) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const JANELA_META_MS = 24 * 60 * 60 * 1000;

interface ComposerProps {
  conversaId: string;
  tipoConexao: TipoConexao;
  ultimaMensagemClienteEm: string | null;
  onEnviada: (mensagem: Mensagem) => void;
  respondendoA: Mensagem | null;
  onCancelarResposta: () => void;
}

const TEXTO_CHAMADA = "Olá! Aqui é da Mais Money. Passando para continuar o seu atendimento por este número. Pode me responder por aqui?";

// Fora da janela de 24h: a conversa continua por um número de atendimento (Evolution), que manda texto livre.
function ChamarPorAtendimento({ conversaId, onFechar }: { conversaId: string; onFechar: () => void }) {
  const navigate = useNavigate();
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaId, setInstanciaId] = useState("");
  const [texto, setTexto] = useState(TEXTO_CHAMADA);
  const [comMaisa, setComMaisa] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ instancias: Instancia[] }>("/instancias").then((r) => {
      const evo = r.instancias.filter((i) => i.tipoConexao === "evolution");
      setInstancias(evo);
      setInstanciaId((evo.find((i) => /principal/i.test(i.nome)) ?? evo[0])?.id ?? "");
    });
  }, []);

  const escolhida = instancias.find((i) => i.id === instanciaId);

  async function chamar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{ conversa: Conversa; entregue: boolean }>(`/conversas/${conversaId}/chamar-por-atendimento`, { instanciaId, texto, deixarComMaisa: comMaisa });
      onFechar();
      navigate(`/conversas/${r.conversa.id}`);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível chamar pelo número de atendimento");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal onClose={onFechar}>
      <div className="space-y-3 p-5 text-left">
        <h2 className="text-base font-semibold text-ink">Chamar pelo número de atendimento</h2>
        <p className="text-xs text-muted">A conversa continua pelo número escolhido. A conversa antiga, no número oficial, é encerrada.</p>
        <label className="block text-xs font-medium text-muted">
          Número
          <select value={instanciaId} onChange={(e) => setInstanciaId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-ink outline-none focus:border-accent">
            {instancias.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome} · {i.numero}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted">
          Mensagem
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="mt-1 w-full resize-none rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-ink outline-none focus:border-accent" />
        </label>
        {escolhida?.maisaAtiva && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={comMaisa} onChange={(e) => setComMaisa(e.target.checked)} />
            Deixar a Maisa conduzir de onde parou
          </label>
        )}
        {erro && <p className="text-xs text-accent">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onFechar} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-ink">
            Cancelar
          </button>
          <button
            onClick={chamar}
            disabled={enviando || !instanciaId || !texto.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-marca-indigo hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Composer({
  conversaId,
  tipoConexao,
  ultimaMensagemClienteEm,
  onEnviada,
  respondendoA,
  onCancelarResposta,
}: ComposerProps) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [audioGravado, setAudioGravado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [chamando, setChamando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [gravando, setGravando] = useState(false);
  const [tempoGravacao, setTempoGravacao] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function iniciarGravacao() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "audio/webm;codecs=opus";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const extensao = mimeType.includes("ogg") ? "ogg" : "webm";
        setArquivo(new File([blob], `audio-${Date.now()}.${extensao}`, { type: mimeType }));
        setAudioGravado(true);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setGravando(true);
      setTempoGravacao(0);
      intervalRef.current = setInterval(() => setTempoGravacao((t) => t + 1), 1000);
    } catch {
      setErro("Não foi possível acessar o microfone. Confira as permissões do navegador.");
    }
  }

  function pararGravacao() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setGravando(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function cancelarAudio() {
    setArquivo(null);
    setAudioGravado(false);
  }

  // URL local só pra ouvir antes de enviar — nunca sai do navegador do operador.
  // Recriada a cada áudio novo e revogada na troca/saída pra não vazar memória.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!audioGravado || !arquivo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioGravado, arquivo]);

  const foraDaJanela =
    tipoConexao === "meta_cloud" &&
    ultimaMensagemClienteEm !== null &&
    Date.now() - new Date(ultimaMensagemClienteEm).getTime() > JANELA_META_MS;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter dispara requestSubmit() direto, passando por cima do disabled do
    // botão — sem essa trava, apertar rápido (ou segurar, com repetição
    // automática do teclado) mandava a mesma mensagem várias vezes antes do
    // primeiro envio terminar.
    if (enviando) return;
    if (!texto.trim() && !arquivo) return;

    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("conversaId", conversaId);
      if (texto.trim()) form.append("conteudoTexto", texto.trim());
      if (arquivo) form.append("midia", arquivo);
      if (audioGravado) form.append("audioGravado", "true");
      if (respondendoA) form.append("respondeAId", respondendoA.id);

      const res = await api.post<{ mensagem: Mensagem; entregue: boolean }>("/mensagens", form);
      onEnviada(res.mensagem);
      setTexto("");
      setArquivo(null);
      setAudioGravado(false);
      onCancelarResposta();
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível enviar a mensagem");
    } finally {
      setEnviando(false);
    }
  }

  if (foraDaJanela) {
    return (
      <div className="border-t border-border bg-surface p-4 text-center text-sm text-muted">
        Fora da janela de 24h desde a última mensagem do cliente — a Meta Cloud API só permite reenviar através de um
        template aprovado. Use a tela de{" "}
        <Link to="/disparos" className="text-accent hover:underline">
          Disparos
        </Link>{" "}
        ou chame pelo número de atendimento.
        <div className="mt-3">
          <button
            onClick={() => setChamando(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-marca-indigo hover:opacity-90"
          >
            Chamar pelo número de atendimento
          </button>
        </div>
        {chamando && <ChamarPorAtendimento conversaId={conversaId} onFechar={() => setChamando(false)} />}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface p-4">
      {respondendoA && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary bg-bg/40 px-3 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-accent">
              Respondendo a {respondendoA.remetenteTipo === "operador" ? "você mesmo" : respondendoA.remetenteTipo === "maisa" ? "Maisa" : "cliente"}
            </p>
            <p className="truncate text-xs text-muted">{previewDaMensagem(respondendoA)}</p>
          </div>
          <button type="button" onClick={onCancelarResposta} className="shrink-0 text-muted hover:text-accent">
            <X size={14} />
          </button>
        </div>
      )}

      {arquivo && audioGravado && previewUrl ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-bg/40 px-3 py-2">
          <Mic size={14} className="shrink-0 text-muted" />
          <audio controls src={previewUrl} className="h-8 flex-1" style={{ maxWidth: "100%" }} />
          <button
            type="button"
            onClick={cancelarAudio}
            title="Descartar e gravar de novo"
            className="shrink-0 text-muted hover:text-accent"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        arquivo && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <Paperclip size={12} />
            {arquivo.name}
            <button type="button" onClick={cancelarAudio} className="text-accent hover:underline">
              <X size={12} />
            </button>
          </div>
        )
      )}

      {erro && <p className="mb-2 text-xs text-accent">{erro}</p>}

      <div className="flex items-center gap-2">
        {gravando ? (
          <div className="flex flex-1 items-center gap-2 rounded-md border border-primary bg-bg/60 px-3 py-2 text-sm">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            <span className="flex-1 text-ink">Gravando... {formatarTempo(tempoGravacao)}</span>
            <button
              type="button"
              onClick={pararGravacao}
              className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <Square size={12} /> Parar
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputArquivoRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                setAudioGravado(false);
                setArquivo(e.target.files?.[0] ?? null);
              }}
            />
            <button
              type="button"
              onClick={() => inputArquivoRef.current?.click()}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:border-primary hover:text-accent"
            >
              <Paperclip size={16} />
            </button>

            <button
              type="button"
              onClick={iniciarGravacao}
              title="Gravar áudio"
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:border-primary hover:text-accent"
            >
              <Mic size={16} />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                // Enter sozinho manda; Shift+Enter quebra parágrafo, igual WhatsApp.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                }
              }}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData.items);
                const fileItem = items.find((i) => i.kind === "file");
                if (fileItem) {
                  const file = fileItem.getAsFile();
                  if (file) {
                    e.preventDefault();
                    setAudioGravado(false);
                    setArquivo(file);
                  }
                }
              }}
              placeholder="Digite uma mensagem..."
              className="max-h-[120px] flex-1 resize-none rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />

            <button
              type="submit"
              disabled={enviando || (!texto.trim() && !arquivo)}
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-marca-indigo hover:opacity-90 disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </>
        )}
      </div>
    </form>
  );
}
