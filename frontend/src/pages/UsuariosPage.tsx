import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import type { Role, Usuario } from "../types/api";

export function UsuariosPage() {
  const { usuario: usuarioLogado } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [role, setRole] = useState<Role>("operador");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    const res = await api.get<{ usuarios: Usuario[] }>("/usuarios");
    setUsuarios(res.usuarios);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.post("/usuarios", { nome, email, senha, role });
      setNome("");
      setEmail("");
      setSenha("");
      setRole("operador");
      setMostrarForm(false);
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar o usuário");
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAtivo(u: Usuario) {
    try {
      await api.patch(`/usuarios/${u.id}`, { ativo: !u.ativo });
      carregar();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Não foi possível atualizar o usuário");
    }
  }

  async function alterarRole(u: Usuario, novoRole: Role) {
    try {
      await api.patch(`/usuarios/${u.id}`, { role: novoRole });
      carregar();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Não foi possível atualizar o papel do usuário");
    }
  }

  const [editandoEmailId, setEditandoEmailId] = useState<string | null>(null);
  const [emailEditado, setEmailEditado] = useState("");

  async function salvarEmail(u: Usuario) {
    const novoEmail = emailEditado.trim().toLowerCase();
    setEditandoEmailId(null);
    if (!novoEmail || novoEmail === u.email) return;
    try {
      await api.patch(`/usuarios/${u.id}`, { email: novoEmail });
      carregar();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Não foi possível atualizar o e-mail");
    }
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Gestão de operadores"
        right={
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
          >
            <Plus size={14} /> Novo usuário
          </button>
        }
      />

      <div className="p-8">
        {mostrarForm && (
          <form
            onSubmit={handleSubmit}
            className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-4"
          >
            <input
              required
              placeholder="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
            <input
              required
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
            <input
              required
              type="password"
              placeholder="Senha (mín. 8 caracteres)"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
            <Select
              value={role}
              onChange={(v) => setRole(v as Role)}
              options={[
                { value: "operador", label: "Operador" },
                { value: "admin", label: "Admin" },
              ]}
            />

            {erro && <p className="sm:col-span-2 lg:col-span-4 text-xs text-primary">{erro}</p>}

            <button
              type="submit"
              disabled={enviando}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50 sm:col-span-2 lg:col-span-4"
            >
              {enviando ? "Criando..." : "Criar usuário"}
            </button>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-white/10 bg-surface/40 backdrop-blur-xl">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr>
                {["Nome", "E-mail", "Papel", "Status", ""].map((col) => (
                  <th key={col} className="px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-muted">
                    Carregando...
                  </td>
                </tr>
              )}
              {!carregando &&
                usuarios.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-5 py-3 font-medium text-white">{u.nome}</td>
                    <td className="px-5 py-3 text-muted">
                      {editandoEmailId === u.id ? (
                        <input
                          autoFocus
                          type="email"
                          defaultValue={u.email}
                          onChange={(e) => setEmailEditado(e.target.value)}
                          onBlur={() => salvarEmail(u)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditandoEmailId(null);
                          }}
                          className="w-full rounded border border-primary bg-bg/60 px-1.5 py-0.5 text-sm text-white outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEmailEditado(u.email);
                            setEditandoEmailId(u.id);
                          }}
                          className="hover:text-white hover:underline"
                          title="Clique para editar"
                        >
                          {u.email}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {u.id === usuarioLogado?.id ? (
                        <span className="capitalize text-muted">{u.role}</span>
                      ) : (
                        <Select
                          value={u.role}
                          onChange={(v) => alterarRole(u, v as Role)}
                          options={[
                            { value: "operador", label: "Operador" },
                            { value: "admin", label: "Admin" },
                          ]}
                        />
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                          u.ativo ? "border-primary/30 bg-primary/15 text-primary" : "border-border bg-border/60 text-muted"
                        }`}
                      >
                        {u.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {u.id !== usuarioLogado?.id && (
                        <button onClick={() => alternarAtivo(u)} className="text-xs text-primary hover:underline">
                          {u.ativo ? "Desativar" : "Ativar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
