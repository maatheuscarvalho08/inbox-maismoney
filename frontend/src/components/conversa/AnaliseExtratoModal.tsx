import { useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, X } from "../icones";
import { api, ApiError } from "../../lib/api";
import { MidiaMensagem } from "./MidiaMensagem";
import { carregarMidia } from "../../lib/midia";
import type { Mensagem } from "../../types/api";

interface Margem {
  calculada: number | null;
  informada: number | null;
  usada: number;
}

interface ContratoAnalisado {
  banco: string;
  numero: string | null;
  parcela: number | null;
  parcelasRestantes: number | null;
  taxaMensal: number | null;
  saldoDevedorEstimado: number | null;
}

type Possibilidade = {
  tipo: "novo" | "cartao_rmc" | "cartao_rcc" | "refin" | "portabilidade";
  possivel: boolean;
  motivo: string;
  parcelaMaxima?: number;
  margem?: number;
  contratos?: ContratoAnalisado[];
};

interface Resultado {
  analise: {
    convenio: "inss" | "siape" | null;
    confiavel: boolean;
    resumo: string;
    alertas: string[];
    margens: { emprestimo: Margem; rmc: Margem; rcc: Margem };
    comprometimento: { total: number; limite: number | null; percentual: number | null };
    possibilidades: Possibilidade[];
  };
  leitura: { especie_codigo: number | null; especie_descricao: string | null; base_calculo: number | null; competencia: string | null };
  // Guardada: quem leu ("maisa" ou id do usuário), quando, e o motivo se a Maisa recusou o documento.
  origem?: string;
  lidoEm?: string;
  recusa?: string;
}

const NOME: Record<Possibilidade["tipo"], string> = {
  novo: "Empréstimo novo",
  cartao_rmc: "Cartão consignado (RMC)",
  cartao_rcc: "Cartão benefício (RCC)",
  refin: "Refinanciamento",
  portabilidade: "Portabilidade",
};

const reais = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// O PDF aberto ao lado, para conferir sem baixar.
function PdfAberto({ mensagemId }: { mensagemId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let atual: string | null = null;
    carregarMidia(mensagemId, "application/pdf")
      .then((u) => {
        atual = u;
        setUrl(u);
      })
      .catch(() => setUrl(null));
    return () => {
      if (atual) URL.revokeObjectURL(atual);
    };
  }, [mensagemId]);
  if (!url) return <MidiaMensagem mensagemId={mensagemId} tipoMidia="application/pdf" />;
  return <iframe src={url} title="Extrato" className="h-[60vh] w-full rounded-md border border-border bg-white" />;
}

interface Props {
  mensagem: Mensagem | null;
  onFechar: () => void;
}

