import { Bot } from "../icones";
import type { Mensagem } from "../../types/api";

// Nota interna da Maisa ao passar a conversa: o que ela fez, onde simulou e o que voltou.
// Só a equipe vê. Nunca vai para o WhatsApp.
export function NotaMaisa({ mensagem }: { mensagem: Mensagem }) {
  const hora = new Date(mensagem.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="my-2 flex justify-center">
      <div className="w-full max-w-2xl rounded-lg border border-dashed border-indigo-claro/40 bg-indigo-claro/5 px-4 py-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-claro">
          <Bot size={13} aria-hidden="true" />
          Nota da Maisa para a equipe
          <span className="ml-auto font-normal normal-case tracking-normal text-muted">{hora} · só a equipe vê</span>
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{mensagem.conteudoTexto}</p>
      </div>
    </div>
  );
}
