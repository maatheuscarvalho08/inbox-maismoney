import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Smartphone,
  Send,
  Phone,
  BarChart2,
  Calculator,
  FileText,
  Filter,
  Users,
  Settings,
  ShoppingCart,
  Bell,
  CalendarCheck,
  CircleAlert,
  Clock,
  Inbox,
  Megaphone,
  TrendingUp,
  X,
  type Icone,
} from "../components/icones";
import { useAuth } from "../lib/auth";
import { useCarrinho } from "../lib/carrinho";
import { useRetornos } from "../lib/retornos";
import { useAlertasSistema } from "../lib/alertasSistema";
import { esperaTexto, useEsperando } from "../lib/esperando";
import { TEXTO_AVISO, useAvisosMaisa } from "../lib/avisosMaisa";
import { LogoMaisMoney } from "../components/LogoMaisMoney";

interface Item {
  to: string;
  label: string;
  icon: Icone;
  adminOnly?: boolean;
}

interface Secao {
  id: string;
  label: string;
  icon: Icone;
  adminOnly?: boolean;
  itens: Item[];
}

// Navegação em dois níveis: a barra de ícones escolhe a seção, o painel ao lado mostra
// as páginas dela. "Inbox" junta tudo o que nasce da conversa com o cliente.
const SECOES: Secao[] = [
  {
    id: "inicio",
    label: "Início",
    icon: LayoutDashboard,
    itens: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    itens: [
      { to: "/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/funil", label: "Funil", icon: Filter, adminOnly: true },
      { to: "/simulacoes", label: "Simulações", icon: Calculator },
      { to: "/propostas", label: "Propostas", icon: FileText },
      { to: "/carrinho", label: "Carrinho", icon: ShoppingCart },
      { to: "/retornos", label: "Retornos", icon: CalendarCheck },
    ],
  },
  {
    id: "campanhas",
    label: "Campanhas",
    icon: Megaphone,
    itens: [
      { to: "/disparos", label: "Disparos", icon: Send },
      { to: "/discadora", label: "Discadora", icon: Phone },
      { to: "/trafego", label: "Tráfego", icon: TrendingUp },
    ],
  },
  {
    id: "admin",
    label: "Administração",
    icon: Users,
    adminOnly: true,
    itens: [
      { to: "/numeros", label: "Números", icon: Smartphone },
      { to: "/metricas", label: "Métricas", icon: BarChart2 },
      { to: "/usuarios", label: "Usuários", icon: Users },
    ],
  },
  {
    id: "config",
    label: "Configurações",
    icon: Settings,
    itens: [{ to: "/configuracoes", label: "Configurações", icon: Settings }],
  },
];

const PAINEL_KEY = "painelNavFechado";

