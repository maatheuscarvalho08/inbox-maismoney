import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Mic, Paperclip, Send, Square, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import type { Mensagem, TipoConexao } from "../../types/api";

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
}

export function Composer({ conversaId, tipoConexao, ultimaMensagemClienteEm, onEnviada }: ComposerProps) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [audioGravado, setAudioGravado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

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

  const foraDaJanela =
    tipoConexao === "meta_cloud" &&
    ultimaMensagemClienteEm !== null &&
    Date.now() - new Date(ultimaMensagemClienteEm).getTime() > JANELA_META_MS;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim() && !arquivo) return;

    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("conversaId", conversaId);
      if (texto.trim()) form.append("conteudoTexto", texto.trim());
      if (arquivo) form.append("midia", arquivo);
      if (audioGravado) form.append("audioGravado", "true");

      const res = await api.post<{ mensagem: Mensagem; entregue: boolean }>("/mensagens", form);
      onEnviada(res.mensagem);
      setTexto("");
      setArquivo(null);
      setAudioGravado(false);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível enviar a mensagem");
    } finally {
      setEnviando(false);
    }
  }

  if (foraDaJanela) {
    return (
      <div className="border-t border-border bg-surface/60 p-4 text-center text-sm text-muted">
        Fora da janela de 24h desde a última mensagem do cliente — a Meta Cloud API só permite reenviar através de um
        template aprovado. Use a tela de{" "}
        <Link to="/disparos" className="text-primary hover:underline">
          Disparos
        </Link>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface/60 p-4">
      {arquivo && (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          {audioGravado ? <Mic size={12} /> : <Paperclip size={12} />}
          {audioGravado ? `Áudio gravado (${arquivo.name})` : arquivo.name}
          <button type="button" onClick={cancelarAudio} className="text-primary hover:underline">
            <X size={12} />
          </button>
        </div>
      )}

      {erro && <p className="mb-2 text-xs text-primary">{erro}</p>}

      <div className="flex items-center gap-2">
        {gravando ? (
          <div className="flex flex-1 items-center gap-2 rounded-md border border-primary bg-bg/60 px-3 py-2 text-sm">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            <span className="flex-1 text-white">Gravando... {formatarTempo(tempoGravacao)}</span>
            <button
              type="button"
              onClick={pararGravacao}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
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
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:border-primary hover:text-primary"
            >
              <Paperclip size={16} />
            </button>

            <button
              type="button"
              onClick={iniciarGravacao}
              title="Gravar áudio"
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:border-primary hover:text-primary"
            >
              <Mic size={16} />
            </button>

            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Digite uma mensagem..."
              className="flex-1 rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />

            <button
              type="submit"
              disabled={enviando || (!texto.trim() && !arquivo)}
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-bg hover:opacity-90 disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </>
        )}
      </div>
    </form>
  );
}
