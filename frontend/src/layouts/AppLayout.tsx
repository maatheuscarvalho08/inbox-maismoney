import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Smartphone,
  Send,
  Phone,
  BarChart2,
  Users,
  Settings,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../lib/auth";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: { label: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    label: "Principal",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/disparos", label: "Disparos", icon: Send },
      { to: "/discadora", label: "Discadora", icon: Phone },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
  {
    label: "Administração",
    adminOnly: true,
    items: [
      { to: "/numeros", label: "Números", icon: Smartphone },
      { to: "/metricas", label: "Métricas", icon: BarChart2 },
      { to: "/usuarios", label: "Usuários", icon: Users },
    ],
  },
];

export function AppLayout() {
  const { usuario, logout } = useAuth();
  const grupos = NAV_GROUPS.filter((grupo) => !grupo.adminOnly || usuario?.role === "admin");

  return (
    <div className="flex h-screen bg-bg text-white">
      <div className="pointer-events-none fixed -left-40 -top-40 size-[560px] rounded-full bg-primary/15 blur-[130px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 size-[480px] rounded-full bg-primary/10 blur-[130px]" />
      <div className="pointer-events-none fixed left-1/2 top-16 size-[620px] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.12]"
        style={{ backgroundImage: "radial-gradient(white 1px, transparent 1px)", backgroundSize: "28px 28px" }}
      />

      <aside className="relative z-10 flex w-64 shrink-0 flex-col border-r border-white/10 bg-surface/40 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-5 py-6">
          <img src="/logo.png" alt="MaisMoney" className="size-7 object-contain" />
          <span className="text-lg font-bold tracking-tight text-white">
            Mais<span className="text-primary">Money</span>
          </span>
        </div>

        <div className="px-4">
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-bg/40 px-3 py-2">
            <Search size={14} className="text-muted" />
            <span className="flex-1 text-sm text-muted">Buscar</span>
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-muted">⌘K</kbd>
          </div>
        </div>

        <nav className="mt-6 flex-1 space-y-6 overflow-y-auto px-3">
          {grupos.map((grupo) => (
            <div key={grupo.label}>
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{grupo.label}</p>
              <div className="mt-2 space-y-1">
                {grupo.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${
                          isActive
                            ? "border-primary/20 bg-primary/10 text-white"
                            : "border-transparent text-muted hover:bg-white/5 hover:text-white"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-md ${
                              isActive ? "bg-primary/20 text-primary" : "bg-white/5 text-muted"
                            }`}
                          >
                            <Icon size={14} strokeWidth={2} />
                          </span>
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="truncate text-sm font-medium text-white">{usuario?.nome}</p>
            <p className="truncate text-xs capitalize text-muted">{usuario?.role}</p>
            <button onClick={logout} className="mt-2 text-xs font-semibold text-primary hover:underline">
              Sair
            </button>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
