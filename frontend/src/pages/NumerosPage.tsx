import { useEffect, useState, type FormEvent } from "react";
import { Plus, Smartphone, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import type { Instancia, TipoConexao, Template } from "../types/api";

const LABEL_CONEXAO: Record<TipoConexao, string> = {
  evolution: "Evolution API",
  meta_cloud: "Meta Cloud API",
};

function FormNovoNumero({ onCriado }: { onCriado: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [tipoConexao, setTipoConexao] = useState<TipoConexao>("evolution");
  const [evolutionInstanceId, setEvolutionInstanceId] = useState("");
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.post("/instancias", {
        nome,
        numero: numero.replace(/\D/g, ""),
        tipoConexao,
        evolutionInstanceId: tipoConexao === "evolution" ? evolutionInstanceId : undefined,
        metaPhoneNumberId: tipoConexao === "meta_cloud" ? metaPhoneNumberId : undefined,
        metaWabaId: tipoConexao === "meta_cloud" ? metaWabaId : undefined,
      });
      setNome("");
      setNumero("");
      setEvolutionInstanceId("");
      setMetaPhoneNumberId("");
      setMetaWabaId("");
      setAberto(false);
      onCriado();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível cadastrar o número");
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
      >
        <Plus size={14} /> Novo número
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl sm:grid-cols-2"
    >
      <input
        required
        placeholder="Nome (ex. Atendimento 1)"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
      />
      <input
        required
        placeholder="Número (5521999999999)"
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
      />

      <Select
        value={tipoConexao}
        onChange={(v) => setTipoConexao(v as TipoConexao)}
        options={[
          { value: "evolution", label: "Evolution API (atendimento)" },
          { value: "meta_cloud", label: "Meta Cloud API (disparo)" },
        ]}
      />

      {tipoConexao === "evolution" ? (
        <input
          required
          placeholder="Nome da instância na Evolution API"
          value={evolutionInstanceId}
          onChange={(e) => setEvolutionInstanceId(e.target.value)}
          className="rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
        />
      ) : (
        <div className="flex gap-2">
          <input
            required
            placeholder="Phone Number ID"
            value={metaPhoneNumberId}
            onChange={(e) => setMetaPhoneNumberId(e.target.value)}
            className="w-1/2 rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
          <input
            required
            placeholder="WABA ID"
            value={metaWabaId}
            onChange={(e) => setMetaWabaId(e.target.value)}
            className="w-1/2 rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
          />
        </div>
      )}

      {erro && <p className="text-xs text-primary sm:col-span-2">{erro}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={enviando}
          className="flex-1 rounded-md bg-primary py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
        >
          {enviando ? "Cadastrando..." : "Cadastrar número"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function TemplatesDaInstancia({ instanciaId }: { instanciaId: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [nome, setNome] = useState("");
  const [metaTemplateId, setMetaTemplateId] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const res = await api.get<{ templates: Template[] }>(`/templates?instanciaId=${instanciaId}`);
    setTemplates(res.templates);
  }

  useEffect(() => {
    carregar();
  }, [instanciaId]);

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api.post("/templates", { instanciaId, nome, metaTemplateId });
      setNome("");
      setMetaTemplateId("");
      setAdicionando(false);
      carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível adicionar o template");
    }
  }

  async function remover(id: string) {
    await api.delete(`/templates/${id}`);
    carregar();
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Templates</p>
        <button onClick={() => setAdicionando((v) => !v)} className="text-muted hover:text-primary">
          {adicionando ? <X size={12} /> : <Plus size={12} />}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {templates.length === 0 && <p className="text-xs text-muted">Nenhum template cadastrado.</p>}
        {templates.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 rounded border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >
            {t.nome}
            <button onClick={() => remover(t.id)} className="hover:text-white">
              <X size={9} />
            </button>
          </span>
        ))}
      </div>

      {adicionando && (
        <form onSubmit={adicionar} className="mt-2 space-y-1.5">
          <input
            required
            placeholder="Nome do template"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-2 py-1.5 text-xs text-white outline-none focus:border-primary"
          />
          <input
            required
            placeholder="ID aprovado na Meta"
            value={metaTemplateId}
            onChange={(e) => setMetaTemplateId(e.target.value)}
            className="w-full rounded-md border border-border bg-bg/60 px-2 py-1.5 text-xs text-white outline-none focus:border-primary"
          />
          {erro && <p className="text-[10px] text-primary">{erro}</p>}
          <button type="submit" className="w-full rounded-md border border-primary py-1 text-xs font-medium text-primary hover:bg-primary/10">
            Adicionar
          </button>
        </form>
      )}
    </div>
  );
}

export function NumerosPage() {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroQrCode, setErroQrCode] = useState<string | null>(null);

  async function carregar() {
    const res = await api.get<{ instancias: Instancia[] }>("/instancias");
    setInstancias(res.instancias);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  useSocketEvent("instancia:atualizada", () => carregar());

  async function reconectar(id: string) {
    setErroQrCode(null);
    try {
      await api.get(`/instancias/${id}/qrcode`);
    } catch (err) {
      setErroQrCode(
        err instanceof ApiError
          ? `Não foi possível gerar o QR Code: ${err.message}`
          : "Não foi possível gerar o QR Code",
      );
    }
  }

  return (
    <div>
      <PageHeader title="Números" subtitle="Status das instâncias WhatsApp" right={<FormNovoNumero onCriado={carregar} />} />

      <div className="p-8">
        {erroQrCode && (
          <p className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
            {erroQrCode}
          </p>
        )}

        {carregando ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : instancias.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted">
            Nenhuma instância cadastrada ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {instancias.map((inst) => (
              <div key={inst.id} className="rounded-lg border border-white/10 bg-surface/40 p-4 backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Smartphone size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">{inst.nome}</p>
                    <p className="text-xs text-muted">{inst.numero}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted">{LABEL_CONEXAO[inst.tipoConexao]}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${
                      inst.status === "conectado"
                        ? "border-primary/30 bg-primary/15 text-primary"
                        : "border-border bg-border/60 text-muted"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${inst.status === "conectado" ? "bg-primary" : "bg-muted"}`}
                    />
                    {inst.status === "conectado" ? "Conectado" : "Desconectado"}
                  </span>
                </div>

                {inst.tipoConexao === "evolution" && (
                  <button
                    onClick={() => reconectar(inst.id)}
                    className="mt-3 w-full rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    Reconectar (QR Code)
                  </button>
                )}

                {inst.tipoConexao === "meta_cloud" && <TemplatesDaInstancia instanciaId={inst.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
