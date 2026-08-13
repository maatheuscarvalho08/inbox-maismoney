import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./components/PlaceholderPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const MetricasPage = lazy(() => import("./pages/MetricasPage").then((m) => ({ default: m.MetricasPage })));
const ConversasSplitLayout = lazy(() =>
  import("./layouts/ConversasSplitLayout").then((m) => ({ default: m.ConversasSplitLayout })),
);
const ConversasVazio = lazy(() => import("./pages/ConversasVazio").then((m) => ({ default: m.ConversasVazio })));
const ConversaDetalhePage = lazy(() =>
  import("./pages/ConversaDetalhePage").then((m) => ({ default: m.ConversaDetalhePage })),
);
const NumerosPage = lazy(() => import("./pages/NumerosPage").then((m) => ({ default: m.NumerosPage })));
const UsuariosPage = lazy(() => import("./pages/UsuariosPage").then((m) => ({ default: m.UsuariosPage })));
const DisparosPage = lazy(() => import("./pages/DisparosPage").then((m) => ({ default: m.DisparosPage })));
const ConfiguracoesPage = lazy(() =>
  import("./pages/ConfiguracoesPage").then((m) => ({ default: m.ConfiguracoesPage })),
);

function RouteFallback() {
  return <div className="flex h-full items-center justify-center p-8 text-sm text-muted">Carregando...</div>;
}

function pagina(Componente: React.ComponentType) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Componente />
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/recuperar-senha"
          element={
            <div className="min-h-screen bg-bg">
              <PlaceholderPage
                title="Recuperar senha"
                description="Fale com um administrador para redefinir sua senha"
              />
            </div>
          }
        />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={pagina(DashboardPage)} />
            <Route path="/conversas" element={pagina(ConversasSplitLayout)}>
              <Route index element={pagina(ConversasVazio)} />
              <Route path=":id" element={pagina(ConversaDetalhePage)} />
            </Route>
            <Route path="/disparos" element={pagina(DisparosPage)} />
            <Route path="/configuracoes" element={pagina(ConfiguracoesPage)} />

            <Route element={<ProtectedRoute allow={["admin"]} />}>
              <Route path="/numeros" element={pagina(NumerosPage)} />
              <Route path="/metricas" element={pagina(MetricasPage)} />
              <Route path="/usuarios" element={pagina(UsuariosPage)} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
