import { useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router-dom";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth, ApiError } from "../lib/auth";

export function LoginPage() {
  const { usuario, login } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await login(email, senha);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível fazer login");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-bg px-6">
      <div className="pointer-events-none absolute -left-48 -top-48 size-[560px] rounded-full bg-primary/25 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 bottom-0 size-[420px] rounded-full bg-primary/15 blur-[100px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/30 blur-[110px]" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-surface/30 p-8 shadow-2xl shadow-black/50 backdrop-blur-2xl"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.1] via-transparent to-primary/[0.08]" />

        <div className="relative">
          <div className="text-center">
            <img src="/logo.png" alt="MaisMoney" className="mx-auto size-12 object-contain" />

            <h1 className="mt-4 text-2xl font-bold text-white">Bem-vindo</h1>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-bg/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="senha" className="mb-1.5 block text-xs font-medium text-muted">
                Senha
              </label>
              <div className="relative">
                <input
                  id="senha"
                  type={mostrarSenha ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-bg/60 px-3 py-2.5 pr-10 text-sm text-white outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-white"
                >
                  {mostrarSenha ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <Link
                to="/recuperar-senha"
                className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
              >
                Esqueci minha senha
              </Link>
            </div>

            {erro && <p className="text-sm text-primary">{erro}</p>}

            <button
              type="submit"
              disabled={enviando}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              <LogIn size={16} strokeWidth={2.5} />
              {enviando ? "Entrando..." : "Entrar"}
            </button>
          </div>

          <p className="mt-6 text-center text-xs text-muted">Acesso restrito a usuários autorizados.</p>
        </div>
      </form>
    </div>
  );
}
