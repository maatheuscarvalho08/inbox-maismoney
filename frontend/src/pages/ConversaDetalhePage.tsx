import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, MoreVertical, Pencil, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { formatarTelefone } from "../lib/telefone";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/StatusBadge";
import { Select } from "../components/Select";
import { MensagemBubble } from "../components/conversa/MensagemBubble";
import { Composer } from "../components/conversa/Composer";
import { PainelLateralConversa } from "../components/conversa/PainelLateralConversa";
import type { Contato, Conversa, Mensagem, StatusConversa, Usuario } from "../types/api";

const STATUS_OPCOES: StatusConversa[] = ["aberta", "em_atendimento", "aguardando", "encerrada"];

export function ConversaDetalhePage() {
  const { id } = useParams<{ id: string }>();

  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [vendedores, setVendedores] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [painelAberto, setPainelAberto] = useState(false);
  const [respondendoA, setRespondendoA] = useState<Mensagem | null>(null);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEditado, setNomeEditado] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const fimDaListaRef = useRef<HTMLDivElement>(null);

  async function salvarNomeContato() {
    if (!conversa) return;
    setSalvandoNome(true);
    setErroNome(null);
    try {
      const { contato } = await api.patch<{ contato: Contato }>(`/contatos/${conversa.contato.id}`, {
        nome: nomeEditado.trim() || null,
      });
      setConversa({ ...conversa, contato });
      setEditandoNome(false);
    } catch (err) {
      setErroNome(err instanceof ApiError ? err.message : "Não foi possível salvar o nome");
    } finally {
      setSalvandoNome(false);
    }
  }

  const carregar = useCallback(async () => {
    if (!id) return;
    const [conversaRes, mensagensRes] = await Promise.all([
      api.get<{ conversa: Conversa }>(`/conversas/${id}`),
      api.get<{ mensagens: Mensagem[] }>(`/mensagens?conversaId=${id}`),
    ]);
    setConversa(conversaRes.conversa);
    setMensagens(mensagensRes.mensagens);
    setCarregando(false);

    // Busca sob demanda ao abrir a conversa (só existe pra números Evolution, e o
    // backend já cacheia por 24h — ver contatos.routes.ts) em vez de trazer isso
    // em toda listagem, que bateria na Evolution API pra cada contato à toa.
    api
      .post<{ contato: Contato }>(`/contatos/${conversaRes.conversa.contato.id}/atualizar-foto`)
      .then(({ contato }) => setConversa((atual) => (atual ? { ...atual, contato } : atual)))
      .catch(() => {});
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
            <Avatar
              nome={conversa.contato.nome ?? conversa.contato.numeroWhatsapp}
              fotoUrl={conversa.contato.fotoUrl}
              tamanho={40}
            />
            <div>
              {editandoNome ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={nomeEditado}
                    onChange={(e) => setNomeEditado(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvarNomeContato();
                      if (e.key === "Escape") setEditandoNome(false);
                    }}
                    placeholder="Nome do cliente"
                    className="rounded border border-primary bg-bg/60 px-1.5 py-0.5 text-sm text-white outline-none"
                  />
                  <button onClick={salvarNomeContato} disabled={salvandoNome} className="text-primary hover:text-white">
                    <Check size={14} />
                  </button>
                  <button onClick={() => setEditandoNome(false)} className="text-muted hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setNomeEditado(conversa.contato.nome ?? "");
                    setErroNome(null);
                    setEditandoNome(true);
                  }}
                  className="group flex items-center gap-1.5 text-sm font-semibold text-white"
                  title="Editar nome do cliente"
                >
                  {conversa.contato.nome ?? "Sem nome"}
                  <Pencil size={11} className="text-muted opacity-0 group-hover:opacity-100" />
                </button>
              )}
              <p className="text-xs text-muted">
                {formatarTelefone(conversa.contato.numeroWhatsapp)} · {conversa.instancia.nome}
              </p>
              {erroNome && <p className="text-[11px] text-primary">{erroNome}</p>}
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
            <MensagemBubble
              key={m.id}
              mensagem={m}
              contatoNome={conversa.contato.nome ?? conversa.contato.numeroWhatsapp}
              contatoFotoUrl={conversa.contato.fotoUrl}
              podeEditar={conversa.instancia.tipoConexao === "evolution"}
              onEditada={(atualizada) =>
                setMensagens((atual) => atual.map((mm) => (mm.id === atualizada.id ? atualizada : mm)))
              }
              onResponder={setRespondendoA}
            />
          ))}
          <div ref={fimDaListaRef} />
        </div>

        <Composer
          conversaId={conversa.id}
          tipoConexao={conversa.instancia.tipoConexao}
          ultimaMensagemClienteEm={ultimaDoCliente?.timestamp ?? null}
          respondendoA={respondendoA}
          onCancelarResposta={() => setRespondendoA(null)}
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
