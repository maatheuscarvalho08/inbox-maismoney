import { useEffect, useRef, useState, type FormEvent } from "react";
import Papa from "papaparse";
import { ArrowLeft, Plus, Send, Upload, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Select } from "./Select";
import type { Instancia, Template } from "../types/api";

type ModoDestinatario = "unico" | "csv";

function normalizarNumero(valor: string) {
  return valor.replace(/\D/g, "");
}

function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatarDuracao(segundosTotais: number) {
  const h = Math.floor(segundosTotais / 3600);
  const m = Math.floor((segundosTotais % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}min`;
  return `${m}min`;
}

export function NovoDisparoForm({ onFechar, onEnviado }: { onFechar: () => void; onEnviado: () => void }) {
  const [instancias, setInstancias] = useState<Instancia[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [instanciaId, setInstanciaId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variaveis, setVariaveis] = useState<string[]>([]);

  const [modo, setModo] = useState<ModoDestinatario>("unico");
  const [numeroDestino, setNumeroDestino] = useState("");

  const [colunasCsv, setColunasCsv] = useState<string[]>([]);
  const [linhasCsv, setLinhasCsv] = useState<Record<string, string>[]>([]);
  const [colunaTelefone, setColunaTelefone] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [erroCsv, setErroCsv] = useState<string | null>(null);
  const inputCsvRef = useRef<HTMLInputElement>(null);

  const [intervaloMin, setIntervaloMin] = useState(1);
  const [intervaloSeg, setIntervaloSeg] = useState(30);

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

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
    ? Array.from(
        new Set(
          linhasCsv
            .map((linha) => normalizarNumero(linha[colunaTelefone] ?? ""))
            .filter((numero) => numero.length >= 8),
        ),
      )
    : [];

  function handleArquivoCsv(file: File) {
    setErroCsv(null);
    setColunaTelefone("");
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
    setNomeArquivo("");
    setErroCsv(null);
    if (inputCsvRef.current) inputCsvRef.current.value = "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);

    const variaveisLimpo = variaveis.filter((v) => v.trim());

    try {
      if (modo === "unico") {
        const res = await api.post<{ entregue: boolean; erroEntrega?: string }>("/disparos", {
          instanciaId,
          templateId,
          numeroDestino: normalizarNumero(numeroDestino),
          variaveis: variaveisLimpo,
        });
        setResultado(
          res.entregue
            ? { ok: true, texto: "Disparo enviado com sucesso." }
            : { ok: false, texto: `Mensagem registrada, mas a entrega falhou: ${res.erroEntrega}` },
        );
        setNumeroDestino("");
        if (res.entregue) {
          onEnviado();
          await aguardar(1200);
          onFechar();
        }
      } else {
        // Roda no backend (fila), não num loop aqui no navegador — continua mesmo se
        // você fechar essa aba. O andamento aparece ao vivo na lista de Disparos.
        const intervaloMs = (intervaloMin * 60 + intervaloSeg) * 1000;
        await api.post("/disparos/lote", {
          instanciaId,
          templateId,
          numeros: numerosDetectados,
          variaveis: variaveisLimpo,
          intervaloMs,
        });
        setResultado({
          ok: true,
          texto: `Lote de ${numerosDetectados.length} disparo(s) enviado pra fila — acompanhe o andamento na lista.`,
        });
        limparCsv();
        onEnviado();
        await aguardar(1800);
        onFechar();
      }
      setVariaveis([]);
    } catch (err) {
      setResultado({ ok: false, texto: err instanceof ApiError ? err.message : "Não foi possível enviar o disparo" });
    } finally {
      setEnviando(false);
    }
  }

  const podeEnviar =
    !!instanciaId && !!templateId && (modo === "unico" ? !!numeroDestino : numerosDetectados.length > 0);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <button
          type="button"
          onClick={onFechar}
          className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-white"
        >
          <ArrowLeft size={14} /> Voltar
        </button>
        <span className="ml-1 text-sm font-semibold text-white">Novo disparo</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Número de origem</label>
          <Select
            value={instanciaId}
            onChange={setInstanciaId}
            placeholder="Selecione..."
            options={instancias.map((i) => ({ value: i.id, label: i.numero }))}
          />
          {instanciaId === "" && instancias.length === 0 && (
            <p className="mt-1 text-xs text-muted">Nenhum número Meta Cloud API cadastrado ainda.</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted">Template aprovado</label>
          <Select
            disabled={!instanciaId}
            value={templateId}
            onChange={setTemplateId}
            placeholder="Selecione..."
            options={templates.map((t) => ({ value: t.id, label: t.nome }))}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setModo("unico")}
              className={`flex-1 rounded px-2 py-1 font-medium transition-colors duration-150 ease-out ${
                modo === "unico" ? "bg-primary/15 text-primary" : "text-muted hover:text-white"
              }`}
            >
              Número único
            </button>
            <button
              type="button"
              onClick={() => setModo("csv")}
              className={`flex-1 rounded px-2 py-1 font-medium transition-colors duration-150 ease-out ${
                modo === "csv" ? "bg-primary/15 text-primary" : "text-muted hover:text-white"
              }`}
            >
              Importar CSV
            </button>
          </div>

          {modo === "unico" ? (
            <input
              placeholder="5521999999999"
              value={numeroDestino}
              onChange={(e) => setNumeroDestino(e.target.value)}
              className="w-full rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
            />
          ) : (
            <div className="space-y-2">
              {!nomeArquivo ? (
                <button
                  type="button"
                  onClick={() => inputCsvRef.current?.click()}
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
                ref={inputCsvRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleArquivoCsv(e.target.files[0])}
              />

              {erroCsv && <p className="text-xs text-primary">{erroCsv}</p>}

              {colunasCsv.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Qual coluna é o telefone?</label>
                  <Select
                    value={colunaTelefone}
                    onChange={setColunaTelefone}
                    placeholder="Selecione a coluna..."
                    options={colunasCsv.map((c) => ({ value: c, label: c }))}
                  />
                  {colunaTelefone && (
                    <p className="mt-1.5 text-xs text-muted">
                      {numerosDetectados.length} número(s) único(s) detectado(s) na coluna "{colunaTelefone}".
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {modo === "csv" && numerosDetectados.length > 1 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              Intervalo entre cada mensagem (evita bloqueio por envio em massa)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={intervaloMin}
                onChange={(e) => setIntervaloMin(Math.max(0, Number(e.target.value)))}
                className="w-16 rounded-md border border-border bg-bg/60 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-primary"
              />
              <span className="text-xs text-muted">min</span>
              <input
                type="number"
                min={0}
                max={59}
                value={intervaloSeg}
                onChange={(e) => setIntervaloSeg(Math.min(59, Math.max(0, Number(e.target.value))))}
                className="w-16 rounded-md border border-border bg-bg/60 px-2 py-1.5 text-center text-sm text-white outline-none focus:border-primary"
              />
              <span className="text-xs text-muted">seg</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Tempo estimado total: ~{formatarDuracao((intervaloMin * 60 + intervaloSeg) * (numerosDetectados.length - 1))}
            </p>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Variáveis do template</label>
            <button
              type="button"
              onClick={() => setVariaveis((v) => [...v, ""])}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus size={12} /> Adicionar
            </button>
          </div>
          <div className="space-y-2">
            {variaveis.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={v}
                  onChange={(e) =>
                    setVariaveis((atual) => atual.map((val, idx) => (idx === i ? e.target.value : val)))
                  }
                  placeholder={`Variável ${i + 1}`}
                  className="flex-1 rounded-md border border-border bg-bg/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setVariaveis((atual) => atual.filter((_, idx) => idx !== i))}
                  className="text-muted hover:text-primary"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {resultado && <p className="text-sm text-primary">{resultado.texto}</p>}

        <button
          type="submit"
          disabled={enviando || !podeEnviar}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50"
        >
          <Send size={16} />
          {enviando
            ? "Enviando..."
            : modo === "csv" && numerosDetectados.length > 0
              ? `Enviar disparo para ${numerosDetectados.length}`
              : "Enviar disparo"}
        </button>
      </form>
    </div>
  );
}
