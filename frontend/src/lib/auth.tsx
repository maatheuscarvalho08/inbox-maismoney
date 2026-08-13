import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { conectarSocket, desconectarSocket } from "./socket";

export type Role = "admin" | "operador";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
}

interface LoginResponse {
  token: string;
  usuario: Usuario;
}

interface AuthContextValue {
  usuario: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
  atualizarUsuario: (usuario: Usuario) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setCarregando(false);
      return;
    }

    api
      .get<{ usuario: Usuario }>("/auth/me")
      .then((res) => {
        setUsuario(res.usuario);
        conectarSocket(token);
      })
      .catch(() => {
        localStorage.removeItem("token");
      })
      .finally(() => setCarregando(false));

    return () => desconectarSocket();
  }, []);

  async function login(email: string, senha: string) {
    const res = await api.post<LoginResponse>("/auth/login", { email, senha });
    localStorage.setItem("token", res.token);
    setUsuario(res.usuario);
    conectarSocket(res.token);
  }

  function logout() {
    localStorage.removeItem("token");
    setUsuario(null);
    desconectarSocket();
  }

  return (
    <AuthContext.Provider value={{ usuario, carregando, login, logout, atualizarUsuario: setUsuario }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

export { ApiError };
