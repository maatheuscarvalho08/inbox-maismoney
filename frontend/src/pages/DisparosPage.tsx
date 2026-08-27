import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Send } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { StatusEntregaIcone } from "../components/conversa/StatusEntregaIcone";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { Mensagem, StatusEntrega } from "../types/api";

interface DisparoHistorico extends Mensagem {
  conversa: {
    id: string;
    contato: { nome: string | null; numeroWhatsapp: string };
    instancia: { id: string; nome: string; numero: string };
  };
}

function extrairNomeTemplate(texto: string | null) {
  const match = texto?.match(/template "([^"]+)"/);
  return match?.[1] ?? "—";
}

const STATUS_LABEL: Record<StatusEntrega, string> = {
  enviado: "Enviado",
  entregue: "Entregue",
  lido: "Lido",
  falhou: "Falhou",
};

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DisparosPage() {
  const [disparos, setDisparos] = useState<DisparoHistorico[]>([]);
  const [carregando, setCarregando] = useState(true);

  function carregar() {
    api.get<{ disparos: DisparoHistorico[] }>("/disparos").then((res) => {
      setDisparos(res.disparos);
      setCarregando(false);
    });
  }

  useEffect(() => {
    carregar();
  }, []);

  // Cada disparo (individual ou dentro de um CSV em andamento) emite mensagem:nova
  // assim que é enviado — a lista atualiza sozinha em tempo real, sem precisar
  // de um conceito separado de "campanha em andamento".
  useSocketEvent("mensagem:nova", () => carregar());

  return (
    <div>
      <PageHeader
        title="Disparos"
        subtitle="Histórico de envios via templates aprovados (Meta Cloud API)"
        right={
          <Link
            to="/disparos/novo"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
          >
            <Plus size={14} /> Novo disparo
          </Link>
        }
      />

      <div className="p-8">
        {!carregando && disparos.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <Send size={22} className="text-muted" />
            <p className="text-sm text-muted">Nenhum disparo enviado ainda.</p>
            <Link to="/disparos/novo" className="text-xs font-medium text-primary hover:underline">
              Enviar o primeiro disparo
            </Link>
          </div>
        )}

        {disparos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-surface/40 backdrop-blur-xl">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  {["Número", "Template", "Origem", "Status", "Enviado por", "Quando"].map((col) => (
                    <th key={col} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disparos.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium text-white">
                      {d.conversa.contato.nome ?? d.conversa.contato.numeroWhatsapp}
                    </td>
                    <td className="px-5 py-3 text-muted">{extrairNomeTemplate(d.conteudoTexto)}</td>
                    <td className="px-5 py-3 text-muted">{d.conversa.instancia.numero}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-muted">
                        <StatusEntregaIcone status={d.statusEntrega} />
                        {d.statusEntrega ? STATUS_LABEL[d.statusEntrega] : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted">{d.operador?.nome ?? "—"}</td>
                    <td className="px-5 py-3 text-muted">{formatarData(d.timestamp)}</td>
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
