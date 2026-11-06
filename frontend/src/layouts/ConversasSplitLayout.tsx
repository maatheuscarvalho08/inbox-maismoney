import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { CircleDot, Filter, Plus, Search, Smartphone, User } from "../components/icones";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { tempoRelativo } from "../lib/tempoRelativo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { EtiquetaFiltroDropdown } from "../components/EtiquetaFiltroDropdown";
import { FiltroDropdown } from "../components/FiltroDropdown";
import { NovaConversaModal } from "../components/NovaConversaModal";
import { LABEL_CONVENIO } from "../lib/funil";
import type { Conversa, Etiqueta, Instancia, StatusConversa, Usuario } from "../types/api";

const FILTROS_STATUS: { id: StatusConversa; label: string }[] = [
  { id: "aberta", label: "Aberta" },
  { id: "em_atendimento", label: "Em atendimento" },
  { id: "aguardando", label: "Aguardando" },
  { id: "encerrada", label: "Encerrada" },
];

type Aba = "maisa" | "sem_atendente" | "atribuidas" | "disparos";

const ABAS: { id: Aba; label: string; descricao: string; vazio: string }[] = [
  {
    id: "maisa",
    label: "Maisa",
    descricao: "Conversas que a Maisa está atendendo",
    vazio: "A Maisa não está atendendo nenhuma conversa.",
  },
  {
    id: "sem_atendente",
    label: "Na fila",
    descricao: "Fora da Maisa, esperando alguém da equipe assumir",
    vazio: "Nenhuma conversa esperando atendente.",
  },
  {
    id: "atribuidas",
    label: "Atribuídas",
    descricao: "Fora da Maisa, com um responsável da equipe",
    vazio: "Nenhuma conversa atribuída.",
  },
  {
    id: "disparos",
    label: "Disparos",
    descricao: "Disparos que o cliente ainda não respondeu",
    vazio: "Nenhum disparo aguardando resposta.",
  },
];

function ultimaMensagemPreview(conversa: Conversa) {
  const ultima = conversa.mensagens?.[0];
  if (!ultima) return "—";
  if (ultima.conteudoTexto) return ultima.conteudoTexto;
  if (ultima.tipoMidia) return "📎 Mídia";
  return "—";
}

