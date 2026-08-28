import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PhoneCall } from "lucide-react";
import { api } from "../lib/api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { StatusLigacao } from "../types/api";

interface DiscagemAtiva {
  id: string;
  numeroWhatsapp: string;
  nomeContato: string | null;
  statusLigacao: StatusLigacao;
  apertou1: boolean;
  hsmDisparado: boolean;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  campanha: { id: string; nome: string };
}

interface RespostaDiscagens {
  limiteSimultaneas: number;
  emAndamento: DiscagemAtiva[];
  recentes: DiscagemAtiva[];
  naFila: number;
}

const LIGACAO_LABEL: Record<StatusLigacao, string> = {
  pendente: "Pendente",
  discando: "Chamando",
  atendeu: "Atendeu",
  nao_atendeu: "Não atendeu",
  ocupado: "Ocupado",
  erro: "Erro",
};

const LIGACAO_STYLE: Record<StatusLigacao, string> = {
  pendente: "text-muted",
  discando: "text-[var(--color-accent-fg)]",
  atendeu: "text-primary",
  nao_atendeu: "text-muted",
  ocupado: "text-muted",
  erro: "text-primary",
};

function horario(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Indicador({ valor, label }: { valor: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-2xl font-bold text-white">{valor}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

export function DiscagensAoVivo() {
  const [dados, setDados] = useState<RespostaDiscagens | null>(null);

  function carregar() {
    api.get<RespostaDiscagens>("/campanhas/discagens/ativas").then(setDados);
  }

  useEffect(() => {
    carregar();
    // O status de uma ligação muda por webhook do Twilio, que nem sempre coincide com
    // um evento de campanha — um intervalo curto garante que o painel não fique parado.
    const timer = setInterval(carregar, 4000);
    return () => clearInterval(timer);
  }, []);

  useSocketEvent("campanha:atualizada", () => carregar());

  if (!dados) {
    return <p className="text-sm text-muted">Carregando...</p>;
  }

  const { emAndamento, recentes, naFila, limiteSimultaneas } = dados;
  const convertidos = recentes.filter((r) => r.apertou1).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador valor={`${emAndamento.length} / ${limiteSimultaneas}`} label="Ligações simultâneas" />
        <Indicador valor={naFila} label="Na fila" />
        <Indicador valor={recentes.length} label="Encerradas (últimas)" />
        <Indicador valor={convertidos} label="Converteram (apertou 1)" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white">Em andamento</h2>
        {emAndamento.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
            <PhoneCall size={20} className="text-muted" />
            <p className="text-sm text-muted">Nenhuma ligação acontecendo agora.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr>
                  {["Número", "Campanha", "Status", "Início"].map((col) => (
                    <th key={col} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {emAndamento.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium text-white">{d.nomeContato ?? d.numeroWhatsapp}</td>
                    <td className="px-5 py-3 text-muted">
                      <Link to={`/discadora/${d.campanha.id}`} className="hover:text-primary hover:underline">
                        {d.campanha.nome}
                      </Link>
                    </td>
                    <td className={`px-5 py-3 font-medium ${LIGACAO_STYLE[d.statusLigacao]}`}>
                      {LIGACAO_LABEL[d.statusLigacao]}
                    </td>
                    <td className="px-5 py-3 text-muted">{horario(d.iniciadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-white">Encerradas recentemente</h2>
        {recentes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted">
            Nenhuma ligação encerrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  {["Número", "Campanha", "Resultado", "Apertou 1", "WhatsApp enviado", "Fim"].map((col) => (
                    <th key={col} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentes.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium text-white">{d.nomeContato ?? d.numeroWhatsapp}</td>
                    <td className="px-5 py-3 text-muted">
                      <Link to={`/discadora/${d.campanha.id}`} className="hover:text-primary hover:underline">
                        {d.campanha.nome}
                      </Link>
                    </td>
                    <td className={`px-5 py-3 font-medium ${LIGACAO_STYLE[d.statusLigacao]}`}>
                      {LIGACAO_LABEL[d.statusLigacao]}
                    </td>
                    <td className="px-5 py-3 text-muted">{d.apertou1 ? "Sim" : "Não"}</td>
                    <td className="px-5 py-3 text-muted">{d.hsmDisparado ? "Sim" : "Não"}</td>
                    <td className="px-5 py-3 text-muted">{horario(d.finalizadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
