import { useState } from "react";
import { Bot } from "../icones";
import type { Mensagem } from "../../types/api";

// A parte curta da nota vai até o primeiro destes marcadores. O resto (simulações, dados do
// cadastro, números) fica atrás de um botão, só para a conversa não virar um paredão de texto.
const MARCADORES = /(Cliente:|Simulei |SIMULAÇÕES NA FACTA|Vínculo no contracheque|Oferta enviada|DADOS PARA O CADASTRO|NADA FOI OFERTADO|Troco ofertado|Contrato que ela ofertou|Melhor troco|Melhor contrato)/;

function dividirNota(texto: string) {
  const i = texto.search(MARCADORES);
  if (i <= 0) return { resumo: texto, detalhes: "" };
  const resumo = texto.slice(0, i).trim();
  const detalhes = texto.slice(i).replace(new RegExp(`\\s+(?=${MARCADORES.source})`, "g"), "\n").trim();
  return detalhes.length < 60 ? { resumo: texto, detalhes: "" } : { resumo, detalhes };
}

function rotuloDoBotao(detalhes: string) {
  if (/SIMULAÇÕES NA FACTA|Simulei /.test(detalhes)) return "simulação";
  if (/DADOS PARA O CADASTRO/.test(detalhes)) return "dados do cadastro";
  return "detalhes";
}

// Nota interna da Maisa ao passar a conversa: o que ela fez, onde simulou e o que voltou.
// Só a equipe vê. Nunca vai para o WhatsApp.
export function NotaMaisa({ mensagem }: { mensagem: Mensagem }) {
  const [aberta, setAberta] = useState(false);
  const hora = new Date(mensagem.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const { resumo, detalhes } = dividirNota(mensagem.conteudoTexto ?? "");
  const rotulo = rotuloDoBotao(detalhes);
  return (
    <div className="my-2 flex justify-center">
      <div className="w-full max-w-2xl rounded-lg border border-dashed border-indigo-claro/40 bg-indigo-claro/5 px-4 py-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-claro">
          <Bot size={13} aria-hidden="true" />
          Nota da Maisa para a equipe
          <span className="ml-auto font-normal normal-case tracking-normal text-muted">{hora} · só a equipe vê</span>
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{resumo}</p>
        {detalhes && (
          <>
            <button
              type="button"
              onClick={() => setAberta((v) => !v)}
              aria-expanded={aberta}
              className="mt-2 text-xs font-semibold text-accent hover:underline"
            >
              {aberta ? `Esconder ${rotulo}` : `Mostrar ${rotulo}`}
            </button>
            {aberta && (
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-bg/40 p-3 text-xs leading-relaxed text-muted">
                {detalhes}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
