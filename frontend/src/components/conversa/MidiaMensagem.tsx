import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { carregarMidia } from "../../lib/midia";
import { AudioPlayer } from "./AudioPlayer";

export function MidiaMensagem({ mensagemId, tipoMidia }: { mensagemId: string; tipoMidia: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    carregarMidia(mensagemId)
      .then((u) => {
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setErro(true));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mensagemId]);

  if (erro) {
    return <p className="text-xs text-muted">Mídia indisponível (pode ter sido removida após 4 dias de inatividade)</p>;
  }

  if (!url) {
    return <div className="h-32 w-48 animate-pulse rounded-md bg-border" />;
  }

  if (tipoMidia.startsWith("image/")) {
    return <img src={url} alt="Mídia enviada" className="max-h-64 max-w-64 rounded-md object-cover" />;
  }

  if (tipoMidia.startsWith("video/")) {
    return <video src={url} controls className="max-h-64 max-w-64 rounded-md" />;
  }

  if (tipoMidia.startsWith("audio/")) {
    return <AudioPlayer src={url} />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-border bg-bg/40 px-3 py-2 text-xs text-white hover:border-primary"
    >
      <FileText size={14} />
      Abrir arquivo
    </a>
  );
}
