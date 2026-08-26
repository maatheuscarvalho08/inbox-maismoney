import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

function formatarTempo(segundos: number) {
  if (!Number.isFinite(segundos)) return "0:00";
  const m = Math.floor(segundos / 60);
  const s = Math.floor(segundos % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [posicao, setPosicao] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => setDuracao(audio.duration);
    const onTimeUpdate = () => setPosicao(audio.currentTime);
    const onEnded = () => {
      setTocando(false);
      setPosicao(0);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function alternar() {
    const audio = audioRef.current;
    if (!audio) return;
    if (tocando) {
      audio.pause();
    } else {
      audio.play();
    }
    setTocando(!tocando);
  }

  function buscar(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const novaPosicao = Number(e.target.value);
    audio.currentTime = novaPosicao;
    setPosicao(novaPosicao);
  }

  const progresso = duracao > 0 ? (posicao / duracao) * 100 : 0;

  return (
    <div className="flex w-56 items-center gap-2.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onClick={alternar}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-bg hover:opacity-90"
      >
        {tocando ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duracao || 0}
          step={0.1}
          value={posicao}
          onChange={buscar}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          style={{ background: `linear-gradient(to right, var(--color-primary) ${progresso}%, var(--color-border) ${progresso}%)` }}
        />
        <span className="text-[10px] text-muted">{formatarTempo(tocando || posicao > 0 ? posicao : duracao)}</span>
      </div>
    </div>
  );
}
