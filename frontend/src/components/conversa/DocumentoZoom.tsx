import { useEffect, useState } from "react";
import { ArrowsOut, Check, Copy, Minus, Plus, X } from "../icones";
import { carregarMidia } from "../../lib/midia";

// Documento do cliente com zoom. Imagem: botões e Ctrl+roda. PDF: leitor do navegador,
// que já tem zoom e deixa selecionar e copiar o texto.
export function DocumentoZoom({ mensagemId, tipoMidia }: { mensagemId: string; tipoMidia: string }) {
  const pdf = tipoMidia === "application/pdf";
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cheia, setCheia] = useState(false);

  useEffect(() => {
    let atual: string | null = null;
    setErro(false);
    carregarMidia(mensagemId, pdf ? "application/pdf" : undefined)
      .then((u) => {
        atual = u;
        setUrl(u);
      })
      .catch(() => setErro(true));
    return () => {
      if (atual) URL.revokeObjectURL(atual);
    };
  }, [mensagemId, pdf]);

  useEffect(() => {
    if (!cheia) return;
    const sair = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setCheia(false);
      }
    };
    window.addEventListener("keydown", sair, true);
    return () => window.removeEventListener("keydown", sair, true);
  }, [cheia]);

  if (erro) return <p className="text-xs text-muted">Mídia indisponível (pode ter sido removida após 4 dias de inatividade)</p>;
  if (!url) return <div className="h-64 w-full animate-pulse rounded-md bg-border" />;

  const mudar = (d: number) => setZoom((z) => Math.min(5, Math.max(0.5, Math.round((z + d) * 4) / 4)));
  const botao = "flex size-7 items-center justify-center rounded-md border border-border bg-bg text-ink hover:border-primary";

  const barra = (
    <div className="mb-2 flex items-center gap-1.5">
      {!pdf && (
        <>
          <button onClick={() => mudar(-0.25)} className={botao} aria-label="Diminuir zoom"><Minus size={13} /></button>
          <button onClick={() => setZoom(1)} className="h-7 min-w-12 rounded-md border border-border bg-bg px-2 text-xs tabular-nums text-ink hover:border-primary" title="Voltar ao tamanho normal">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => mudar(0.25)} className={botao} aria-label="Aumentar zoom"><Plus size={13} /></button>
        </>
      )}
      {pdf && <span className="text-xs text-muted">Use o zoom do leitor. O texto pode ser selecionado e copiado.</span>}
      <button onClick={() => setCheia((c) => !c)} className={`${botao} ml-auto`} aria-label={cheia ? "Sair da tela cheia" : "Tela cheia"}>
        {cheia ? <X size={13} /> : <ArrowsOut size={13} />}
      </button>
    </div>
  );

  const conteudo = pdf ? (
    <iframe src={url} title="Documento" className={`w-full rounded-md border border-border bg-white ${cheia ? "h-full" : "h-[60vh]"}`} />
  ) : (
    <div
      className={`overflow-auto rounded-md border border-border bg-bg ${cheia ? "h-full" : "h-[60vh]"}`}
      onWheel={(e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        mudar(e.deltaY < 0 ? 0.25 : -0.25);
      }}
    >
      <img src={url} alt="Documento enviado" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block" />
    </div>
  );

  if (cheia) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 p-4" onClick={(e) => e.stopPropagation()}>
        {barra}
        <div className="min-h-0 flex-1">{conteudo}</div>
      </div>
    );
  }
  return (
    <div>
      {barra}
      {conteudo}
    </div>
  );
}

// Valor lido com botão de copiar.
export function Copiavel({ rotulo, valor }: { rotulo: string; valor: string | number | null | undefined }) {
  const [copiado, setCopiado] = useState(false);
  if (valor == null || valor === "") return null;
  const texto = String(valor);
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted">{rotulo}</span>
      <button
        onClick={() =>
          navigator.clipboard.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1200);
          })
        }
        title="Copiar"
        className="flex items-center gap-1.5 rounded px-1.5 text-sm tabular-nums text-ink hover:bg-bg"
      >
        <span className="select-all">{texto}</span>
        {copiado ? <Check size={12} className="text-accent" /> : <Copy size={12} className="text-muted" />}
      </button>
    </div>
  );
}
