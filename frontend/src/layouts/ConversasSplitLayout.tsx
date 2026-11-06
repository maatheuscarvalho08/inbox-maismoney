import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { Bot, CircleDot, Inbox, Megaphone, Plus, Search, Smartphone, User, UserCheck, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { tempoRelativo } from "../lib/tempoRelativo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/StatusBadge";
import { EtiquetaFiltroDropdown } from "../components/EtiquetaFiltroDropdown";
import { FiltroDropdown } from "../components/FiltroDropdown";
import { NovaConversaModal } from "../components/NovaConversaModal";
import type { Conversa, Etiqueta, Instancia, StatusConversa, Usuario } from "../types/api";

const FILTROS_STATUS: { id: StatusConversa; label: string }[] = [
  { id: "aberta", label: "Aberta" },
  { id: "em_atendimento", label: "Em atendimento" },
  { id: "aguardando", label: "Aguardando" },
  { id: "encerrada", label: "Encerrada" },
];

type Aba = "maisa" | "sem_atendente" | "atribuidas" | "disparos";

const ABAS: { id: Aba; label: string; icon: LucideIcon; descricao: string; vazio: string }[] = [
  {
    id: "maisa",
    label: "Maisa",
    icon: Bot,
    descricao: "Conversas que a Maisa está atendendo",
    vazio: "A Maisa não está atendendo nenhuma conversa.",
  },
  {
    id: "sem_atendente",
    label: "Na fila",
    icon: Inbox,
    descricao: "Fora da Maisa, esperando alguém da equipe assumir",
    vazio: "Nenhuma conversa esperando atendente.",
  },
  {
    id: "atribuidas",
    label: "Atribuídas",
    icon: UserCheck,
    descricao: "Fora da Maisa, com um responsável da equipe",
    vazio: "Nenhuma conversa atribuída.",
  },
  {
    id: "disparos",
    label: "Disparos",
    icon: Megaphone,
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
    let lista = conversas;
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
  }, [conversas, etiquetaFiltro, instanciaFiltro, vendedorFiltro, busca]);

  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou número"
                aria-label="Buscar conversa"
                className="h-9 w-full rounded-md border border-border bg-bg/60 pl-9 pr-3 text-sm text-ink outline-none focus:border-accent"
              />
            </div>

            <button
              onClick={() => setNovaConversaAberta(true)}
              title="Nova conversa"
              aria-label="Nova conversa"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-marca-indigo hover:opacity-90"
            >
              <Plus size={18} />
            </button>
          </div>

          <div role="tablist" aria-label="Seções de conversas" className="relative grid grid-cols-4 rounded-lg bg-bg p-0.5">
            <span
              aria-hidden="true"
              className="aba-pilula absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/4)] rounded-md bg-primary"
              style={{ transform: `translateX(${ABAS.findIndex((a) => a.id === aba) * 100}%)` }}
            />
            {ABAS.map((a) => {
              const Icon = a.icon;
              const ativa = aba === a.id;
              return (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={ativa}
                  title={a.descricao}
                  onClick={() => setAba(a.id)}
                  className={`relative flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-md text-[11px] leading-tight ${
                    ativa ? "font-semibold text-marca-indigo" : "font-medium text-muted hover:text-ink"
                  }`}
                >
                  <span className="flex items-center gap-1 text-sm font-bold">
                    <Icon size={14} aria-hidden="true" />
                    {contagens[a.id] ?? 0}
                  </span>
                  {a.label}
                </button>
              );
            })}
          </div>

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

          {(filtroStatus || etiquetaFiltro || instanciaFiltro || vendedorFiltro) && (
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
              className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-left transition-colors duration-150 ease-out hover:bg-ink/[0.03] ${
                c.id === idAtivo ? "bg-primary/10" : ""
              }`}
            >
              <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} fotoUrl={c.contato.fotoUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{c.contato.nome ?? "Sem nome"}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted">
                    {tempoRelativo(c.lastMessageAt)}
                    {naoRespondida && (
                      <span
                        title="Cliente respondeu, aguardando retorno"
                        className="size-2 rounded-full bg-[var(--color-accent)]"
                      />
                    )}
                  </span>
                </div>
                <p className={`truncate text-xs ${naoRespondida ? "font-medium text-ink" : "text-muted"}`}>
                  {ultimaMensagemPreview(c)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={c.status} />
                  {c.origemDisparo && (
                    <span className="flex items-center gap-1 rounded border border-indigo-claro/30 bg-indigo-claro/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-claro">
                      <Megaphone size={9} />
                      Disparo
                    </span>
                  )}
                  <span className="flex items-center gap-1 rounded border border-border bg-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    <Smartphone size={9} />
                    {c.instancia.numero}
                  </span>
                  {c.operador && (
                    <span className="flex items-center gap-1 rounded border border-border bg-border/40 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                      <User size={9} />
                      {c.operador.nome}
                    </span>
                  )}
                </div>
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