// O extrato de um lado e a análise do outro: o atendente confere antes de oferecer.
export function AnaliseExtratoModal({ mensagem, onFechar }: Props) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Pedido de leitura nova, preso à mensagem em que foi feito.
  const [releitura, setReleitura] = useState<{ id: string; n: number } | null>(null);
  const refazer = Boolean(mensagem && releitura?.id === mensagem.id);
  const nReleitura = releitura?.n ?? 0;

  useEffect(() => {
    if (!mensagem) return;
    setResultado(null);
    setErro(null);
    // Abre a análise guardada. "Ler de novo" pede uma leitura nova.
    api
      .post<Resultado>(`/extratos/mensagens/${mensagem.id}${refazer ? "?refazer=1" : ""}`)
      .then(setResultado)
      .catch((err) => setErro(err instanceof ApiError ? err.message : "Não foi possível analisar o extrato"));
  }, [mensagem, refazer, nReleitura]);

  useEffect(() => {
    if (!mensagem) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [mensagem, onFechar]);

  if (!mensagem?.tipoMidia) return null;
  const a = resultado?.analise;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analise-extrato-titulo"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-surface"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="analise-extrato-titulo" className="text-base font-bold text-ink">
            Análise do extrato
          </h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[2fr_3fr]">
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted">Extrato enviado pelo cliente</p>
            {mensagem.tipoMidia === "application/pdf" ? (
              <PdfAberto mensagemId={mensagem.id} />
            ) : (
              <MidiaMensagem mensagemId={mensagem.id} tipoMidia={mensagem.tipoMidia} />
            )}
          </div>

          <div className="min-w-0 space-y-5">
            {!a && !erro && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Lendo o extrato. Pode levar até um minuto.
              </p>
            )}
            {erro && <p className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm text-ink">{erro}</p>}

            {a && (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted">
                    {a.convenio === "siape" ? "SIAPE" : a.convenio === "inss" ? "INSS" : "Documento"}
                    {resultado?.leitura.especie_codigo ? ` · espécie ${resultado.leitura.especie_codigo}` : ""}
                    {resultado?.leitura.base_calculo ? ` · base ${reais(resultado.leitura.base_calculo)}` : ""}
                  </p>
                  <p className="mt-1 text-lg font-bold text-ink">{resultado?.recusa ? `Não passou: ${resultado.recusa}.` : a.resumo}</p>
                  {resultado?.lidoEm && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      {resultado.origem === "maisa" ? "Lido pela Maisa" : "Lido pela equipe"} em{" "}
                      {new Date(resultado.lidoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      <button onClick={() => mensagem && setReleitura((r) => ({ id: mensagem.id, n: (r?.n ?? 0) + 1 }))} className="font-semibold text-accent hover:underline">
                        Ler de novo
                      </button>
                    </p>
                  )}
                  {!a.confiavel && (
                    <p className="mt-1 text-xs font-semibold text-accent">Leitura com dúvida: confira os números com o extrato.</p>
                  )}
                </div>

                <ul className="divide-y divide-border rounded-md border border-border">
                  {a.possibilidades.map((p) => (
                    <li key={p.tipo} className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                            p.possivel ? "bg-primary text-marca-indigo" : "border border-border text-muted"
                          }`}
                        >
                          {p.possivel ? <Check size={12} aria-hidden="true" /> : <X size={11} aria-hidden="true" />}
                        </span>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${p.possivel ? "text-ink" : "text-muted"}`}>{NOME[p.tipo]}</p>
                          <p className="text-xs text-muted">{p.motivo}</p>
                        </div>
                      </div>
                      {p.possivel && p.contratos && p.contratos.length > 0 && (
                        <table className="ml-7 mt-2 w-[calc(100%-1.75rem)] text-xs">
                          <thead className="text-left text-muted">
                            <tr>
                              <th className="font-medium">Banco</th>
                              <th className="font-medium">Parcela</th>
                              <th className="font-medium">Faltam</th>
                              <th className="font-medium">Taxa</th>
                              <th className="font-medium">Saldo estimado</th>
                            </tr>
                          </thead>
                          <tbody className="text-ink">
                            {p.contratos.map((c, i) => (
                              <tr key={`${c.numero}-${i}`}>
                                <td className="py-0.5 pr-2">{c.banco}</td>
                                <td className="pr-2 tabular-nums">{reais(c.parcela)}</td>
                                <td className="pr-2 tabular-nums">{c.parcelasRestantes ?? "—"}</td>
                                <td className="pr-2 tabular-nums">{c.taxaMensal != null ? `${c.taxaMensal}%` : "—"}</td>
                                <td className="tabular-nums">{reais(c.saldoDevedorEstimado)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </li>
                  ))}
                </ul>

                <div>
                  <p className="mb-1.5 text-sm font-semibold text-ink">Margens</p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="font-medium"></th>
                        <th className="font-medium">No extrato</th>
                        <th className="font-medium">Pela conta</th>
                      </tr>
                    </thead>
                    <tbody className="text-ink">
                      {(
                        [
                          ["Empréstimo", a.margens.emprestimo],
                          ["Cartão RMC", a.margens.rmc],
                          ["Cartão RCC", a.margens.rcc],
                        ] as const
                      ).map(([nome, m]) => (
                        <tr key={nome}>
                          <td className="py-0.5 pr-2 text-muted">{nome}</td>
                          <td className="pr-2 tabular-nums">{reais(m.informada)}</td>
                          <td className="tabular-nums">{reais(m.calculada)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {a.comprometimento.limite != null && (
                    <p className="mt-1.5 text-xs text-muted">
                      Comprometido: {reais(a.comprometimento.total)} de {reais(a.comprometimento.limite)}
                      {a.comprometimento.percentual != null ? ` (${a.comprometimento.percentual}% da base)` : ""}
                    </p>
                  )}
                </div>

                {a.alertas.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-ink">Atenção</p>
                    <ul className="space-y-1">
                      {a.alertas.map((t) => (
                        <li key={t} className="flex gap-1.5 text-xs text-ink">
                          <CircleAlert size={13} className="mt-px shrink-0 text-accent" aria-hidden="true" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
          A análise é uma ajuda. Confira os números com o extrato antes de oferecer ou digitar.
        </p>
      </div>
    </div>
  );
}
