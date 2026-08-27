import { useEffect, useState } from "react";
import { Plus, Send } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { NovoDisparoForm } from "../components/NovoDisparoForm";
import { StatusEntregaIcone } from "../components/conversa/StatusEntregaIcone";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { StatusEntrega } from "../types/api";

interface DisparoAgrupado {
  id: string;
  totalNumeros: number;
  contato: { nome: string | null; numeroWhatsapp: string } | null;
  conteudoTexto: string | null;
  instancia: { id: string; nome: string; numero: string };
  operador: { id: string; nome: string } | null;
  timestamp: string;
  statusEntrega: StatusEntrega | null;
  resumoStatus: { enviado: number; entregue: number; lido: number; falhou: number };
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

function ResumoStatusBadges({ resumo }: { resumo: DisparoAgrupado["resumoStatus"] }) {
  const itens = (
    [
      { status: "entregue", qtd: resumo.entregue },
      { status: "lido", qtd: resumo.lido },
      { status: "enviado", qtd: resumo.enviado },
      { status: "falhou", qtd: resumo.falhou },
    ] satisfies { status: StatusEntrega; qtd: number }[]
  ).filter((i) => i.qtd > 0);

  if (itens.length === 0) return <span className="text-muted">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {itens.map((i) => (
        <span key={i.status} className="flex items-center gap-1 text-muted">
          <StatusEntregaIcone status={i.status} />
          {i.qtd}
        </span>
      ))}
    </div>
  );
}

export function DisparosPage() {
  const [disparos, setDisparos] = useState<DisparoAgrupado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarNovo, setMostrarNovo] = useState(false);

  function carregar() {
    api.get<{ disparos: DisparoAgrupado[] }>("/disparos").then((res) => {
      setDisparos(res.disparos);
      setCarregando(false);
    });
  }

  useEffect(() => {
    carregar();
  }, []);

  // Cada disparo (individual ou dentro de um CSV em andamento) emite mensagem:nova
  // assim que é enviado — a lista atualiza sozinha em tempo real.
  useSocketEvent("mensagem:nova", () => carregar());

  return (
    <div>
      <PageHeader
        title="Disparos"
        subtitle="Histórico de envios via templates aprovados (Meta Cloud API)"
        right={
          <button
            onClick={() => setMostrarNovo(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
          >
            <Plus size={14} /> Novo disparo
          </button>
        }
      />

      <div className="p-8">
        {!carregando && disparos.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <Send size={22} className="text-muted" />
            <p className="text-sm text-muted">Nenhum disparo enviado ainda.</p>
            <button onClick={() => setMostrarNovo(true)} className="text-xs font-medium text-primary hover:underline">
              Enviar o primeiro disparo
            </button>
          </div>
        )}

        {disparos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-surface/40 backdrop-blur-xl">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  {["Quantidade de números", "Template", "Origem", "Status", "Enviado por", "Quando"].map((col) => (
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
                      {d.totalNumeros > 1
                        ? `${d.totalNumeros} números`
                        : (d.contato?.nome ?? d.contato?.numeroWhatsapp ?? "1 número")}
                    </td>
                    <td className="px-5 py-3 text-muted">{extrairNomeTemplate(d.conteudoTexto)}</td>
                    <td className="px-5 py-3 text-muted">{d.instancia.numero}</td>
                    <td className="px-5 py-3">
                      {d.totalNumeros > 1 ? (
                        <ResumoStatusBadges resumo={d.resumoStatus} />
                      ) : (
                        <span className="flex items-center gap-1.5 text-muted">
                          <StatusEntregaIcone status={d.statusEntrega} />
                          {d.statusEntrega ? STATUS_LABEL[d.statusEntrega] : "—"}
                        </span>
                      )}
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

      {mostrarNovo && (
        <Modal onClose={() => setMostrarNovo(false)}>
          <NovoDisparoForm onFechar={() => setMostrarNovo(false)} onEnviado={carregar} />
        </Modal>
      )}
    </div>
  );
}
