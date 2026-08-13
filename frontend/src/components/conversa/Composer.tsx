import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Paperclip, Send, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import type { Mensagem, TipoConexao } from "../../types/api";

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
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

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

      const res = await api.post<{ mensagem: Mensagem; entregue: boolean }>("/mensagens", form);
      onEnviada(res.mensagem);
      setTexto("");
      setArquivo(null);
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
          <Paperclip size={12} />
          {arquivo.name}
          <button type="button" onClick={() => setArquivo(null)} className="text-primary hover:underline">
            <X size={12} />
          </button>
        </div>
      )}

      {erro && <p className="mb-2 text-xs text-primary">{erro}</p>}

      <div className="flex items-center gap-2">
        <input
          ref={inputArquivoRef}
          type="file"
          className="hidden"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputArquivoRef.current?.click()}
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:border-primary hover:text-primary"
        >
          <Paperclip size={16} />
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
      </div>
    </form>
  );
}
