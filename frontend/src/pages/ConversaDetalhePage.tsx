import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { api } from "../lib/api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/StatusBadge";
import { Select } from "../components/Select";
import { MensagemBubble } from "../components/conversa/MensagemBubble";
import { Composer } from "../components/conversa/Composer";
import { PainelLateralConversa } from "../components/conversa/PainelLateralConversa";
import type { Conversa, Mensagem, StatusConversa, Usuario } from "../types/api";

const STATUS_OPCOES: StatusConversa[] = ["aberta", "em_atendimento", "aguardando", "encerrada"];

export function ConversaDetalhePage() {
  const { id } = useParams<{ id: string }>();

  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [vendedores, setVendedores] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [painelAberto, setPainelAberto] = useState(false);
  const fimDaListaRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    const [conversaRes, mensagensRes] = await Promise.all([
      api.get<{ conversa: Conversa }>(`/conversas/${id}`),
      api.get<{ mensagens: Mensagem[] }>(`/mensagens?conversaId=${id}`),
    ]);
    setConversa(conversaRes.conversa);
    setMensagens(mensagensRes.mensagens);
    setCarregando(false);
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    api.get<{ usuarios: Usuario[] }>("/usuarios").then((res) => setVendedores(res.usuarios.filter((u) => u.ativo)));
  }, []);

  useEffect(() => {
    fimDaListaRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  useSocketEvent<Mensagem>("mensagem:nova", (msg) => {
    if (msg.conversaId !== id) return;
    // Mesmo evento serve pra mensagem nova e pra atualização de status de entrega
    // (enviado→entregue→lido) — se já existe, substitui em vez de ignorar.
    setMensagens((atual) =>
      atual.some((m) => m.id === msg.id) ? atual.map((m) => (m.id === msg.id ? msg : m)) : [...atual, msg],
    );
  });

  useSocketEvent<Conversa>("conversa:atualizada", (c) => {
    if (c.id === id) setConversa(c);
  });

  async function atualizarStatus(status: StatusConversa) {
    if (!id) return;
    const res = await api.patch<{ conversa: Conversa }>(`/conversas/${id}`, { status });
    setConversa(res.conversa);
  }

  async function atualizarVendedor(operadorId: string) {
    if (!id) return;
    const res = await api.patch<{ conversa: Conversa }>(`/conversas/${id}`, { operadorId: operadorId || null });
    setConversa(res.conversa);
  }

  if (carregando || !conversa) {
    return <div className="p-8 text-sm text-muted">Carregando...</div>;
  }

  const ultimaDoCliente = [...mensagens].reverse().find((m) => m.remetenteTipo === "cliente");

  return (
    <div className="flex h-full">
      <div className="flex h-full flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-8 py-4">
          <div className="flex items-center gap-3">
            <Avatar nome={conversa.contato.nome ?? conversa.contato.numeroWhatsapp} />
            <div>
              <p className="text-sm font-semibold text-white">{conversa.contato.nome ?? "Sem nome"}</p>
              <p className="text-xs text-muted">
                {conversa.contato.numeroWhatsapp} · {conversa.instancia.nome}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={conversa.status} />

            <Select
              value={conversa.operadorId ?? ""}
              onChange={atualizarVendedor}
              options={[{ value: "", label: "Sem vendedor" }, ...vendedores.map((v) => ({ value: v.id, label: v.nome }))]}
            />

            <Select
              value={conversa.status}
              onChange={(v) => atualizarStatus(v as StatusConversa)}
              options={STATUS_OPCOES.map((s) => ({ value: s, label: s.replace("_", " ") }))}
            />

            <button
              onClick={() => setPainelAberto((v) => !v)}
              title="Mais opções"
              className={`flex size-8 items-center justify-center rounded-md border ${
                painelAberto ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-white"
              }`}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-8">
          {mensagens.length === 0 && <p className="text-center text-sm text-muted">Nenhuma mensagem ainda.</p>}
          {mensagens.map((m) => (
            <MensagemBubble key={m.id} mensagem={m} />
          ))}
          <div ref={fimDaListaRef} />
        </div>

        <Composer
          conversaId={conversa.id}
          tipoConexao={conversa.instancia.tipoConexao}
          ultimaMensagemClienteEm={ultimaDoCliente?.timestamp ?? null}
          onEnviada={(msg) =>
            setMensagens((atual) => (atual.some((m) => m.id === msg.id) ? atual : [...atual, msg]))
          }
        />
      </div>

      {painelAberto && (
        <PainelLateralConversa
          conversa={conversa}
          onFechar={() => setPainelAberto(false)}
          onConversaAtualizada={setConversa}
        />
      )}
    </div>
  );
}
