import { useRef, useState, type FormEvent } from "react";
import { Navigate, Link } from "react-router-dom";
import { CircleAlert, Eye, EyeOff, Loader2, Lock, Mail } from "../components/icones";
import { useAuth, ApiError } from "../lib/auth";
import { FundoMarca } from "../components/FundoMarca";
import { LogoMaisMoney } from "../components/LogoMaisMoney";

const SAIDA_DO_FORMULARIO_MS = 220;

const classeCampo =
  "login-campo-input h-12 w-full rounded-lg bg-marca-creme pl-11 text-base font-medium text-marca-indigo placeholder:text-marca-indigo/70 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-indigo";

export function LoginPage() {
  const { usuario, carregando, login, iniciarSaudacao } = useAuth();
  const logoRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Segura o redirecionamento só no login feito aqui; quem já tem sessão vai direto.
  const [entrando, setEntrando] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [podeIr, setPodeIr] = useState(false);

  if (usuario && (!entrando || podeIr)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Evita mostrar o login por um instante enquanto a sessão salva é verificada.
  if (carregando) {
    return <div className="h-dvh bg-marca-laranja" />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    setEntrando(true);
    try {
      await login(email, senha);
      setSaindo(true);
      const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(
        () => {
          if (logoRef.current) iniciarSaudacao(logoRef.current.getBoundingClientRect());
          setPodeIr(true);
        },
        reduzido ? 0 : SAIDA_DO_FORMULARIO_MS,
      );
    } catch (err) {
      setEntrando(false);
      setErro(err instanceof ApiError ? err.message : "Não foi possível fazer login");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="font-marca relative flex min-h-dvh items-center justify-center overflow-hidden bg-marca-laranja px-6 py-10 text-marca-indigo">
      <FundoMarca />

      <div className="relative w-full max-w-[22rem]">
        <h1 className="sr-only">Entrar no Mais Money Inbox</h1>
        <div ref={logoRef} className="logo-animada mx-auto w-52 sm:w-60">
          <LogoMaisMoney className="block w-full" />
        </div>

        <form onSubmit={handleSubmit} className={`mt-10 space-y-3 ${saindo ? "login-saindo" : ""}`}>
          <div className="login-campo relative" style={{ animationDelay: "220ms" }}>
            <label htmlFor="email" className="sr-only">
              E-mail
            </label>
            <Mail size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-[15px]" />
            <input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${classeCampo} pr-3`}
            />
          </div>

          <div className="login-campo relative" style={{ animationDelay: "280ms" }}>
            <label htmlFor="senha" className="sr-only">
              Senha
            </label>
            <Lock size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-[15px]" />
            <input
              id="senha"
              type={mostrarSenha ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={`${classeCampo} pr-12`}
            />
            <button
              type="button"
              onClick={() => setMostrarSenha((v) => !v)}
              aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg outline-none hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-indigo"
            >
              {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {erro && (
            <p role="alert" className="flex items-start gap-2 pt-1 text-sm font-semibold">
              <CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0" />
              {erro}
            </p>
          )}

          <div className="login-campo !mt-5" style={{ animationDelay: "340ms" }}>
            <button
              type="submit"
              disabled={enviando || saindo}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-white text-base font-bold text-marca-indigo outline-none hover:bg-marca-indigo hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca-indigo disabled:cursor-wait disabled:hover:bg-white disabled:hover:text-marca-indigo"
            >
              {enviando && <Loader2 size={18} aria-hidden="true" className="animate-spin" />}
              {enviando ? "Entrando..." : "Entrar"}
            </button>
          </div>

          <div className="login-campo flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1 text-sm" style={{ animationDelay: "400ms" }}>
            <p>Acesso restrito à equipe.</p>
            <Link to="/recuperar-senha" className="font-semibold underline underline-offset-2 hover:opacity-70">
              Esqueci minha senha
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
