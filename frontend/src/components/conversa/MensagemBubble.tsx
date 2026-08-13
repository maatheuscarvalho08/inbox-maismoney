import { MidiaMensagem } from "./MidiaMensagem";
import type { Mensagem } from "../../types/api";

function formatarHorario(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MensagemBubble({ mensagem }: { mensagem: Mensagem }) {
  const doOperador = mensagem.remetenteTipo === "operador";

  return (
    <div className={`flex ${doOperador ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg border px-3 py-2 ${
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

        {mensagem.conteudoTexto && <p className="mt-1 text-sm text-white">{mensagem.conteudoTexto}</p>}

        <p className="mt-1 text-right text-[10px] text-muted">{formatarHorario(mensagem.timestamp)}</p>
      </div>
    </div>
  );
}
