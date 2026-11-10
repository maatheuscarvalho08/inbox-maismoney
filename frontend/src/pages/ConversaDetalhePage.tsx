import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Bot, Check, MoreVertical, Pencil, Send, X } from "../components/icones";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PREFIXO_NUMERO_TESTE, useMaisaConfig } from "../lib/maisa";
import { formatarTelefone } from "../lib/telefone";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/StatusBadge";
import { Select } from "../components/Select";
import { MensagemBubble } from "../components/conversa/MensagemBubble";
import { Composer } from "../components/conversa/Composer";
import { PainelLateralConversa } from "../components/conversa/PainelLateralConversa";
import { MaisaProgresso } from "../components/maisa/MaisaProgresso";
import { MaisaFluxoModal } from "../components/maisa/MaisaFluxoModal";
import { AnaliseExtratoModal } from "../components/conversa/AnaliseExtratoModal";
import type { Contato, Conversa, Mensagem, StatusConversa, Usuario } from "../types/api";

const STATUS_OPCOES: StatusConversa[] = ["aberta", "em_atendimento", "aguardando", "encerrada"];

function rotuloDia(data: Date) {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmodia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mesmodia(data, hoje)) return "Hoje";
  if (mesmodia(data, ontem)) return "Ontem";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function ConversaDetalhePage() {
  const { usuario } = useAuth();
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
  const maisaConfig = useMaisaConfig();
  const [textoTeste, setTextoTeste] = useState("");
  const [enviandoTeste, setEnviandoTeste] = useState(false);
  const [erroTeste, setErroTeste] = useState<string | null>(null);
  const [guiaMaisaAberto, setGuiaMaisaAberto] = useState(false);
  const fecharGuiaMaisa = useCallback(() => setGuiaMaisaAberto(false), []);
  const [extratoEmAnalise, setExtratoEmAnalise] = useState<Mensagem | null>(null);
  const fecharAnaliseExtrato = useCallback(() => setExtratoEmAnalise(null), []);

  // Simulador: manda a mensagem como se fosse o cliente e a Maisa responde.
  async function enviarComoCliente() {
    const texto = textoTeste.trim();
    if (!id || !texto) return;
    setEnviandoTeste(true);
    setErroTeste(null);
    try {
      await api.post("/maisa/simulador/mensagens", { conversaId: id, texto });
      setTextoTeste("");
    } catch (err) {
      setErroTeste(err instanceof ApiError ? err.message : "Não foi possível simular");
    } finally {
      setEnviandoTeste(false);
    }
  }

  // Simulador: faz de conta que o cliente tocou no link do banco e autorizou.
  async function autorizarLinkTeste() {
    if (!id) return;
    setErroTeste(null);
    try {
      await api.post("/maisa/simulador/autorizar", { conversaId: id });
    } catch (err) {
      setErroTeste(err instanceof ApiError ? err.message : "Não foi possível simular a autorização");
    }
  }

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

  async function assumirConversa() {
    if (!usuario) return;
    await atualizarVendedor(usuario.id);
  }

  async function devolverParaMaisa() {
    if (!id) return;
    const res = await api.patch<{ conversa: Conversa }>(`/conversas/${id}`, { comMaisa: true });
    setConversa(res.conversa);
  }

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
  const conversaDeTeste = conversa.contato.numeroWhatsapp.startsWith(PREFIXO_NUMERO_TESTE);

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
                    className="rounded border border-primary bg-bg/60 px-1.5 py-0.5 text-sm text-ink outline-none"
                  />
                  <button onClick={salvarNomeContato} disabled={salvandoNome} className="text-accent hover:text-ink">
                    <Check size={14} />
                  </button>
                  <button onClick={() => setEditandoNome(false)} className="text-muted hover:text-ink">
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
                  className="group flex items-center gap-1.5 text-sm font-semibold text-ink"
                  title="Editar nome do cliente"
                >
                  {conversa.contato.nome ?? "Sem nome"}
                  <Pencil size={11} className="text-muted opacity-0 group-hover:opacity-100" />
                </button>
              )}
              <p className="text-xs text-muted">
                {formatarTelefone(conversa.contato.numeroWhatsapp)} · {conversa.instancia.nome}
              </p>
              {erroNome && <p className="text-[11px] text-accent">{erroNome}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={conversa.status} />

            {conversa.comMaisa && (
              <span className="inline-flex items-center gap-1 rounded border border-indigo-claro/30 bg-indigo-claro/10 px-2 py-0.5 text-xs font-semibold text-indigo-claro">
                <Bot size={13} aria-hidden="true" />
                Maisa atendendo
              </span>
            )}

            {(conversa.comMaisa || !conversa.operadorId) && (
              <button
                onClick={assumirConversa}
                className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-marca-indigo hover:opacity-90"
              >
                Assumir conversa
              </button>
            )}

            {!conversa.comMaisa && conversa.instancia.maisaAtiva && conversa.status !== "encerrada" && (
              <button
                onClick={devolverParaMaisa}
                className="h-8 rounded-md border border-indigo-claro/30 px-3 text-xs font-semibold text-indigo-claro hover:bg-indigo-claro/10"
              >
                Devolver para a Maisa
              </button>
            )}

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
                painelAberto ? "border-primary bg-primary/10 text-accent" : "border-border text-muted hover:text-ink"
              }`}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        <MaisaProgresso conversa={conversa} onVerFluxo={() => setGuiaMaisaAberto(true)} />

        <div className="flex-1 space-y-3 overflow-y-auto p-8">
          {mensagens.length === 0 && <p className="text-center text-sm text-muted">Nenhuma mensagem ainda.</p>}
          {mensagens.map((m, i) => {
            const dataAtual = new Date(m.timestamp);
            const dataAnterior = i > 0 ? new Date(mensagens[i - 1].timestamp) : null;
            const mudouDia =
              !dataAnterior ||
              dataAtual.getFullYear() !== dataAnterior.getFullYear() ||
              dataAtual.getMonth() !== dataAnterior.getMonth() ||
              dataAtual.getDate() !== dataAnterior.getDate();

            return (
              <div key={m.id}>
                {mudouDia && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted">
                      {rotuloDia(dataAtual)}
                    </span>
                  </div>
                )}
                <MensagemBubble
                  mensagem={m}
                  contatoNome={conversa.contato.nome ?? conversa.contato.numeroWhatsapp}
                  contatoFotoUrl={conversa.contato.fotoUrl}
                  podeEditar={conversa.instancia.tipoConexao === "evolution"}
                  onEditada={(atualizada) =>
                    setMensagens((atual) => atual.map((mm) => (mm.id === atualizada.id ? atualizada : mm)))
                  }
                  onResponder={setRespondendoA}
                  conversaDeTeste={conversaDeTeste}
                  onAnalisarExtrato={setExtratoEmAnalise}
                />
              </div>
            );
          })}
          <div ref={fimDaListaRef} />
        </div>

        {maisaConfig?.simulador && conversaDeTeste && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviarComoCliente();
            }}
            className="flex items-center gap-2 border-t border-dashed border-indigo-claro/40 bg-indigo-claro/5 px-8 py-2"
          >
            <span className="shrink-0 text-xs font-semibold text-indigo-claro">Simular cliente</span>
            <input
              value={textoTeste}
              onChange={(e) => setTextoTeste(e.target.value)}
              placeholder="Escreva como se fosse o cliente"
              aria-label="Mensagem do cliente de teste"
              className="h-8 flex-1 rounded-md border border-border bg-bg/60 px-3 text-sm text-ink outline-none focus:border-indigo-claro"
            />
            <button
              type="submit"
              disabled={enviandoTeste || !textoTeste.trim()}
              title="Enviar como cliente"
              className="flex size-8 items-center justify-center rounded-md border border-indigo-claro/40 text-indigo-claro hover:bg-indigo-claro/10 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
            {conversa.comMaisa && conversa.maisaEstado?.etapa === "aguardando" && (
              <button
                type="button"
                onClick={autorizarLinkTeste}
                className="h-8 shrink-0 rounded-md border border-indigo-claro/40 px-3 text-xs font-semibold text-indigo-claro hover:bg-indigo-claro/10"
              >
                Cliente autorizou o link
              </button>
            )}
            {erroTeste && <span className="text-xs text-accent">{erroTeste}</span>}
          </form>
        )}

        {conversa.comMaisa && (
          <p className="border-t border-border bg-indigo-claro/10 px-8 py-2 text-xs font-medium text-indigo-claro">
            A Maisa está atendendo. Se você responder, ela para e a conversa passa para você.
          </p>
        )}

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

      <MaisaFluxoModal aberto={guiaMaisaAberto} onFechar={fecharGuiaMaisa} />
      <AnaliseExtratoModal mensagem={extratoEmAnalise} onFechar={fecharAnaliseExtrato} />

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
