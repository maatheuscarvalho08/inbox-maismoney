import { Navigate, Outlet } from "react-router-dom";
import { useAuth, type Role } from "../lib/auth";

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return <div className="flex h-screen items-center justify-center text-muted">Carregando...</div>;
  }

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  if (allow && !allow.includes(usuario.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
