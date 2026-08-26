import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { Upload, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import type { Campanha, Instancia, Template } from "../types/api";

function normalizarNumero(valor: string) {
  return valor.replace(/\D/g, "");
}

export function DiscadoraNovaPage() {
  const navigate = useNavigate();

  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [nome, setNome] = useState("");
  const [instanciaId, setInstanciaId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  const [colunasCsv, setColunasCsv] = useState<string[]>([]);
  const [linhasCsv, setLinhasCsv] = useState<Record<string, string>[]>([]);
  const [colunaTelefone, setColunaTelefone] = useState("");
  const [colunaNome, setColunaNome] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [erroCsv, setErroCsv] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ instancias: Instancia[] }>("/instancias").then((res) => {
      setInstancias(res.instancias.filter((i) => i.tipoConexao === "meta_cloud"));
    });
  }, []);

  useEffect(() => {
    setTemplateId("");
    if (!instanciaId) {
      setTemplates([]);
      return;
    }
    api.get<{ templates: Template[] }>(`/templates?instanciaId=${instanciaId}`).then((res) => setTemplates(res.templates));
  }, [instanciaId]);

  const numerosDetectados = colunaTelefone
    ? linhasCsv
        .map((linha) => ({
          numeroWhatsapp: normalizarNumero(linha[colunaTelefone] ?? ""),
          nomeContato: colunaNome ? linha[colunaNome] : undefined,
        }))
        .filter((n) => n.numeroWhatsapp.length >= 8)
    : [];

  function handleCsv(file: File) {
    setErroCsv(null);
    setColunaTelefone("");
    setColunaNome("");
    setNomeArquivo(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (resultado) => {
        if (resultado.data.length === 0) {
          setErroCsv("Não foi possível ler o CSV. Confira o formato do arquivo.");
          return;
        }
        setColunasCsv(resultado.meta.fields ?? []);
        setLinhasCsv(resultado.data);
      },
      error: () => setErroCsv("Não foi possível ler o CSV."),
    });
  }

  function limparCsv() {
    setColunasCsv([]);
    setLinhasCsv([]);
    setColunaTelefone("");
    setColunaNome("");
    setNomeArquivo("");
    setErroCsv(null);
    if (csvRef.current) csvRef.current.value = "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!audio) return;
    setErro(null);
    setEnviando(true);

    try {
      const form = new FormData();
      form.append("nome", nome);
      form.append("instanciaId", instanciaId);
      form.append("templateId", templateId);
      form.append("audio", audio);

      const { campanha } = await api.post<{ campanha: Campanha }>("/campanhas", form);

      if (numerosDetectados.length > 0) {
        await api.post(`/campanhas/${campanha.id}/numeros`, { numeros: numerosDetectados });
      }

      navigate(`/discadora/${campanha.id}`);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar a campanha");
      setEnviando(false);
    }
  }

  const podeEnviar = !!nome && !!instanciaId && !!templateId && !!audio && numerosDetectados.length > 0;

  return (
    <div>
      <PageHeader title="Nova campanha" subtitle="Discadora — ligação automática com IVR" />

      <div className="flex justify-center p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 rounded-lg border border-white/10 bg-surface/40 p-5 backdrop-blur-xl">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Nome da campanha</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Consignado INSS — agosto"
              className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Número de origem (Meta Cloud API)</label>
            <Select
              value={instanciaId}
              onChange={setInstanciaId}
              placeholder="Selecione..."
              options={instancias.map((i) => ({ value: i.id, label: `${i.nome} (${i.numero})` }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Template a disparar quando apertar 1</label>
            <Select
              disabled={!instanciaId}
              value={templateId}
              onChange={setTemplateId}
              placeholder="Selecione..."
              options={templates.map((t) => ({ value: t.id, label: t.nome }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Áudio da ligação (MP3)</label>
            {!audio ? (
              <button
                type="button"
                onClick={() => audioRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-4 text-xs font-medium text-muted hover:border-primary hover:text-primary"
              >
                <Upload size={14} />
                Selecionar arquivo MP3
              </button>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-border bg-bg/40 px-3 py-2 text-xs">
                <span className="truncate text-white">{audio.name}</span>
                <button type="button" onClick={() => setAudio(null)} className="text-muted hover:text-primary">
                  <X size={14} />
                </button>
              </div>
            )}
            <input
              ref={audioRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && setAudio(e.target.files[0])}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">Lista de números (CSV)</label>
            {!nomeArquivo ? (
              <button
                type="button"
                onClick={() => csvRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-4 text-xs font-medium text-muted hover:border-primary hover:text-primary"
              >
                <Upload size={14} />
                Selecionar arquivo CSV
              </button>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-border bg-bg/40 px-3 py-2 text-xs">
                <span className="truncate text-white">{nomeArquivo}</span>
                <button type="button" onClick={limparCsv} className="text-muted hover:text-primary">
                  <X size={14} />
                </button>
              </div>
            )}
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])}
            />
            {erroCsv && <p className="mt-1.5 text-xs text-primary">{erroCsv}</p>}

            {colunasCsv.length > 0 && (
              <div className="mt-2 space-y-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Qual coluna é o telefone?</label>
                  <Select
                    value={colunaTelefone}
                    onChange={setColunaTelefone}
                    placeholder="Selecione a coluna..."
                    options={colunasCsv.map((c) => ({ value: c, label: c }))}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Qual coluna é o nome do contato? (opcional)</label>
                  <Select
                    value={colunaNome}
                    onChange={setColunaNome}
                    placeholder="Nenhuma"
                    options={colunasCsv.map((c) => ({ value: c, label: c }))}
                  />
                </div>
                {colunaTelefone && (
                  <p className="text-xs text-muted">{numerosDetectados.length} número(s) detectado(s) na coluna "{colunaTelefone}".</p>
                )}
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-primary">{erro}</p>}

          <button
            type="submit"
            disabled={enviando || !podeEnviar}
            className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
          >
            {enviando ? "Criando..." : "Criar campanha"}
          </button>
        </form>
      </div>
    </div>
  );
}