function lerPainelFechado() {
  try {
    return localStorage.getItem(PAINEL_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { usuario, logout } = useAuth();
  const admin = usuario?.role === "admin";
  // Quem só vê as conversas atribuídas a ele tem só Conversas e Configurações.
  const secoes = SECOES.filter((s) => (!s.adminOnly || admin)).map((s) => ({
    ...s,
    itens: s.itens.filter((i) => (!i.adminOnly || admin)),
  }));
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ativa = secoes.find((s) => s.itens.some((i) => pathname.startsWith(i.to))) ?? secoes[0];

  const [painelFechado, setPainelFechado] = useState(lerPainelFechado);
  function alternarPainel(fechado: boolean) {
    setPainelFechado(fechado);
    try {
      localStorage.setItem(PAINEL_KEY, fechado ? "1" : "0");
    } catch {
      // Sem armazenamento: o painel só não lembra a escolha.
    }
  }

  const navRef = useRef<HTMLElement>(null);
  const [pilula, setPilula] = useState<{ y: number; altura: number } | null>(null);
  // A pílula é uma só e desliza entre os itens, em vez de cada item pintar o próprio fundo.
  useLayoutEffect(() => {
    const atual = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setPilula(atual ? { y: atual.offsetTop, altura: atual.offsetHeight } : null);
  }, [pathname, usuario?.role, painelFechado]);

  const carrinho = useCarrinho();
  const retornos = useRetornos();
  const alertasSistema = useAlertasSistema();
  const [retornoFechado, setRetornoFechado] = useState(false);
  const esperando = useEsperando();
  // Fechar a faixa de espera vale por 30 minutos: depois ela volta se ainda houver cliente esperando.
  const [esperaFechadaAte, setEsperaFechadaAte] = useState(0);
  const minhaEspera = esperando.conversas.find((c) => c.operadorId === usuario?.id);
  const maisAntiga = minhaEspera ?? esperando.conversas.find((c) => c.operadorId === null) ?? esperando.conversas[0];
  useEffect(() => {
    if (retornos.ultimo) setRetornoFechado(false);
  }, [retornos.ultimo]);
  const avisosMaisa = useAvisosMaisa();
  const avisoMaisa = avisosMaisa.avisos[0];
  // O aviso volta a aparecer sempre que um cliente novo cai no carrinho.
  const [avisoFechado, setAvisoFechado] = useState(false);
  useEffect(() => {
    if (carrinho.ultimo) setAvisoFechado(false);
  }, [carrinho.ultimo]);

  const iniciais = (usuario?.nome ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen bg-bg text-ink">
      {/* Barra de seções: só ícones. Clicar na seção já aberta recolhe o painel. */}
      <nav aria-label="Seções" className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg py-4">
        {secoes.map((s) => {
          const Icon = s.icon;
          const selecionada = s.id === ativa.id;
          const temCarrinho = s.id === "inbox" && carrinho.total > 0;
          return (
            <button
              key={s.id}
              title={s.label}
              aria-label={s.label}
              aria-current={selecionada ? "true" : undefined}
              onClick={() => {
                if (selecionada) {
                  alternarPainel(!painelFechado);
                  return;
                }
                alternarPainel(false);
                navigate(s.itens[0].to);
              }}
              className={`relative flex size-11 items-center justify-center rounded-xl ${
                selecionada ? "bg-primary text-marca-indigo" : "text-muted hover:bg-ink/5 hover:text-ink"
              }`}
            >
              <Icon size={20} weight={selecionada ? "fill" : "duotone"} />
              {temCarrinho && (
                <span className="absolute right-1 top-1 size-2.5 rounded-full border-2 border-bg bg-primary" aria-hidden="true" />
              )}
            </button>
          );
        })}

        <span
          title={usuario?.nome}
          className="mt-auto flex size-9 items-center justify-center rounded-full bg-surface text-xs font-bold text-ink"
        >
          {iniciais}
        </span>
      </nav>

      {/* Painel da seção: as páginas dela. */}
      {!painelFechado && (
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center justify-between px-5 py-5">
            <LogoMaisMoney variante="branca" className="block w-28" />
            <button
              onClick={() => alternarPainel(true)}
              title="Recolher menu"
              aria-label="Recolher menu"
              className="text-muted hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>

          <p className="px-5 text-[11px] font-semibold uppercase tracking-wide text-muted">{ativa.label}</p>
          <nav ref={navRef} className="relative mx-3 mt-2 flex-1 space-y-1 overflow-y-auto">
            {pilula && (
              <span
                aria-hidden="true"
                className="nav-pilula rounded-lg bg-primary/15"
                style={{ height: pilula.altura, transform: `translateY(${pilula.y}px)` }}
              />
            )}
            {ativa.itens.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `nav-item relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
                      isActive ? "font-semibold text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                          isActive ? "bg-primary text-marca-indigo" : "bg-ink/5 text-muted"
                        }`}
                      >
                        <Icon size={15} weight={isActive ? "fill" : "duotone"} />
                      </span>
                      {item.label}
                      {item.to === "/retornos" && retornos.total > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-marca-indigo tabular-nums">
                          {retornos.total}
                        </span>
                      )}
                      {item.to === "/carrinho" && carrinho.total > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-marca-indigo tabular-nums">
                          {carrinho.total}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="p-3">
            <div className="rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
              <p className="truncate text-sm font-medium text-ink">{usuario?.nome}</p>
              <p className="truncate text-xs capitalize text-muted">{usuario?.role}</p>
              <button onClick={logout} className="mt-2 text-xs font-semibold text-accent hover:underline">
                Sair
              </button>
            </div>
          </div>
        </aside>
      )}

      <main className="flex flex-1 flex-col overflow-hidden bg-bg">
        {/* Alerta do sistema: some sozinho quando o problema passa. Só aparece para quem está em ALERTAS_EMAILS. */}
        {alertasSistema.map((a) => (
          <div key={a.id} role="alert" className="flex items-center gap-3 border-b border-marca-indigo/30 bg-primary px-6 py-2 text-sm text-marca-indigo">
            <CircleAlert size={16} weight="fill" className="shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <span className="font-bold">{a.titulo}.</span> {a.detalhe}
            </p>
            <span className="shrink-0 text-xs font-semibold tabular-nums">
              desde {new Date(a.desde).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
        {avisoMaisa && (
          <div role="alert" className="flex items-center gap-3 border-b border-primary/40 bg-primary/25 px-6 py-2 text-sm">
            <CircleAlert size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-ink" title={avisoMaisa.detalhe}>
              <span className="font-semibold">{avisoMaisa.nome ?? "Um cliente"}</span> {TEXTO_AVISO[avisoMaisa.tipo]}
              {avisosMaisa.avisos.length > 1 && <span className="text-muted"> (+{avisosMaisa.avisos.length - 1} avisos)</span>}
            </p>
            <Link
              to={`/conversas/${avisoMaisa.conversaId}`}
              onClick={() => avisosMaisa.dispensar(avisoMaisa)}
              className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-marca-indigo hover:opacity-90"
            >
              Abrir conversa
            </Link>
            <button onClick={() => avisosMaisa.dispensar(avisoMaisa)} aria-label="Fechar aviso" className="shrink-0 text-muted hover:text-ink">
              <X size={14} />
            </button>
          </div>
        )}
        {esperando.total > 0 && maisAntiga && Date.now() > esperaFechadaAte && (
          <div role="status" className="flex items-center gap-3 border-b border-primary/30 bg-primary/15 px-6 py-2 text-sm">
            <Clock size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-ink">
              <span className="font-semibold">{esperando.total}</span> {esperando.total === 1 ? "cliente esperando" : "clientes esperando"} resposta há mais de 30 min
              {esperando.minhas > 0 && (
                <>
                  , <span className="font-semibold">{esperando.minhas}</span> {esperando.minhas === 1 ? "é sua" : "são suas"}
                </>
              )}
              . O mais antigo: <span className="font-semibold">{maisAntiga.nome ?? "cliente"}</span>, há {esperaTexto(maisAntiga.desde)}.
            </p>
            <Link
              to={`/conversas/${maisAntiga.id}`}
              className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-marca-indigo hover:opacity-90"
            >
              Responder
            </Link>
            <button onClick={() => setEsperaFechadaAte(Date.now() + 30 * 60_000)} aria-label="Fechar aviso" className="shrink-0 text-muted hover:text-ink">
              <X size={14} />
            </button>
          </div>
        )}
        {retornos.total > 0 && !retornoFechado && pathname !== "/retornos" && (
          <div role="status" className="flex items-center gap-3 border-b border-primary/30 bg-primary/15 px-6 py-2 text-sm">
            <CalendarCheck size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-ink">
              {retornos.ultimo ? (
                <>
                  Chegou o dia de chamar <span className="font-semibold">{retornos.ultimo.contato.nome ?? "um cliente"}</span>.
                </>
              ) : (
                <>
                  <span className="font-semibold">{retornos.total}</span> {retornos.total === 1 ? "cliente pediu" : "clientes pediram"} para ser {retornos.total === 1 ? "chamado" : "chamados"} e o dia chegou.
                </>
              )}
            </p>
            <Link
              to="/retornos"
              onClick={() => retornos.limparUltimo()}
              className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-marca-indigo hover:opacity-90"
            >
              Ver retornos
            </Link>
            <button
              onClick={() => {
                setRetornoFechado(true);
                retornos.limparUltimo();
              }}
              aria-label="Fechar aviso"
              className="shrink-0 text-muted hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {carrinho.total > 0 && !avisoFechado && pathname !== "/carrinho" && (
          <div role="status" className="flex items-center gap-3 border-b border-primary/30 bg-primary/15 px-6 py-2 text-sm">
            <Bell size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-ink">
              {carrinho.ultimo ? (
                <>
                  <span className="font-semibold">{carrinho.ultimo.contato.nome ?? "Um cliente"}</span> não respondeu a oferta em 24 horas.
                </>
              ) : (
                <>
                  <span className="font-semibold">{carrinho.total}</span> {carrinho.total === 1 ? "cliente recebeu" : "clientes receberam"} a
                  oferta e não {carrinho.total === 1 ? "respondeu" : "responderam"} em 24 horas.
                </>
              )}{" "}
              Chame para tentar fechar.
            </p>
            <Link
              to="/carrinho"
              onClick={() => carrinho.limparUltimo()}
              className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-marca-indigo hover:opacity-90"
            >
              Ver carrinho
            </Link>
            <button
              onClick={() => {
                setAvisoFechado(true);
                carrinho.limparUltimo();
              }}
              aria-label="Fechar aviso"
              className="shrink-0 text-muted hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Muda só entre seções: trocar de conversa não remonta a lista. */}
          <div key={pathname.split("/")[1]} className="pagina-entra h-full">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
