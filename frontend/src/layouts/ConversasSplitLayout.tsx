import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { Search, Smartphone, User } from "lucide-react";
import { api } from "../lib/api";
import { tempoRelativo } from "../lib/tempoRelativo";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/StatusBadge";
import { EtiquetaFiltroDropdown } from "../components/EtiquetaFiltroDropdown";
import { FiltroDropdown } from "../components/FiltroDropdown";
import type { Conversa, Etiqueta, Instancia, StatusConversa, Usuario } from "../types/api";

const FILTROS_STATUS: { label: string; status?: StatusConversa }[] = [
  { label: "Todas" },
  { label: "Aberta", status: "aberta" },
  { label: "Em atendimento", status: "em_atendimento" },
  { label: "Aguardando", status: "aguardando" },
  { label: "Encerrada", status: "encerrada" },
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

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusConversa | undefined>(undefined);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [etiquetaFiltro, setEtiquetaFiltro] = useState<string | null>(null);
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [instanciaFiltro, setInstanciaFiltro] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Usuario[]>([]);
  const [vendedorFiltro, setVendedorFiltro] = useState<string | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async (status?: StatusConversa) => {
    const query = status ? `?status=${status}` : "";
    const res = await api.get<{ conversas: Conversa[] }>(`/conversas${query}`);
    setConversas(res.conversas);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar(filtroStatus);
  }, [filtroStatus, carregar]);

  useEffect(() => {
    api.get<{ etiquetas: Etiqueta[] }>("/etiquetas").then((res) => setEtiquetas(res.etiquetas));
    api.get<{ instancias: Instancia[] }>("/instancias").then((res) => setInstancias(res.instancias));
    api.get<{ usuarios: Usuario[] }>("/usuarios").then((res) => setVendedores(res.usuarios.filter((u) => u.ativo)));
  }, []);

  useSocketEvent("mensagem:nova", () => carregar(filtroStatus));
  useSocketEvent("conversa:atualizada", () => carregar(filtroStatus));

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
      <aside className="flex max-w-[20%] min-w-[300px] shrink-0 flex-col border-r border-border">
        <div className="space-y-2.5 border-b border-border p-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa..."
              className="w-full rounded-md border border-border bg-bg/60 py-1.5 pl-8 pr-3 text-xs text-white outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {FILTROS_STATUS.map((f) => (
              <button
                key={f.label}
                onClick={() => setFiltroStatus(f.status)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-150 ease-out ${
                  filtroStatus === f.status
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

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

        <div className="flex-1 overflow-y-auto">
          {carregando && <p className="p-4 text-center text-xs text-muted">Carregando...</p>}
          {!carregando && conversasFiltradas.length === 0 && (
            <p className="p-4 text-center text-xs text-muted">Nenhuma conversa encontrada.</p>
          )}
          {conversasFiltradas.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/conversas/${c.id}`)}
              className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-left transition-colors duration-150 ease-out hover:bg-white/[0.03] ${
                c.id === idAtivo ? "bg-primary/10" : ""
              }`}
            >
              <Avatar nome={c.contato.nome ?? c.contato.numeroWhatsapp} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">{c.contato.nome ?? "Sem nome"}</span>
                  <span className="shrink-0 text-[10px] text-muted">{tempoRelativo(c.lastMessageAt)}</span>
                </div>
                <p className="truncate text-xs text-muted">{ultimaMensagemPreview(c)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={c.status} />
                  <span className="flex items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent-fg)]">
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
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