export function ConversasSplitLayout() {
  const navigate = useNavigate();
  const { id: idAtivo } = useParams<{ id: string }>();
  const { usuario } = useAuth();

  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>("sem_atendente");
  const [contagens, setContagens] = useState<Partial<Record<Aba, number>>>({});
  const [filtroStatus, setFiltroStatus] = useState<StatusConversa | undefined>(undefined);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [etiquetaFiltro, setEtiquetaFiltro] = useState<string | null>(null);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaFiltro, setInstanciaFiltro] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Usuario[]>([]);
  const [vendedorFiltro, setVendedorFiltro] = useState<string | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const carregar = useCallback(async (status?: StatusConversa, abaAtual?: Aba) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("aba", abaAtual ?? "sem_atendente");
    const res = await api.get<{ conversas: Conversa[]; contagens: Record<Aba, number> }>(`/conversas?${params.toString()}`);
    setConversas(res.conversas);
    setContagens(res.contagens);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar(filtroStatus, aba);
  }, [filtroStatus, aba, carregar]);

  useEffect(() => {
    api.get<{ etiquetas: Etiqueta[] }>("/etiquetas").then((res) => setEtiquetas(res.etiquetas));
    api.get<{ instancias: Instancia[] }>("/instancias").then((res) => setInstancias(res.instancias));
    api.get<{ usuarios: Usuario[] }>("/usuarios").then((res) => setVendedores(res.usuarios.filter((u) => u.ativo)));
  }, []);

  useSocketEvent("mensagem:nova", () => carregar(filtroStatus, aba));
  useSocketEvent("conversa:atualizada", () => carregar(filtroStatus, aba));

  const conversasFiltradas = useMemo(() => {
    // Encerradas só aparecem pelo filtro de status: assim a lista bate com o contador da aba.
    let lista = filtroStatus ? conversas : conversas.filter((c) => c.status !== "encerrada");
    if (etiquetaFiltro) {
      lista = lista.filter((c) => c.etiquetas.some((e) => e.etiqueta.id === etiquetaFiltro));
    }
    if (instanciaFiltro) {
      lista = lista.filter((c) => c.instanciaId === instanciaFiltro);
    }
    if (vendedorFiltro) {
      lista = lista.filter((c) => c.operadorId === vendedorFiltro);
    }
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      lista = lista.filter(
        (c) => c.contato.nome?.toLowerCase().includes(termo) || c.contato.numeroWhatsapp.includes(termo),
      );
    }
    return lista;
  }, [conversas, filtroStatus, etiquetaFiltro, instanciaFiltro, vendedorFiltro, busca]);

  const filtrosAtivos = [filtroStatus, etiquetaFiltro, instanciaFiltro, vendedorFiltro].filter(Boolean).length;

  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border">
          <div className="flex items-center justify-between px-4 pt-4">
            <h1 className="text-lg font-bold tracking-tight text-ink">Conversas</h1>
            <button
              onClick={() => setNovaConversaAberta(true)}
              className="flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-marca-indigo hover:opacity-90"
            >
              <Plus size={13} />
              Nova
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 pt-3">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou número"
                aria-label="Buscar conversa"
                className="h-9 w-full rounded-md border border-border bg-bg/60 pl-9 pr-3 text-sm text-ink outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={() => setFiltrosAbertos((v) => !v)}
              aria-expanded={filtrosAbertos}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${
                filtrosAbertos || filtrosAtivos ? "border-primary text-accent" : "border-border text-muted hover:text-ink"
              }`}
            >
              <Filter size={14} />
              Filtros
              {filtrosAtivos > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-marca-indigo">
                  {filtrosAtivos}
                </span>
              )}
            </button>
          </div>

          {filtrosAbertos && (
            <div className="space-y-2 px-4 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <FiltroDropdown
                  label="Status"
                  icon={CircleDot}
                  selecionado={filtroStatus ?? null}
                  onSelecionar={(status) => setFiltroStatus((status as StatusConversa | null) ?? undefined)}
                  itens={FILTROS_STATUS}
                />
                <EtiquetaFiltroDropdown
                  etiquetas={etiquetas}
                  selecionada={etiquetaFiltro}
                  onSelecionar={setEtiquetaFiltro}
                  onCriada={(nova) => setEtiquetas((atual) => [...atual, nova])}
                />
                <FiltroDropdown
                  label="Números"
                  icon={Smartphone}
                  selecionado={instanciaFiltro}
                  onSelecionar={setInstanciaFiltro}
                  itens={instancias.map((i) => ({ id: i.id, label: i.numero }))}
                />
                <FiltroDropdown
                  label="Vendedores"
                  icon={User}
                  selecionado={vendedorFiltro}
                  onSelecionar={setVendedorFiltro}
                  itens={vendedores.map((v) => ({ id: v.id, label: v.nome }))}
                />
              </div>
              {filtrosAtivos > 0 && (
                <button
                  onClick={() => {
                    setFiltroStatus(undefined);
                    setEtiquetaFiltro(null);
                    setInstanciaFiltro(null);
                    setVendedorFiltro(null);
                  }}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}

          <div role="tablist" aria-label="Seções de conversas" className="relative mt-3 grid grid-cols-4 px-2">
            {ABAS.map((a) => {
              const ativa = aba === a.id;
              return (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={ativa}
                  title={a.descricao}
                  onClick={() => setAba(a.id)}
                  className={`flex h-10 items-center justify-center gap-1 whitespace-nowrap text-xs ${
                    ativa ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink"
                  }`}
                >
                  {a.label}
                  <span className={`text-[11px] tabular-nums ${ativa ? "font-bold text-accent" : "text-muted"}`}>{contagens[a.id] ?? 0}</span>
                </button>
              );
            })}
            <span
              aria-hidden="true"
              className="aba-pilula absolute bottom-0 left-2 h-0.5 w-[calc((100%-16px)/4)] rounded-full bg-primary"
              style={{ transform: `translateX(${ABAS.findIndex((a) => a.id === aba) * 100}%)` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {carregando && <p className="p-4 text-center text-xs text-muted">Carregando...</p>}
          {!carregando && conversasFiltradas.length === 0 && (
            <p className="p-4 text-center text-xs text-muted">
              {busca || etiquetaFiltro || instanciaFiltro || vendedorFiltro || filtroStatus
                ? "Nenhuma conversa com esses filtros."
                : ABAS.find((a) => a.id === aba)?.vazio}
            </p>
          )}
          {conversasFiltradas.map((c) => {
            // Última mensagem é do cliente = ninguém da equipe respondeu ainda
            // desde então — mesma lógica de "não lida" que o WhatsApp real usa.
            // Encerrada não conta, mesmo com última msg do cliente: quem fechou já
            // viu e decidiu que não precisa responder (recusa, propaganda, etc.) —
            // sem isso a bolinha ficava acesa pra sempre nesses casos. Some pra mim
            // assim que eu abro a conversa, mas continua acesa pros colegas que
            // ainda não abriram — só desaparece de vez pra todos quando alguém
            // manda uma resposta de verdade (aí o remetenteTipo já resolve sozinho).
            const euJaVi = usuario ? c.visualizacoes.some((v) => v.usuarioId === usuario.id) : false;
            const naoRespondida = c.status !== "encerrada" && c.mensagens?.[0]?.remetenteTipo === "cliente" && !euJaVi;
            return (
            <button
              key={c.id}
              onClick={() => navigate(`/conversas/${c.id}`)}
              className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-ink/[0.03] ${
                c.id === idAtivo ? "bg-primary/10" : ""
              }`}
            >
              <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} fotoUrl={c.contato.fotoUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm text-ink ${naoRespondida ? "font-bold" : "font-medium"}`}>{c.contato.nome ?? "Sem nome"}</span>
                  <span className={`shrink-0 text-[11px] ${naoRespondida ? "font-semibold text-accent" : "text-muted"}`}>{tempoRelativo(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-xs ${naoRespondida ? "font-medium text-ink" : "text-muted"}`}>{ultimaMensagemPreview(c)}</p>
                  {naoRespondida && (
                    <span title="Cliente respondeu, aguardando retorno" className="size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] text-muted">
                  {c.convenio && <span className="font-semibold text-indigo-claro">{LABEL_CONVENIO[c.convenio]} · </span>}
                  {c.origemDisparo && <span className="font-semibold text-indigo-claro">Disparo · </span>}
                  {FILTROS_STATUS.find((f) => f.id === c.status)?.label} · {c.instancia.nome}
                  {c.operador ? ` · ${c.operador.nome}` : ""}
                </p>
              </div>
            </button>
            );
          })}
        </div>
      </aside>

      <div key={idAtivo ?? "vazio"} className="conversa-entra min-w-0 flex-1">
        <Outlet />
      </div>

      <NovaConversaModal
        aberto={novaConversaAberta}
        onFechar={() => setNovaConversaAberta(false)}
        onCriada={(conversa) => {
          carregar(filtroStatus, aba);
          navigate(`/conversas/${conversa.id}`);
        }}
      />
    </div>
  );
}
