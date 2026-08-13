import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth, type Usuario } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";

interface ConfigSistema {
  empresa: { nome: string; cnpj: string; setor: string };
  midia: { retencaoDias: number };
  contadores: { totalUsuarios: number; usuariosAtivos: number; totalInstancias: number; instanciasConectadas: number };
}

function CardPerfil() {
  const { usuario, atualizarUsuario } = useAuth();
  const [nome, setNome] = useState(usuario?.nome ?? "");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(false);
    setEnviando(true);
    try {
      const res = await api.patch<{ usuario: Usuario }>("/usuarios/me", {
        nome: nome !== usuario?.nome ? nome : undefined,
        senhaAtual: novaSenha ? senhaAtual : undefined,
        novaSenha: novaSenha || undefined,
      });
      atualizarUsuario(res.usuario);
      setSenhaAtual("");
      setNovaSenha("");
      setSucesso(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md space-y-4 rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl"
    >
      <div>
        <h2 className="text-sm font-semibold text-white">Meu perfil</h2>
        <p className="mt-0.5 text-xs text-muted">{usuario?.email}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">Nome</label>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
        />
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-medium text-muted">Trocar senha (opcional)</p>
        <div className="space-y-2">
          <input
            type="password"
            placeholder="Senha atual"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
          <input
            type="password"
            placeholder="Nova senha (mín. 8 caracteres)"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
        </div>
      </div>

      {erro && <p className="text-xs text-primary">{erro}</p>}
      {sucesso && <p className="text-xs text-primary">Perfil atualizado.</p>}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
      >
        {enviando ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}

function CardSistema() {
  const [config, setConfig] = useState<ConfigSistema | null>(null);

  useEffect(() => {
    api.get<ConfigSistema>("/config").then(setConfig);
  }, []);

  if (!config) return null;

  return (
    <div className="w-full max-w-md space-y-4 rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-white">Sistema</h2>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Empresa</p>
        <p className="mt-1 text-sm text-white">{config.empresa.nome}</p>
        <p className="text-xs text-muted">
          {config.empresa.cnpj} · {config.empresa.setor}
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Retenção de mídia</p>
        <p className="mt-1 text-sm text-white">
          Arquivos são apagados após {config.midia.retencaoDias} dias de inatividade na conversa
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Números e equipe</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-lg font-bold text-white">
              {config.contadores.instanciasConectadas}/{config.contadores.totalInstancias}
            </p>
            <p className="text-xs text-muted">números conectados</p>
          </div>
          <div>
            <p className="text-lg font-bold text-white">
              {config.contadores.usuariosAtivos}/{config.contadores.totalUsuarios}
            </p>
            <p className="text-xs text-muted">usuários ativos</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfiguracoesPage() {
  const { usuario } = useAuth();

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Preferências da conta e do sistema" />

      <div className="flex flex-wrap gap-4 p-8">
        <CardPerfil />
        {usuario?.role === "admin" && <CardSistema />}
      </div>
    </div>
  );
}
