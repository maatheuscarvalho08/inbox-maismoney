// Fases 6 e 6.1: tentativa de quebrar os mecanismos de concorrência, idempotência, entrega
// e recuperação da Maisa. A fase 6 encontrou as falhas; a 6.1 reproduz os mesmos ataques
// contra as correções e acrescenta os grupos N.
// Postgres 16 real (persistente, para parar e voltar), Facta e Evolution falsas que
// conseguem "criar e depois falhar" e "enviar e depois devolver erro", e processos
// separados de verdade, que são mortos em momentos aleatórios.
// Uso (cwd = backend): node --import tsx testes-operacao/adversarial.mts [--grupo X] [--seed N]
import http from "node:http";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";

const BACKEND = "C:/Users/mathe/Desktop/Inbox Mais Money/backend";
const ESTE = fileURLToPath(import.meta.url);
const imp = (rel: string) => import(pathToFileURL(path.join(BACKEND, rel)).href);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);

// ---------- aleatório reproduzível ----------
let semente = Number(args.includes("--seed") ? args[args.indexOf("--seed") + 1] : 20261112);
const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a: number, b: number) => Math.round(a + aleatorio() * (b - a));

// ---------- worker: um "processo" do backend ----------
if (args[0] === "--worker") {
  const cfg = JSON.parse(args[1]);
  const { initSocket } = await imp("src/ws/socket.ts");
  initSocket(http.createServer());
  const svc = await imp("src/modules/maisa/maisa.service.ts");
  const { prisma } = await imp("src/db/prisma.ts");
  svc.portasMaisa.agora = () => new Date(Date.now() + (cfg.deslocamento ?? 0));
  svc.portasMaisa.digitando = () => 0;
  svc.portasMaisa.esperaReenvioMs = () => cfg.esperaReenvioMs ?? 0;
  process.send?.("pronto");
  if (cfg.acao === "processar") await svc.processarComMaisa(cfg.conversaId, cfg.mensagemId);
  if (cfg.acao === "executar") await svc.executarDigitacoesPendentes();
  if (cfg.acao === "recuperar") await svc.recuperarMaisa();
  if (cfg.acao === "ofertas") await svc.verificarOfertasPendentes();
  if (cfg.acao === "despachar") await svc.despachar();
  await svc.aguardarFilas();
  await prisma.$disconnect();
  process.exit(0);
}

// ---------- Facta falsa ----------
type ModoFacta = "ok" | "erro" | "lento" | "500" | "queda" | "cria_e_lento" | "cria_e_500" | "cria_e_erro" | "cria_e_html" | "408" | "sem_codigo" | "codigo_vazio" | "502";
interface Plano { atraso?: Record<string, number>; modo?: Record<string, ModoFacta> }
const facta = { planos: new Map<string, Plano>(), log: [] as { rota: string; cpf: string; t: number; criou: boolean }[] };
const CRIA = new Set<ModoFacta>(["ok", "cria_e_lento", "cria_e_500", "cria_e_erro", "cria_e_html", "sem_codigo", "codigo_vazio"]);
const servidorFacta = http.createServer((req, res) => {
  const rota = (req.url ?? "").split("?")[0];
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", async () => {
    // A etapa 3 não manda o CPF: ele vem embutido no código do cliente e do simulador.
    const form = new URLSearchParams(corpo);
    const cpf = form.get("cpf") ?? (form.get("codigo_cliente") ?? form.get("id_simulador") ?? form.get("codigo_af") ?? "").split("-")[1] ?? "";
    const plano = facta.planos.get(cpf) ?? {};
    const chave = rota.replace("/proposta/", "");
    const modo = plano.modo?.[chave] ?? "ok";
    const t = Date.now();
    facta.log.push({ rota, cpf, t, criou: rota.includes("etapa3") && CRIA.has(modo) });
    await sleep(plano.atraso?.[chave] ?? 0);
    const json = (o: unknown, status = 200) => !res.writableEnded && res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(o));
    if (modo === "queda") return req.socket.destroy();
    if (modo === "lento" || modo === "cria_e_lento") return setTimeout(() => json({}), 30_000);
    if (modo === "500" || modo === "cria_e_500") return json({ erro: true }, 500);
    if (modo === "408") return json({ erro: true, mensagem: "timeout" }, 408);
    if (modo === "502") return json({ erro: true }, 502);
    if (modo === "sem_codigo") return json({ erro: false, mensagem: "ok" });
    if (modo === "codigo_vazio") return json({ erro: false, codigo: "", url_formalizacao: "" });
    if (modo === "erro" || modo === "cria_e_erro") return json({ erro: true, mensagem: `recusado em ${rota}` });
    if (modo === "cria_e_html") return !res.writableEnded && res.writeHead(200, { "Content-Type": "text/html" }).end("<html>gateway</html>");
    const r: Record<string, unknown> = {
      "/gera-token": { erro: false, token: "t" },
      "/proposta/etapa1-simulador": { erro: false, id_simulador: `S-${cpf}` },
      "/proposta/etapa2-dados-pessoais": { erro: false, codigo_cliente: `C-${cpf}` },
      "/proposta/etapa3-proposta-cadastro": { erro: false, codigo: `AF-${cpf}-${t}`, url_formalizacao: `https://facta.teste/${t}` },
      "/proposta/envio-link": { erro: false },
      "/solicita-autorizacao-consulta": { erro: false, mensagem: "link enviado" },
    };
    json(r[rota] ?? { erro: true, mensagem: "rota" });
  });
});
const criadas = (cpf: string) => facta.log.filter((l) => l.cpf === cpf && l.criou).length;
const chamadasFacta = (cpf: string, rota = "") => facta.log.filter((l) => l.cpf === cpf && l.rota.includes(rota)).length;

// ---------- Evolution falsa ----------
type ModoEnvio = "ok" | "503" | "502" | "504" | "429" | "500" | "400" | "lento" | "queda" | "envia_e_504" | "envia_e_502" | "envia_e_503" | "envia_e_429" | "envia_e_lento";
const evo = { filas: new Map<string, ModoEnvio[]>(), atraso: 0, entregues: [] as { numero: string; texto: string; t: number }[], chamadas: [] as { numero: string; t: number }[] };
const servidorEvolution = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", async () => {
    let numero = "", texto = "";
    try { const j = JSON.parse(corpo); numero = j.number; texto = j.text; } catch { /* sem corpo */ }
    evo.chamadas.push({ numero, t: Date.now() });
    const fila = evo.filas.get(numero) ?? [];
    const modo = fila.shift() ?? "ok";
    await sleep(evo.atraso);
    const json = (o: unknown, s: number) => !res.writableEnded && res.writeHead(s, { "Content-Type": "application/json" }).end(JSON.stringify(o));
    if (modo.startsWith("envia_") || modo === "ok") evo.entregues.push({ numero, texto, t: Date.now() });
    if (modo === "ok") return json({ key: { id: `E${Date.now()}${Math.random()}` } }, 201);
    if (modo === "queda") return req.socket.destroy();
    if (modo === "lento" || modo === "envia_e_lento") return setTimeout(() => json({}, 201), 30_000);
    const status = Number(modo.replace("envia_e_", ""));
    json({ message: `HTTP ${status}` }, status);
  });
});
const entregues = (numero: string, re?: RegExp) => evo.entregues.filter((e) => e.numero === numero && (!re || re.test(e.texto))).length;

const ouvir = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

// ---------- principal ----------
const portaFacta = await ouvir(servidorFacta);
let portaEvo = await ouvir(servidorEvolution);
async function fecharEvolution() { servidorEvolution.closeAllConnections(); await new Promise<void>((r) => servidorEvolution.close(() => r())); }
async function abrirEvolution() { await new Promise<void>((r) => servidorEvolution.listen(portaEvo, "127.0.0.1", () => r())); }
const EmbeddedPostgres = (await import(pathToFileURL(path.join(BACKEND, "testes-operacao/node_modules/embedded-postgres/dist/index.js")).href)).default;
const dirPg = mkdtempSync(path.join(tmpdir(), "maisa-adv-"));
const PORTA_PG = 54341;
const pg = new EmbeddedPostgres({ databaseDir: dirPg, user: "t", password: "t", port: PORTA_PG, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
await pg.initialise();
await pg.start();
for (const db of ["adv", "mig_a", "mig_b", "mig_c", "mig_d", "mig_e", "mig_f", "sombra"]) await pg.createDatabase(db);
const url = (db: string) => `postgresql://t:t@127.0.0.1:${PORTA_PG}/${db}?connection_limit=5&pool_timeout=5`;
const ENV: Record<string, string> = {
  DATABASE_URL: url("adv"), JWT_SECRET: "t", MAISA_MODO: "automatico", MAISA_BANCO_SIMULADO: "false", MAISA_SIMULADOR: "false",
  MAISA_DIGITA_PROPOSTA: "true", MAISA_DIGITACAO_LIBERADA: "true", MAISA_JANELA_CONFIRMACAO_S: "30", MAISA_FOLLOWUP_PORT: "false",
  MAISA_ENTREGA_TENTATIVAS: "3", FACTA_BASE_URL: `http://127.0.0.1:${portaFacta}`, FACTA_USER: "u", FACTA_PASS: "p",
  FACTA_LOGIN_CERTIFICADO: "c", FACTA_CODIGO_MASTER: "1", FACTA_TIMEOUT_MS: "1500",
  EVOLUTION_API_URL: `http://127.0.0.1:${portaEvo}`, EVOLUTION_API_KEY: "k", EVOLUTION_TIMEOUT_MS: "1500", EVOLUTION_WEBHOOK_TOKEN: "tok",
  META_ACCESS_TOKEN: "", META_APP_SECRET: "segredo-meta", OPENAI_API_KEY: "", PUBLIC_API_URL: "http://127.0.0.1:1",
};
Object.assign(process.env, ENV);
execSync("npx prisma migrate deploy", { cwd: BACKEND, env: process.env, stdio: "pipe" });

const { prisma } = await imp("src/db/prisma.ts");
const { initSocket } = await imp("src/ws/socket.ts");
initSocket(http.createServer());
const svc = await imp("src/modules/maisa/maisa.service.ts");
const { TEXTOS } = await imp("src/modules/maisa/textos.ts");
const { cpfValido } = await imp("src/modules/maisa/cpf.ts");
const { chaveOperacao } = await imp("src/modules/maisa/operacaoFacta.ts");
const { classificarFalhaEnvio } = await imp("src/modules/mensagens/falhaEnvio.ts");
let deslocamento = 0;
svc.portasMaisa.agora = () => new Date(Date.now() + deslocamento);
svc.portasMaisa.esperaReenvioMs = () => 0;
svc.portasMaisa.digitando = () => 0;

// CPFs válidos, um por conversa: a Facta falsa conta propostas por CPF.
const cpfs: string[] = [];
for (let n = 300000000; cpfs.length < 3000; n++) for (let d = 0; d <= 99; d++) { const c = `${n}${String(d).padStart(2, "0")}`; if (cpfValido(c)) { cpfs.push(c); break; } }
const instA = await prisma.instancia.create({ data: { nome: "A", numero: "5521000000011", tipoConexao: "evolution", evolutionInstanceId: "a", maisaAtiva: true, status: "conectado" } });
const instB = await prisma.instancia.create({ data: { nome: "B", numero: "5521000000012", tipoConexao: "evolution", evolutionInstanceId: "b", maisaAtiva: true, status: "conectado" } });
const instMeta = await prisma.instancia.create({ data: { nome: "M", numero: "5521000000013", tipoConexao: "meta_cloud", metaPhoneNumberId: "PNID", maisaAtiva: true, status: "conectado" } });

const DADOS = {
  nome: "Maria da Silva", rg: "123456789", orgaoEmissor: "SSP", estadoRg: "RJ", dataExpedicao: "2010-05-20", nomeMae: "Ana da Silva", nomePai: "José da Silva",
  cidadeNatural: "540", cidadeNaturalNome: "NITEROI", estadoNatural: "RJ", sexo: "F", estadoCivil: "4", estadoCivilNome: "SOLTEIRO", cep: "24020000", numero: "100",
  complemento: "", endereco: "Rua da Conceição", bairro: "Centro", cidade: "540", cidadeNome: "NITEROI", estado: "RJ", email: "maria@exemplo.com",
  matricula: "1234567", bancoConta: "104", agencia: "1234", conta: "123456", valorPatrimonio: "1", pixCpf: true, renda: 4670.31,
};
const OFERTA = (codigo = 1) => ({ banco: "Facta", valorCentavos: 1250000, parcelaCentavos: 30000, prazoMeses: 84, tabela: { codigoTabela: codigo, prazo: 84, contrato: 12500, parcela: 300, coeficiente: 0.024 }, renda: 4670.31, matricula: "1234567" });
const confirmacao = (extra: Record<string, unknown> = {}) => ({
  etapa: "confirmacao", tentativas: 0, produto: "siape", dataNascimento: "1958-03-15", oferta: OFERTA(),
  contrato: { dados: DADOS, pergunta: TEXTOS.perguntaConfirmacao, origem: { renda: "extrato", matricula: "extrato" } }, ...extra,
});
let seq = 0;
async function conversa(estado: unknown = confirmacao(), o: { cpf?: string; numero?: string; instanciaId?: string; comMaisa?: boolean; semMarca?: boolean } = {}) {
  seq++;
  const cpf = o.cpf ?? cpfs[seq];
  const numero = o.numero ?? `55219${String(seq).padStart(8, "0")}`;
  const contato = await prisma.contato.upsert({ where: { numeroWhatsapp: numero }, update: {}, create: { nome: `C${seq}`, cpf, numeroWhatsapp: numero } });
  const c = await prisma.conversa.create({ data: { instanciaId: o.instanciaId ?? instA.id, contatoId: contato.id, comMaisa: o.comMaisa ?? true, status: "aberta", maisaEstado: (estado ?? undefined) as any, createdAt: new Date(Date.now() - 600_000) } });
  // Conversa de depois do deploy: a última mensagem lida está marcada no estado.
  if (estado && !o.semMarca) {
    const t0 = new Date(Date.now() - 300_000);
    const ant = await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "cliente", conteudoTexto: "(mensagem anterior)", createdAt: t0, timestamp: t0 } });
    await prisma.conversa.update({ where: { id: c.id }, data: { maisaEstado: { ...(estado as object), ultimaMensagemId: ant.id, ultimaMensagemEm: ant.createdAt.toISOString() } as any } });
  }
  return { id: c.id, cpf, numero };
}
const { criarMensagem } = await imp("src/modules/mensagens/mensagens.service.ts");
// Mensagem do cliente pelo mesmo caminho do webhook (criarMensagem). Com createdAt
// forçado (recuperação), grava direto.
const msg = async (conversaId: string, texto: string | null, extra: { createdAt?: Date; timestamp?: Date; tipoMidia?: string } = {}): Promise<any> =>
  extra.createdAt
    ? prisma.mensagem.create({ data: { conversaId, remetenteTipo: "cliente", conteudoTexto: texto, ...extra } })
    : criarMensagem({ conversaId, remetenteTipo: "cliente", conteudoTexto: texto, ...(extra.timestamp ? { timestamp: extra.timestamp } : {}), ...(extra.tipoMidia ? { tipoMidia: extra.tipoMidia } : {}) });
async function cliente(conversaId: string, texto: string) {
  const m = await msg(conversaId, texto);
  await svc.processarComMaisa(conversaId, m.id);
  await svc.aguardarFilas();
  return m;
}
const estado = async (id: string) => (await prisma.conversa.findUniqueOrThrow({ where: { id } })).maisaEstado as any;
const conv = (id: string) => prisma.conversa.findUniqueOrThrow({ where: { id } });
const notas = async (id: string) => (await prisma.mensagem.findMany({ where: { conversaId: id, remetenteTipo: "nota" } })).map((n: any) => n.conteudoTexto ?? "");
const maisaRows = (id: string) => prisma.mensagem.findMany({ where: { conversaId: id, remetenteTipo: "maisa" }, orderBy: { createdAt: "asc" } });

// Worker num processo separado. matarEm: SIGKILL depois de tantos ms do início real da ação.
function worker(cfg: Record<string, unknown>, matar?: { depoisDe?: () => boolean; ms: number }): Promise<{ morto: boolean; codigo: number | null }> {
  return new Promise((resolve) => {
    const p: ChildProcess = spawn(process.execPath, ["--import", "tsx", ESTE, "--worker", JSON.stringify(cfg)], { cwd: BACKEND, env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let morto = false;
    p.on("message", async () => {
      if (!matar) return;
      if (matar.depoisDe) { const ini = Date.now(); while (!matar.depoisDe() && Date.now() - ini < 8000) await sleep(5); }
      await sleep(matar.ms);
      if (p.exitCode === null) { morto = true; p.kill("SIGKILL"); }
    });
    p.on("exit", (codigo) => resolve({ morto, codigo }));
  });
}

// Depois de uma queda, a recuperação real só age quando o lease da conversa (90 s) e o
// prazo de envio em andamento (cerca de 47 s) vencem. Aqui o tempo "passa" no banco.
async function expirarTudo() {
  await prisma.$executeRawUnsafe(`update conversas set maisa_lease_ate = null, maisa_lease_dono = null`);
  await prisma.$executeRawUnsafe(`update saidas_maisa set travado_ate = (now() at time zone 'UTC') - interval '1 hour' where status = 'processando'`);
}

// Estado final ruim: a conversa sai da Maisa sem passar para a equipe, resposta sem envio
// e sem nota, proposta criada sem registro.
async function invariantes(c: { id: string; cpf: string; numero: string }) {
  const problemas: string[] = [];
  const cv = await conv(c.id);
  const e = cv.maisaEstado as any;
  if (e?.etapa === "finalizada" && cv.comMaisa) problemas.push("finalizada mas ainda com a Maisa: cliente sem ninguém");
  // Fila de saída: nada parado, nenhuma resposta sem registro, falha nunca com a Maisa.
  const saidas = await prisma.saidaMaisa.findMany({ where: { conversaId: c.id } });
  const presas = saidas.filter((x: any) => x.status === "pendente" || x.status === "processando");
  if (presas.length) problemas.push(`${presas.length} resposta(s) presa(s) na fila de saída depois da recuperação`);
  const semSaida = (await maisaRows(c.id)).filter((m: any) => !saidas.some((x: any) => x.mensagemId === m.id));
  if (semSaida.length) problemas.push(`${semSaida.length} resposta(s) da Maisa sem registro de saída`);
  if (cv.comMaisa && saidas.some((x: any) => x.status === "falhou" || x.status === "incerto")) problemas.push("entrega falhou e a conversa continua com a Maisa");
  // Duplicada: um texto entregue mais vezes do que existem respostas com esse texto.
  const porTexto = new Map<string, number>();
  for (const e2 of evo.entregues.filter((x) => x.numero === c.numero)) porTexto.set(e2.texto, (porTexto.get(e2.texto) ?? 0) + 1);
  const linhas = new Map<string, number>();
  for (const m of await maisaRows(c.id)) linhas.set(m.conteudoTexto ?? "", (linhas.get(m.conteudoTexto ?? "") ?? 0) + 1);
  const repetidas = [...porTexto].filter(([t, n]) => n > (linhas.get(t) ?? 0));
  if (repetidas.length) problemas.push(`${repetidas.length} resposta(s) entregue(s) mais de uma vez`);
  const ops = await prisma.operacaoFacta.findMany({ where: { conversaId: c.id } });
  for (const op of ops) if (op.status === "concluida" && !(await prisma.proposta.count({ where: { conversaId: c.id } }))) problemas.push(`proposta ${op.codigoAf} criada sem registro na tela de Propostas`);
  if (criadas(c.cpf) > 1) problemas.push(`${criadas(c.cpf)} propostas criadas na Facta para a mesma oferta`);
  return problemas;
}

// ---------- registro ----------
type Achado = "QUEBROU" | "RESISTIU";
const resultados: { grupo: string; nome: string; resultado: Achado; detalhe: string }[] = [];
const grupoFiltro = args.includes("--grupo") ? args[args.indexOf("--grupo") + 1] : null;
async function cenario(grupo: string, nome: string, fn: () => Promise<{ quebrou: boolean; detalhe: string }>) {
  if (grupoFiltro && !grupo.startsWith(grupoFiltro)) return;
  deslocamento = 0;
  facta.planos.clear();
  evo.filas.clear();
  evo.atraso = 0;
  let r: { quebrou: boolean; detalhe: string };
  try {
    r = await fn();
    await svc.aguardarFilas();
  } catch (err) {
    console.log("PILHA", err instanceof Error ? err.stack?.slice(0, 900) : JSON.stringify(err));
    r = { quebrou: true, detalhe: `exceção no cenário: ${err instanceof Error ? err.message.slice(0, 300) : err}` };
  }
  await prisma.conversa.updateMany({ where: { comMaisa: true }, data: { comMaisa: false } });
  resultados.push({ grupo, nome, resultado: r.quebrou ? "QUEBROU" : "RESISTIU", detalhe: r.detalhe });
  console.log(`${r.quebrou ? "QUEBROU " : "resistiu"} [${grupo}] ${nome}${r.detalhe ? `\n          ${r.detalhe}` : ""}`);
}

// ===== R1: correção durante a execução =====
for (let i = 1; i <= 30; i++) {
  const d = entre(0, 1100);
  await cenario("R1 Correção durante o job", `correção ${d} ms depois de o job começar (mesmo processo)`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa1-simulador": 300, "etapa2-dados-pessoais": 300, "etapa3-proposta-cadastro": 100 } });
    await cliente(c.id, "sim");
    deslocamento = 31_000;
    const exec = svc.executarDigitacoesPendentes();
    await sleep(d);
    const tCorr = Date.now();
    const m = await msg(c.id, "espera, o CEP está errado");
    const tCorrFim = Date.now();
    const proc = svc.processarComMaisa(c.id, m.id);
    await exec; await proc; await svc.aguardarFilas();
    const e3 = facta.log.find((l) => l.cpf === c.cpf && l.criou);
    const lida = (await estado(c.id)).ultimaMensagemId === m.id;
    if (e3 && e3.t > tCorr) {
      // A chegada da etapa 3 na Facta é alguns ms depois do ponto sem volta. O que decide é
      // a ordem entre a correção e o ponto sem volta, e o alerta quando ela veio depois.
      const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
      const irr = op?.irreversivelEm?.getTime() ?? 0;
      const alerta = (await notas(c.id)).some((n) => /depois do ponto sem volta/.test(n));
      const ok = irr && irr <= tCorrFim && alerta;
      return { quebrou: !ok, detalhe: `correção ${e3.t - tCorr} ms antes da chegada da etapa 3; ponto sem volta ${tCorr - irr} ms antes do início da gravação da correção; alerta=${alerta}` };
    }
    return { quebrou: false, detalhe: e3 ? `correção chegou ${tCorr - e3.t} ms depois da etapa 3 (inevitável)` : "correção cancelou a tempo" };
  });
}
for (let i = 1; i <= 5; i++) {
  await cenario("R1 Correção durante o job", `correção em OUTRO processo durante a Facta, e depois novo "sim" (rodada ${i})`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa2-dados-pessoais": 1000 } });
    await cliente(c.id, "sim");
    const m = await msg(c.id, "espera, o CEP é 24030-000");
    const exec = worker({ acao: "executar", deslocamento: 31_000 });
    const ini = Date.now();
    while (!chamadasFacta(c.cpf, "etapa1") && Date.now() - ini < 15_000) await sleep(10);
    await worker({ acao: "processar", conversaId: c.id, mensagemId: m.id });
    await exec;
    const depois = await estado(c.id);
    const linkAntes = entregues(c.numero, /contrato foi feito/);
    // O cliente responde ao pedido de correção e confirma de novo.
    await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true } });
    await cliente(c.id, "sim");
    deslocamento = 70_000;
    await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
    const linkDepois = entregues(c.numero, /contrato foi feito/);
    if (criadas(c.cpf) === 1 && linkDepois > linkAntes)
      return { quebrou: true, detalhe: `proposta criada com o CEP antigo; depois da correção, o novo "sim" respondeu "contrato foi feito" com o link antigo (chave não muda com os dados). Etapa depois da correção: ${depois.etapa}` };
    return { quebrou: false, detalhe: `criadas=${criadas(c.cpf)} links=${linkDepois} etapa=${depois.etapa}` };
  });
}

// ===== R2: mensagens fora de ordem =====
for (const [corr, nome] of [["espera, o CEP está errado", "correção em texto"], ["não", "\"não\""], ["o número da casa é 200", "dado novo"]] as const) {
  await cenario("R2 Fora de ordem", `áudio "sim" mais lento que a ${nome} mandada depois`, async () => {
    const c = await conversa();
    const tWa = Date.now();
    // O áudio "sim" foi falado primeiro (horário do WhatsApp), mas gravado depois por baixar a mídia.
    const mCorr = await msg(c.id, corr, { timestamp: new Date(tWa) });
    await sleep(30);
    const mSim = await msg(c.id, "sim", { timestamp: new Date(tWa - 4000) });
    await svc.processarComMaisa(c.id, mCorr.id);
    await svc.processarComMaisa(c.id, mSim.id);
    deslocamento = 31_000;
    await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
    const eDbg = await estado(c.id);
    const rowsDbg = (await maisaRows(c.id)).map((x: any) => (x.conteudoTexto ?? "").slice(0, 50));
    if (process.env.DEPURAR) console.log("DEPURAR", eDbg.etapa, JSON.stringify(eDbg.confirmacaoPendente), rowsDbg, facta.log.filter((l) => l.cpf === c.cpf).map((l) => l.rota));
    if (criadas(c.cpf)) return { quebrou: true, detalhe: "a correção (mais nova no WhatsApp) foi lida antes do \"sim\" e a proposta saiu sem ela; a ordem usada é a de gravação, não a do WhatsApp" };
    return { quebrou: false, detalhe: "" };
  });
}

// ===== R3: vários processos executando a mesma confirmação =====
for (const n of [2, 3, 5, 8, 10, 10]) {
  await cenario("R3 Jobs concorrentes", `${n} processos executando a mesma confirmação`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa1-simulador": 200 } });
    await cliente(c.id, "sim");
    await Promise.all(Array.from({ length: n }, () => worker({ acao: "executar", deslocamento: 31_000 })));
    const feito = entregues(c.numero, /contrato foi feito/), conferindo = entregues(c.numero, /conferindo/);
    const prob = await invariantes(c);
    if (criadas(c.cpf) > 1) return { quebrou: true, detalhe: `${criadas(c.cpf)} propostas` };
    if (feito && conferindo) return { quebrou: true, detalhe: `cliente recebeu "contrato foi feito" e "estou conferindo" (${feito}/${conferindo}): mensagens contraditórias. ${prob.join("; ")}` };
    if (!feito && criadas(c.cpf)) return { quebrou: true, detalhe: `proposta criada e o cliente só recebeu "estou conferindo" (${conferindo}); ${prob.join("; ") || "equipe com nota"}` };
    return { quebrou: prob.length > 0, detalhe: `criadas=${criadas(c.cpf)} feito=${feito} conferindo=${conferindo} ${prob.join("; ")}` };
  });
}

// ===== R4: processo morto em momento aleatório =====
for (let i = 1; i <= 20; i++) {
  const ms = entre(0, 1400);
  await cenario("R4 Queda no job da digitação", `processo morto ${ms} ms depois da 1ª chamada à Facta`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa1-simulador": 250, "etapa2-dados-pessoais": 250, "etapa3-proposta-cadastro": 250, "envio-link": 250 } });
    evo.atraso = 200;
    await cliente(c.id, "sim");
    const w = await worker({ acao: "executar", deslocamento: 31_000 }, { depoisDe: () => chamadasFacta(c.cpf, "/proposta") > 0, ms });
    evo.atraso = 0;
    // Reinício: recuperação imediata e depois de 6 minutos.
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 40_000 });
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 7 * 60_000 });
    const prob = await invariantes(c);
    const cv = await conv(c.id);
    const informado = entregues(c.numero, /contrato foi feito|conferindo|especialista/) > 0 || !cv.comMaisa;
    if (!informado) prob.push("cliente e equipe sem saber do resultado");
    const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
    return { quebrou: prob.length > 0, detalhe: `${w.morto ? "morto" : "terminou antes"}; criadas=${criadas(c.cpf)} op=${op?.status ?? "nenhuma"} comMaisa=${cv.comMaisa} ${prob.join("; ")}` };
  });
}
for (let i = 1; i <= 20; i++) {
  const tipo = (["sim", "ok", "quero falar com um atendente", "obrigada"] as const)[i % 4];
  const ms = entre(0, 500);
  await cenario("R4 Queda ao responder", `processo morto ${ms} ms depois do 1º envio, mensagem "${tipo}"`, async () => {
    const c = await conversa(tipo === "ok" || tipo === "obrigada" ? { etapa: "cpf", tentativas: 0, produto: "siape" } : confirmacao());
    evo.atraso = 300;
    const m = await msg(c.id, tipo);
    const w = await worker({ acao: "processar", conversaId: c.id, mensagemId: m.id }, { depoisDe: () => evo.chamadas.some((x) => x.numero === c.numero), ms });
    evo.atraso = 0;
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 60_000 });
    const prob = await invariantes(c);
    return { quebrou: prob.length > 0, detalhe: `${w.morto ? "morto" : "terminou antes"}; ${prob.join("; ")}` };
  });
}

// ===== R5: idempotência na Facta =====
await cenario("R5 Idempotência", "mesmo cliente em dois números da Maisa confirma a mesma oferta nos dois", async () => {
  const cpf = cpfs[2990];
  const a = await conversa(confirmacao(), { cpf, numero: "5521977770001", instanciaId: instA.id });
  const b = await conversa(confirmacao(), { cpf, numero: "5521977770001", instanciaId: instB.id });
  await cliente(a.id, "sim"); await cliente(b.id, "sim");
  deslocamento = 31_000;
  await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  return criadas(cpf) > 1 ? { quebrou: true, detalhe: `${criadas(cpf)} propostas para o mesmo CPF e a mesma oferta: a chave é por conversa, não por cliente` } : { quebrou: false, detalhe: "" };
});
await cenario("R5 Idempotência", "conversa encerrada e cliente volta numa conversa nova com a mesma oferta", async () => {
  const cpf = cpfs[2991];
  const a = await conversa(confirmacao(), { cpf, numero: "5521977770002" });
  await cliente(a.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  await prisma.conversa.update({ where: { id: a.id }, data: { status: "encerrada" } });
  const b = await conversa(confirmacao(), { cpf, numero: "5521977770002" });
  await cliente(b.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  return criadas(cpf) > 1 ? { quebrou: true, detalhe: `${criadas(cpf)} propostas: nada impede a mesma oferta em outra conversa do mesmo CPF` } : { quebrou: false, detalhe: "" };
});
await cenario("R5 Idempotência", "equipe devolve para a Maisa, cliente corrige o CEP e confirma a mesma oferta", async () => {
  const c = await conversa();
  await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  const novos = { ...DADOS, cep: "24030000" };
  await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaVersao: { increment: 1 }, maisaEstado: confirmacao({ contrato: { dados: novos, pergunta: "" } }) as any } });
  const antes = facta.log.length;
  await cliente(c.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  const disse = entregues(c.numero, /contrato foi feito/);
  if (facta.log.length === antes && disse >= 2) return { quebrou: true, detalhe: "nenhuma chamada à Facta, mas o cliente ouviu \"contrato foi feito\" de novo, com o link da proposta antiga (CEP antigo)" };
  return { quebrou: false, detalhe: `chamadas novas=${facta.log.length - antes} avisos=${disse}` };
});
await cenario("R5 Idempotência", "Facta recusou (RG errado), equipe corrige e devolve: a nova tentativa legítima é bloqueada", async () => {
  const c = await conversa();
  facta.planos.set(c.cpf, { modo: { "etapa2-dados-pessoais": "erro" } });
  await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  facta.planos.delete(c.cpf);
  await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaVersao: { increment: 1 }, maisaEstado: confirmacao({ contrato: { dados: { ...DADOS, rg: "987654321" }, pergunta: "" } }) as any } });
  await cliente(c.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  return criadas(c.cpf) === 0 ? { quebrou: true, detalhe: "a operação \"falhou\" bloqueia para sempre a mesma oferta nesta conversa; a contratação legítima corrigida não acontece (vai para a equipe)" } : { quebrou: false, detalhe: "" };
});
await cenario("R5 Idempotência", "duas ofertas diferentes na mesma conversa (tabela 1 e tabela 2)", async () => {
  const c = await conversa();
  await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaVersao: { increment: 1 }, maisaEstado: confirmacao({ oferta: OFERTA(2) }) as any } });
  await cliente(c.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  return { quebrou: false, detalhe: `criadas=${criadas(c.cpf)} (oferta diferente gera chave nova: duas propostas são permitidas, decisão de negócio)` };
});
for (const [modo, esperado] of [["cria_e_lento", "desconhecida"], ["cria_e_500", "desconhecida"], ["queda", "desconhecida"], ["cria_e_erro", "desconhecida"], ["cria_e_html", "desconhecida"], ["408", "desconhecida"]] as const) {
  await cenario("R5 Idempotência", `etapa 3 ${modo}: Facta ${CRIA.has(modo as ModoFacta) ? "CRIOU" : "não criou"} a proposta`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { modo: { "etapa3-proposta-cadastro": modo as ModoFacta } });
    await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
    const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
    const criou = criadas(c.cpf) > 0;
    const nota = (await notas(c.id)).join(" ");
    if (criou && op?.status === "falhou")
      return { quebrou: true, detalhe: `a Facta criou a proposta, mas a operação ficou "falhou" e a nota diz que a Facta recusou antes de criar: a equipe pode digitar de novo. (${nota.slice(0, 120)})` };
    return { quebrou: op?.status !== esperado, detalhe: `operação ${op?.status}` };
  });
}
await cenario("R5 Idempotência", "10 processos ao mesmo tempo com a etapa 3 lenta", async () => {
  const c = await conversa();
  facta.planos.set(c.cpf, { atraso: { "etapa3-proposta-cadastro": 800 } });
  await cliente(c.id, "sim");
  await Promise.all(Array.from({ length: 10 }, () => worker({ acao: "executar", deslocamento: 31_000 })));
  return { quebrou: criadas(c.cpf) !== 1, detalhe: `criadas=${criadas(c.cpf)}` };
});

// ===== R6: WhatsApp =====
for (const modo of ["envia_e_502", "envia_e_503", "envia_e_504", "envia_e_429"] as const) {
  await cenario("R6 WhatsApp", `provedor ENVIA e devolve ${modo.slice(-3)}: o reenvio duplica?`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    evo.filas.set(c.numero, [modo, "ok"]);
    await cliente(c.id, "ok");
    const n = entregues(c.numero);
    return n > 1 ? { quebrou: true, detalhe: `o cliente recebeu ${n} cópias: ${modo.slice(-3)} foi tratado como "não enviada" sem prova` } : { quebrou: false, detalhe: "" };
  });
}
await cenario("R6 WhatsApp", "provedor envia e a resposta se perde (tempo esgotado)", async () => {
  const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
  evo.filas.set(c.numero, ["envia_e_lento"]);
  await cliente(c.id, "ok");
  const cv = await conv(c.id);
  return { quebrou: entregues(c.numero) > 1, detalhe: `cópias=${entregues(c.numero)}; conversa foi para a equipe=${!cv.comMaisa} (falso alarme: a mensagem chegou)` };
});
for (const ms of [100, 400, 900]) {
  await cenario("R6 WhatsApp", `Evolution fora do ar, processo cai na espera do reenvio (${ms} ms) e o envio sai uma vez quando volta`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    const m = await msg(c.id, "ok");
    await fecharEvolution();
    try {
      await worker({ acao: "processar", conversaId: c.id, mensagemId: m.id, esperaReenvioMs: 2000 }, { ms });
    } finally {
      await abrirEvolution();
    }
    await sleep(2100);
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 60_000 });
    const prob = await invariantes(c);
    const n = entregues(c.numero);
    if (n !== 1 && (await conv(c.id)).comMaisa) prob.push(`entregue ${n} vez(es) e a conversa ainda com a Maisa`);
    return { quebrou: prob.length > 0, detalhe: `entregas=${n} ${prob.join("; ")}` };
  });
}
await cenario("R6 WhatsApp", "Meta aceita e depois avisa pelo webhook que a entrega falhou", async () => {
  const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" }, { instanciaId: instMeta.id });
  const r = await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "Pode me mandar o seu CPF?", externalId: "wamid.TESTE1", statusEntrega: "enviado" } });
  const { app } = await imp("src/app.ts");
  const srv = http.createServer(app); const porta = await ouvir(srv);
  const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, statuses: [{ id: "wamid.TESTE1", status: "failed", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: c.numero, errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] });
  const assinatura = "sha256=" + createHmac("sha256", "segredo-meta").update(corpo).digest("hex");
  await fetch(`http://127.0.0.1:${porta}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinatura }, body: corpo });
  await fetch(`http://127.0.0.1:${porta}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinatura }, body: corpo });
  srv.close();
  const depois = await prisma.mensagem.findUniqueOrThrow({ where: { id: r.id } });
  const cv = await conv(c.id);
  if (depois.statusEntrega === "falhou" && cv.comMaisa) return { quebrou: true, detalhe: "a mensagem ficou \"falhou\" (webhook repetido sem efeito duplo), mas a Maisa continua esperando resposta: nada passa a conversa para a equipe" };
  return { quebrou: false, detalhe: `status=${depois.statusEntrega} comMaisa=${cv.comMaisa}` };
});
await cenario("R6 WhatsApp", "Evolution avisa entrega com erro (messages.update)", async () => {
  const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
  const r = await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "Pode me mandar o seu CPF?", externalId: "EVOTESTE1", statusEntrega: "enviado" } });
  const { app } = await imp("src/app.ts");
  const srv = http.createServer(app); const porta = await ouvir(srv);
  const corpo = { event: "messages.update", instance: "a", data: { keyId: "EVOTESTE1", remoteJid: `${c.numero}@s.whatsapp.net`, fromMe: true, status: "ERROR" } };
  await fetch(`http://127.0.0.1:${porta}/api/webhooks/evolution?token=tok`, { method: "POST", headers: { "Content-Type": "application/json", apikey: "tok" }, body: JSON.stringify(corpo) });
  srv.close();
  const depois = await prisma.mensagem.findUniqueOrThrow({ where: { id: r.id } });
  const cv2 = await conv(c.id);
  return { quebrou: depois.statusEntrega !== "falhou" || cv2.comMaisa, detalhe: `status=${depois.statusEntrega} comMaisa=${cv2.comMaisa}` };
});
for (const [erro, nome] of [[{ isAxiosError: true, response: { status: 504 } }, "504"], [{ isAxiosError: true, response: { status: 502 } }, "502"]] as const) {
  await cenario("R6 WhatsApp", `classificação de ${nome} sem proxy na frente da Evolution`, async () => {
    const c = classificarFalhaEnvio(erro);
    return { quebrou: c === "nao_enviada", detalhe: `${nome} vira "${c}"; em produção a Evolution é chamada direto (http://evolution-api), então ${nome} só vem da própria Evolution ou da Meta, que não documentam que nada foi enviado` };
  });
}

// ===== R7: persistência =====
for (const [nome, rota, quando] of [["antes da Facta", "gera-token", 0], ["durante a etapa 2", "etapa2", 150], ["depois da etapa 3, antes de gravar a operação", "envio-link", 50]] as const) {
  await cenario("R7 Persistência", `Postgres cai ${nome}`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa2-dados-pessoais": 400, "envio-link": 400 } });
    await cliente(c.id, "sim");
    const exec = worker({ acao: "executar", deslocamento: 31_000 });
    const ini = Date.now();
    while (!facta.log.some((l) => (l.cpf === c.cpf || rota === "gera-token") && l.rota.includes(rota) && l.t >= ini) && Date.now() - ini < 15_000) await sleep(5);
    await sleep(quando);
    await pg.stop();
    await sleep(1500);
    await pg.start();
    // O processo de teste também perdeu a conexão: reconecta para conferir o resultado.
    await prisma.$disconnect(); await prisma.$connect();
    await exec;
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 40_000 });
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 8 * 60_000 });
    const prob = await invariantes(c);
    const cv = await conv(c.id);
    const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
    if (cv.comMaisa && !entregues(c.numero, /contrato foi feito|conferindo|especialista/)) prob.push("ninguém sabe o resultado");
    return { quebrou: prob.length > 0, detalhe: `criadas=${criadas(c.cpf)} op=${op?.status ?? "nenhuma"} comMaisa=${cv.comMaisa} ${prob.join("; ")}` };
  });
}
for (let i = 1; i <= 4; i++) {
  await cenario("R7 Persistência", `"sim" e "espera" em dois processos ao mesmo tempo (rodada ${i})`, async () => {
    const c = await conversa();
    const m1 = await msg(c.id, "sim"); await sleep(5); const m2 = await msg(c.id, "espera, o CEP está errado");
    const ordem = i % 2 ? [m1, m2] : [m2, m1];
    await Promise.all(ordem.map((m) => worker({ acao: "processar", conversaId: c.id, mensagemId: m.id })));
    await worker({ acao: "executar", deslocamento: 31_000 });
    return { quebrou: criadas(c.cpf) > 0, detalhe: `criadas=${criadas(c.cpf)}` };
  });
}
for (let i = 1; i <= 3; i++) {
  await cenario("R7 Persistência", `mesma mensagem de consentimento CLT em dois processos: efeito externo duplicado? (rodada ${i})`, async () => {
    const c = await conversa({ etapa: "consentimento", tentativas: 0, produto: "clt", nome: "Maria da Silva" });
    const m = await msg(c.id, "sim");
    await Promise.all([worker({ acao: "processar", conversaId: c.id, mensagemId: m.id }), worker({ acao: "processar", conversaId: c.id, mensagemId: m.id })]);
    const n = chamadasFacta(c.cpf, "solicita-autorizacao");
    return n > 1 ? { quebrou: true, detalhe: `pedido de autorização mandado ${n} vezes à Facta (o cliente pode receber ${n} links): a versão do estado só barra a gravação, não o efeito externo` } : { quebrou: false, detalhe: `pedidos=${n}` };
  });
}
await cenario("R7 Persistência", "conversa finalizada mas ainda com a Maisa (queda entre gravar e passar para a equipe)", async () => {
  // O banco recusa o estado: finalizada com a Maisa não pode mais ser gravada por ninguém.
  let recusado = false;
  try {
    await conversa({ ...confirmacao(), etapa: "finalizada", saida: "humano", motivoTransferencia: "pediu atendente" });
  } catch {
    recusado = true;
  }
  return { quebrou: !recusado, detalhe: recusado ? "o CHECK do banco recusou o estado" : "o banco aceitou finalizada com a Maisa" };
});
await cenario("R7 Persistência", "operador devolve a conversa enquanto a Maisa processa", async () => {
  const c = await conversa();
  facta.planos.set(c.cpf, { atraso: { "etapa3-proposta-cadastro": 600 } });
  await cliente(c.id, "sim");
  deslocamento = 31_000;
  const exec = svc.executarDigitacoesPendentes();
  await sleep(300);
  await prisma.conversa.update({ where: { id: c.id }, data: { maisaEstado: undefined, maisaVersao: { increment: 1 } } });
  await exec; await svc.aguardarFilas();
  const prob = await invariantes(c);
  return { quebrou: prob.length > 0, detalhe: `criadas=${criadas(c.cpf)} propostas registradas=${await prisma.proposta.count({ where: { conversaId: c.id } })} ${prob.join("; ")}` };
});
await cenario("R7 Persistência", "conversa apagada leva junto o registro da operação na Facta", async () => {
  const c = await conversa();
  await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  let apagou = true;
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.saidaMaisa.deleteMany({ where: { conversaId: c.id } });
      await tx.mensagem.deleteMany({ where: { conversaId: c.id } });
      await tx.proposta.deleteMany({ where: { conversaId: c.id } });
      await tx.maisaEvento.deleteMany({ where: { conversaId: c.id } });
      await tx.funilEvento.deleteMany({ where: { conversaId: c.id } });
      await tx.conversa.delete({ where: { id: c.id } });
    });
  } catch {
    apagou = false;
  }
  const ops = await prisma.operacaoFacta.count({ where: { conversaId: c.id } });
  return ops === 0 ? { quebrou: true, detalhe: `apagou=${apagou}: o rastro da digitação sumiu com a conversa` } : { quebrou: false, detalhe: `apagar a conversa foi recusado (apagou=${apagou}), o rastro ficou` };
});
await cenario("R7 Persistência", "recuperação: conversa que já estava com a Maisa antes do deploy (sem marca de última lida)", async () => {
  const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" }, { semMarca: true });
  await msg(c.id, "20000000003", { createdAt: new Date(Date.now() - 60_000) });
  // O que a migração faz no deploy com as conversas que já existiam (B2).
  const sqlMigracao = (await import("node:fs")).readFileSync(path.join(BACKEND, "prisma/migrations/20261112200000_maisa_hardening/migration.sql"), "utf8");
  const preenche = sqlMigracao.slice(sqlMigracao.indexOf('UPDATE "conversas" c'), sqlMigracao.indexOf("-- Conversa finalizada pela Maisa"));
  for (const comando of preenche.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) await prisma.$executeRawUnsafe(comando);
  await svc.recuperarMensagensNaoLidas(); await svc.aguardarFilas();
  const n = (await maisaRows(c.id)).length;
  return n === 0 ? { quebrou: true, detalhe: "mensagem que chegou durante o próprio deploy fica sem resposta: a recuperação exige a marca de última lida, que as conversas antigas não têm" } : { quebrou: false, detalhe: "" };
});

// ===== R8: migração e rollback, em bancos descartáveis =====
const migracoes = path.join(BACKEND, "prisma/migrations");
const nova = "20261112200000_maisa_hardening";
const comEnv = (db: string) => ({ ...process.env, DATABASE_URL: url(db) });
const psql = async (db: string, sql: string) => {
  const { default: pgmod } = await import(pathToFileURL(path.join(BACKEND, "testes-operacao/node_modules/pg/lib/index.js")).href);
  const cli = new pgmod.Client({ connectionString: `postgresql://t:t@127.0.0.1:${PORTA_PG}/${db}` });
  await cli.connect();
  try { return (await cli.query(sql)).rows; } finally { await cli.end(); }
};
// Banco "antigo": todas as migrações menos a nova, aplicadas com uma pasta temporária.
const pastaAntiga = mkdtempSync(path.join(tmpdir(), "mig-antigas-"));
execSync(`xcopy /E /I /Q "${migracoes.replace(/\//g, "\\")}" "${path.join(pastaAntiga, "migrations")}"`, { stdio: "pipe" });
rmSync(path.join(pastaAntiga, "migrations", nova), { recursive: true, force: true });
const schemaAntigo = execSync("git show 02e82a3:backend/prisma/schema.prisma", { cwd: BACKEND }).toString();
writeFileSync(path.join(pastaAntiga, "schema.prisma"), schemaAntigo.replace(/generator client \{[\s\S]*?\}/, `generator client {\n  provider = "prisma-client-js"\n  output   = "${path.join(BACKEND, "testes-operacao/node_modules/.prisma-antigo").replace(/\\/g, "/")}"\n}`));
const deployAntigo = (db: string) => execSync(`npx prisma migrate deploy --schema "${path.join(pastaAntiga, "schema.prisma")}"`, { cwd: BACKEND, env: comEnv(db), stdio: "pipe" });
const deployNovo = (db: string) => execSync("npx prisma migrate deploy", { cwd: BACKEND, env: comEnv(db), stdio: "pipe" });
execSync(`npx prisma generate --schema "${path.join(pastaAntiga, "schema.prisma")}"`, { cwd: BACKEND, stdio: "pipe" });
const { PrismaClient: ClienteAntigo } = await import(pathToFileURL(path.join(BACKEND, "testes-operacao/node_modules/.prisma-antigo/index.js")).href);

await cenario("R8 Migração", "banco antigo com dados recebe a migração sem perder nada", async () => {
  deployAntigo("mig_a");
  const antigo = new ClienteAntigo({ datasourceUrl: url("mig_a") });
  const i = await antigo.instancia.create({ data: { nome: "x", numero: "1", tipoConexao: "evolution" } });
  const ct = await antigo.contato.create({ data: { numeroWhatsapp: "2" } });
  const cv = await antigo.conversa.create({ data: { instanciaId: i.id, contatoId: ct.id, maisaEstado: { etapa: "cpf", tentativas: 0 } } });
  await antigo.mensagem.create({ data: { conversaId: cv.id, remetenteTipo: "cliente", conteudoTexto: "oi" } });
  await antigo.$disconnect();
  deployNovo("mig_a");
  const r = await psql("mig_a", `select (select count(*) from conversas)::int c, (select count(*) from mensagens)::int m, (select maisa_versao from conversas limit 1) v, (select tentativas_entrega from mensagens limit 1) t`);
  return { quebrou: !(r[0].c === 1 && r[0].m === 1 && r[0].v === 0 && r[0].t === 0), detalhe: JSON.stringify(r[0]) };
});
// Rollback completo, como documentado no relatório.
const ROLLBACK_SQL = `ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_finalizada_fora_da_maisa; DROP TABLE saidas_maisa; DROP TABLE operacoes_facta; ALTER TABLE conversas DROP COLUMN maisa_versao, DROP COLUMN maisa_lease_ate, DROP COLUMN maisa_lease_dono; ALTER TABLE mensagens DROP COLUMN tentativas_entrega;`;
await cenario("R8 Migração", "código antigo (rollback) funcionando no banco já migrado", async () => {
  const antigo = new ClienteAntigo({ datasourceUrl: url("mig_a") });
  const cv = await antigo.conversa.findFirstOrThrow();
  await antigo.conversa.update({ where: { id: cv.id }, data: { maisaEstado: { etapa: "nascimento", tentativas: 0 } } });
  await antigo.mensagem.create({ data: { conversaId: cv.id, remetenteTipo: "maisa", conteudoTexto: "x" } });
  const ct = await antigo.contato.create({ data: { numeroWhatsapp: "3" } });
  await antigo.conversa.create({ data: { instanciaId: cv.instanciaId, contatoId: ct.id } });
  await antigo.$disconnect();
  return { quebrou: false, detalhe: "leitura, gravação e criação ok com as colunas novas presentes" };
});
await cenario("R8 Migração", "código novo com banco SEM a migração", async () => {
  deployAntigo("mig_b");
  const novo = new (await import(pathToFileURL(path.join(BACKEND, "node_modules/@prisma/client/default.js")).href)).PrismaClient({ datasourceUrl: url("mig_b") });
  let erro = "";
  try { await novo.conversa.findFirst(); } catch (e) { erro = e instanceof Error ? e.message.split("\n").slice(-2).join(" ").slice(0, 160) : String(e); }
  await novo.$disconnect();
  return { quebrou: false, detalhe: `falha imediata e explícita (${erro || "sem erro?"}); o Dockerfile roda migrate deploy antes de subir, então o backend não sobe sem a migração` };
});
await cenario("R8 Migração", "falha no meio da migração (objeto já existe) e recuperação", async () => {
  deployAntigo("mig_c");
  await psql("mig_c", `CREATE TABLE "saidas_maisa" ("x" int)`);
  let falhou = false;
  try { deployNovo("mig_c"); } catch { falhou = true; }
  const parcial = await psql("mig_c", `select exists(select 1 from information_schema.columns where table_name='conversas' and column_name='maisa_versao') coluna, exists(select 1 from information_schema.tables where table_name='operacoes_facta') tabela, (select count(*)::int from _prisma_migrations where migration_name='${nova}' and finished_at is null) pendente`);
  // Recuperação documentada: desfazer o parcial, marcar como revertida e aplicar de novo.
  await psql("mig_c", `DROP TABLE IF EXISTS "saidas_maisa"; ALTER TABLE conversas DROP COLUMN IF EXISTS maisa_versao; ALTER TABLE mensagens DROP COLUMN IF EXISTS tentativas_entrega; DROP TABLE IF EXISTS operacoes_facta;`);
  execSync(`npx prisma migrate resolve --rolled-back ${nova}`, { cwd: BACKEND, env: comEnv("mig_c"), stdio: "pipe" });
  deployNovo("mig_c");
  const fim = await psql("mig_c", `select exists(select 1 from information_schema.tables where table_name='operacoes_facta') tabela`);
  return { quebrou: !falhou || !fim[0].tabela, detalhe: `falhou=${falhou}; estado parcial: coluna=${parcial[0].coluna} tabela=${parcial[0].tabela} migração pendente=${parcial[0].pendente}; depois da recuperação tabela=${fim[0].tabela}` };
});
await cenario("R8 Migração", "rollback completo (DROP) numa cópia, código antigo e nova subida", async () => {
  deployAntigo("mig_d"); deployNovo("mig_d");
  await psql("mig_d", ROLLBACK_SQL + ` DELETE FROM _prisma_migrations WHERE migration_name='${nova}';`);
  const antigo = new ClienteAntigo({ datasourceUrl: url("mig_d") });
  const i = await antigo.instancia.create({ data: { nome: "x", numero: "9", tipoConexao: "evolution" } });
  await antigo.$disconnect();
  deployNovo("mig_d");
  const r = await psql("mig_d", `select exists(select 1 from information_schema.tables where table_name='operacoes_facta') t`);
  return { quebrou: !r[0].t || !i.id, detalhe: "drop, código antigo e reaplicação ok" };
});
await cenario("R8 Migração", "schema.prisma bate com as migrações", async () => {
  const out = execSync(`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${url("sombra")}" --exit-code`, { cwd: BACKEND, env: process.env, stdio: "pipe" }).toString();
  return { quebrou: false, detalhe: out.trim().slice(0, 80) || "sem diferença" };
});
await cenario("R8 Migração", "rollback do código: a trava externa ao código (conferirTravas) barra o .env inseguro", async () => {
  const roda = (extra: Record<string, string>) => {
    try {
      execSync("npx tsx src/scripts/conferirTravas.ts", { cwd: BACKEND, env: { ...process.env, ...extra }, stdio: "pipe" });
      return 0;
    } catch (e: any) {
      return e.status ?? 1;
    }
  };
  const inseguro = roda({ MAISA_DIGITA_PROPOSTA: "true", FACTA_LOGIN_CERTIFICADO: "c", MAISA_DIGITACAO_LIBERADA: "false" });
  const seguro1 = roda({ MAISA_DIGITA_PROPOSTA: "false", FACTA_LOGIN_CERTIFICADO: "c", MAISA_DIGITACAO_LIBERADA: "false" });
  const seguro2 = roda({ MAISA_DIGITA_PROPOSTA: "true", FACTA_LOGIN_CERTIFICADO: "", MAISA_DIGITACAO_LIBERADA: "false" });
  return { quebrou: !(inseguro !== 0 && seguro1 === 0 && seguro2 === 0), detalhe: `inseguro=${inseguro} seguro(sem digitação)=${seguro1} seguro(sem certificado)=${seguro2}` };
});
await cenario("R8 Migração", "código antigo grava 'finalizada' antes de tirar da Maisa: o CHECK precisa sair no rollback", async () => {
  deployAntigo("mig_e"); deployNovo("mig_e");
  const antigo = new ClienteAntigo({ datasourceUrl: url("mig_e") });
  const i = await antigo.instancia.create({ data: { nome: "x", numero: "77", tipoConexao: "evolution" } });
  const ct = await antigo.contato.create({ data: { numeroWhatsapp: "78" } });
  const cv = await antigo.conversa.create({ data: { instanciaId: i.id, contatoId: ct.id, comMaisa: true, maisaEstado: { etapa: "oferta", tentativas: 0 } } });
  let semRemover = "aceitou";
  try { await antigo.conversa.update({ where: { id: cv.id }, data: { maisaEstado: { etapa: "finalizada", tentativas: 0 } } }); } catch { semRemover = "recusou"; }
  await psql("mig_e", "ALTER TABLE conversas DROP CONSTRAINT conversas_finalizada_fora_da_maisa");
  let comRemover = "aceitou";
  try { await antigo.conversa.update({ where: { id: cv.id }, data: { maisaEstado: { etapa: "finalizada", tentativas: 0 } } }); } catch { comRemover = "recusou"; }
  await antigo.$disconnect();
  return { quebrou: !(semRemover === "recusou" && comRemover === "aceitou"), detalhe: `sem tirar o CHECK o banco ${semRemover} a gravação do código antigo; depois de tirar, ${comRemover}. Passo obrigatório no rollback.` };
});
await cenario("R8 Migração", "migração preenche a marca de última lida das conversas existentes (B2) e tira finalizadas da Maisa", async () => {
  deployAntigo("mig_f");
  const antigo = new ClienteAntigo({ datasourceUrl: url("mig_f") });
  const i = await antigo.instancia.create({ data: { nome: "x", numero: "88", tipoConexao: "evolution" } });
  const ct = await antigo.contato.create({ data: { numeroWhatsapp: "89" } });
  const a = await antigo.conversa.create({ data: { instanciaId: i.id, contatoId: ct.id, comMaisa: true, maisaEstado: { etapa: "cpf", tentativas: 0 } } });
  const ct2 = await antigo.contato.create({ data: { numeroWhatsapp: "90" } });
  const b = await antigo.conversa.create({ data: { instanciaId: i.id, contatoId: ct2.id, comMaisa: true, maisaEstado: { etapa: "finalizada", tentativas: 0 } } });
  // a: "oi" respondido e depois "ok" sem resposta (chegou durante o deploy).
  const m = await antigo.mensagem.create({ data: { conversaId: a.id, remetenteTipo: "cliente", conteudoTexto: "oi", createdAt: new Date(Date.now() - 60_000) } });
  await antigo.mensagem.create({ data: { conversaId: a.id, remetenteTipo: "maisa", conteudoTexto: "Oi!", createdAt: new Date(Date.now() - 50_000) } });
  await antigo.mensagem.create({ data: { conversaId: a.id, remetenteTipo: "cliente", conteudoTexto: "ok", createdAt: new Date(Date.now() - 40_000) } });
  // c: só uma mensagem do cliente, nunca respondida.
  const ct3 = await antigo.contato.create({ data: { numeroWhatsapp: "91" } });
  const d = await antigo.conversa.create({ data: { instanciaId: i.id, contatoId: ct3.id, comMaisa: true, maisaEstado: { etapa: "convenio", tentativas: 0 } } });
  await antigo.mensagem.create({ data: { conversaId: d.id, remetenteTipo: "cliente", conteudoTexto: "oi" } });
  await antigo.$disconnect();
  deployNovo("mig_f");
  const r = await psql("mig_f", `select maisa_estado->>'ultimaMensagemId' marca, (select com_maisa from conversas where id='${b.id}') fin, (select maisa_estado->>'ultimaMensagemId' from conversas where id='${d.id}') marca_d, (select maisa_estado->>'ultimaMensagemEm' from conversas where id='${d.id}') em_d from conversas where id='${a.id}'`);
  const ok = r[0].marca === m.id && r[0].fin === false && r[0].marca_d === null && r[0].em_d !== null;
  return { quebrou: !ok, detalhe: `marca na mensagem respondida=${r[0].marca === m.id}; sem resposta fica na criação=${r[0].marca_d === null && r[0].em_d !== null}; finalizada saiu da Maisa=${r[0].fin === false}` };
});
await cenario("R8 Migração", "o banco recusa situação de operação inválida e liberação sem motivo", async () => {
  const c = await conversa();
  let invalida = false, semMotivo = false;
  try { await prisma.operacaoFacta.create({ data: { conversaId: c.id, cpf: c.cpf, chave: `x${Date.now()}`, tipo: "novo", versaoDados: "v", status: "enviando" } }); } catch { invalida = true; }
  try { await prisma.operacaoFacta.create({ data: { conversaId: c.id, cpf: c.cpf, chave: `y${Date.now()}`, tipo: "novo", versaoDados: "v", status: "liberada" } }); } catch { semMotivo = true; }
  return { quebrou: !(invalida && semMotivo), detalhe: `status inválido recusado=${invalida}; liberação sem motivo recusada=${semMotivo}` };
});

// =====================================================================================
// FASE 6.1: 161 cenários novos (grupos N). Mesmos serviços simulados, Postgres real,
// processos reais e quedas em momentos sorteados.
// =====================================================================================
const { registrarSaidas } = await imp("src/modules/maisa/saidaMaisa.ts");
const { liberarOperacao } = await imp("src/modules/maisa/operacaoFacta.ts");
const notaPontoSemVolta = async (id: string) => (await notas(id)).some((n) => /depois do ponto sem volta/.test(n));
// Proposta criada com uma correção gravada antes do ponto sem volta: quebra. Correção depois
// do ponto sem volta: precisa de alerta para a equipe.
async function conferirPontoSemVolta(c: { id: string; cpf: string }, tGravada: number) {
  const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id }, orderBy: { createdAt: "desc" } });
  const criou = criadas(c.cpf) > 0;
  if (!criou) return { quebrou: false, detalhe: `nada criado (operação ${op?.status ?? "nenhuma"})` };
  const irr = op?.irreversivelEm?.getTime() ?? 0;
  if (irr > tGravada) return { quebrou: true, detalhe: `correção gravada ${irr - tGravada} ms ANTES do ponto sem volta e a proposta saiu` };
  if (!(await notaPontoSemVolta(c.id))) return { quebrou: true, detalhe: "correção depois do ponto sem volta sem alerta para a equipe" };
  return { quebrou: false, detalhe: `correção ${tGravada - irr} ms depois do ponto sem volta, com alerta` };
}
const CORRECOES: [string | null, string | undefined][] = [["espera, o CEP está errado", undefined], ["não", undefined], [null, "audio/ogg"], ["o número da casa é 200", undefined]];

// N1: correção em momento sorteado durante a digitação, mesmo processo (40)
for (let i = 1; i <= 40; i++) {
  const d = entre(0, 900), e1 = entre(0, 400), e2 = entre(0, 400);
  const [texto, midia] = CORRECOES[i % 4];
  await cenario("N1 Ponto sem volta, mesmo processo", `${texto ?? "áudio"} ${d} ms após o job (etapas 1/2: ${e1}/${e2} ms)`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa1-simulador": e1, "etapa2-dados-pessoais": e2, "etapa3-proposta-cadastro": 100 } });
    await cliente(c.id, "sim");
    deslocamento = 31_000;
    const exec = svc.executarDigitacoesPendentes();
    await sleep(d);
    const m = await msg(c.id, texto, midia ? { tipoMidia: midia } : {});
    const tGravada = Date.now();
    const proc = svc.processarComMaisa(c.id, m.id);
    await exec; await proc; await svc.aguardarFilas();
    const r = await conferirPontoSemVolta(c, tGravada);
    const prob = await invariantes(c);
    return { quebrou: r.quebrou || prob.length > 0, detalhe: `${r.detalhe} ${prob.join("; ")}` };
  });
}

// N2: correção gravada por outro processo durante a digitação (20)
for (let i = 1; i <= 20; i++) {
  const d = entre(0, 700);
  const [texto, midia] = CORRECOES[i % 4];
  await cenario("N2 Ponto sem volta, processos diferentes", `${texto ?? "áudio"} ${d} ms após a etapa 1 (outro processo)`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa1-simulador": 300, "etapa2-dados-pessoais": 300 } });
    await cliente(c.id, "sim");
    const exec = worker({ acao: "executar", deslocamento: 31_000 });
    const ini = Date.now();
    while (!chamadasFacta(c.cpf, "etapa1") && Date.now() - ini < 15_000) await sleep(5);
    await sleep(d);
    const m = await msg(c.id, texto, midia ? { tipoMidia: midia } : {});
    const tGravada = Date.now();
    await worker({ acao: "processar", conversaId: c.id, mensagemId: m.id });
    await exec;
    const r = await conferirPontoSemVolta(c, tGravada);
    const prob = await invariantes(c);
    return { quebrou: r.quebrou || prob.length > 0, detalhe: `${r.detalhe} ${prob.join("; ")}` };
  });
}

// N3: ordem do WhatsApp, horários iguais, inválidos, áudio atrasado, mensagens neutras (24)
type Ordem = { nome: string; passos: (c: { id: string }) => Promise<void>; proposta: boolean };
const T = () => Math.floor(Date.now() / 1000) * 1000;
const processarNaOrdem = async (c: { id: string }, ms: any[]) => { for (const m of ms) await svc.processarComMaisa(c.id, m.id); await svc.aguardarFilas(); };
const ORDENS: Ordem[] = [
  { nome: "texto de correção (WhatsApp depois) lido antes do sim", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "espera, o CEP está errado", { timestamp: new Date(t) }); const b = await msg(c.id, "sim", { timestamp: new Date(t - 4000) }); await processarNaOrdem(c, [a, b]); } },
  { nome: "áudio de correção (WhatsApp depois) lido antes do sim", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, null, { timestamp: new Date(t), tipoMidia: "audio/ogg" }); const b = await msg(c.id, "sim", { timestamp: new Date(t - 4000) }); await processarNaOrdem(c, [a, b]); } },
  { nome: "\"não\" no mesmo segundo do sim, lido antes", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "não", { timestamp: new Date(t) }); const b = await msg(c.id, "sim", { timestamp: new Date(t) }); await processarNaOrdem(c, [a, b]); } },
  { nome: "correção no mesmo segundo do sim, lida depois", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "sim", { timestamp: new Date(t) }); const b = await msg(c.id, "o número da casa é 200", { timestamp: new Date(t) }); await processarNaOrdem(c, [a, b]); } },
  { nome: "correção com horário inválido (futuro), recebida depois do sim", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "sim", { timestamp: new Date(t) }); await svc.processarComMaisa(c.id, a.id); const b = await msg(c.id, "espera", { timestamp: new Date(t + 86_400_000) }); await processarNaOrdem(c, [b]); } },
  { nome: "correção com horário muito antigo, recebida depois do sim", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "sim", { timestamp: new Date(t) }); await svc.processarComMaisa(c.id, a.id); const b = await msg(c.id, "espera", { timestamp: new Date(t - 10 * 86_400_000) }); await processarNaOrdem(c, [b]); } },
  { nome: "áudio mandado antes do sim mas recebido depois (cancela por segurança)", proposta: false, passos: async (c) => { const t = T(); const a = await msg(c.id, "sim", { timestamp: new Date(t) }); await svc.processarComMaisa(c.id, a.id); const b = await msg(c.id, null, { timestamp: new Date(t - 5000), tipoMidia: "audio/ogg" }); await processarNaOrdem(c, [b]); } },
  { nome: "\"obrigado\" depois do sim mantém", proposta: true, passos: async (c) => { const a = await msg(c.id, "sim"); const b = await msg(c.id, "obrigado"); await processarNaOrdem(c, [a, b]); } },
  { nome: "\"👍\" depois do sim mantém", proposta: true, passos: async (c) => { const a = await msg(c.id, "sim"); const b = await msg(c.id, "👍"); await processarNaOrdem(c, [a, b]); } },
  { nome: "\"sim\" repetido no mesmo segundo", proposta: true, passos: async (c) => { const t = T(); const a = await msg(c.id, "sim", { timestamp: new Date(t) }); const b = await msg(c.id, "sim", { timestamp: new Date(t) }); await processarNaOrdem(c, [a, b]); } },
  { nome: "\"sim\" e depois \"sim, pode fazer\"", proposta: true, passos: async (c) => { const a = await msg(c.id, "sim"); const b = await msg(c.id, "sim, pode fazer"); await processarNaOrdem(c, [a, b]); } },
  { nome: "\"espera\", depois \"sim\" (ordem normal)", proposta: true, passos: async (c) => { const t = T(); const a = await msg(c.id, "espera", { timestamp: new Date(t - 3000) }); const b = await msg(c.id, "sim", { timestamp: new Date(t) }); await processarNaOrdem(c, [a, b]); } },
];
for (const rodada of [1, 2]) {
  for (const o of ORDENS) {
    await cenario("N3 Ordem das mensagens", `${o.nome} (rodada ${rodada})`, async () => {
      const c = await conversa();
      await o.passos(c);
      deslocamento = 31_000;
      await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
      const n = criadas(c.cpf);
      const prob = await invariantes(c);
      const ok = o.proposta ? n === 1 : n === 0;
      return { quebrou: !ok || prob.length > 0, detalhe: `propostas=${n} (esperado ${o.proposta ? 1 : 0}) ${prob.join("; ")}` };
    });
  }
}

// N4: mesmo CPF em números e conversas diferentes, liberação registrada (12)
for (let i = 1; i <= 3; i++) {
  await cenario("N4 Mesmo CPF", `duas conversas do mesmo CPF confirmam ao mesmo tempo em processos diferentes (rodada ${i})`, async () => {
    const cpf = cpfs[2960 + i];
    const a = await conversa(confirmacao(), { cpf, numero: `55219766${i}0001`, instanciaId: instA.id });
    const b = await conversa(confirmacao({ contrato: { dados: { ...DADOS, cep: "24030000" }, pergunta: "" } }), { cpf, numero: `55219766${i}0002`, instanciaId: instB.id });
    await cliente(a.id, "sim"); await cliente(b.id, "sim");
    await Promise.all([worker({ acao: "executar", deslocamento: 31_000 }), worker({ acao: "executar", deslocamento: 31_000 })]);
    return { quebrou: criadas(cpf) > 1, detalhe: `propostas para o CPF=${criadas(cpf)}` };
  });
}
async function sequencia(nome: string, anterior: (c: { id: string; cpf: string }) => Promise<void>, esperado: number) {
  await cenario("N4 Mesmo CPF", nome, async () => {
    const cpf = cpfs[2970 + (seq % 20)];
    const a = await conversa(confirmacao(), { cpf, numero: `5521976${String(seq).padStart(6, "0")}` });
    await anterior({ id: a.id, cpf });
    const b = await conversa(confirmacao({ contrato: { dados: { ...DADOS, email: `novo${seq}@exemplo.com` }, pergunta: "" } }), { cpf, numero: `5521977${String(seq).padStart(6, "0")}` });
    const antes = criadas(cpf);
    await cliente(b.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
    const n = criadas(cpf) - antes;
    const disse = entregues((await prisma.contato.findFirstOrThrow({ where: { conversas: { some: { id: b.id } } } })).numeroWhatsapp, /contrato foi feito/);
    return { quebrou: n !== esperado || (esperado === 0 && disse > 0), detalhe: `novas propostas=${n} (esperado ${esperado}); "contrato feito" na segunda=${disse}` };
  });
}
const digitarA = async (c: { id: string }, modo?: Record<string, ModoFacta>, cpf?: string) => {
  if (modo && cpf) facta.planos.set(cpf, { modo });
  await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  if (cpf) facta.planos.delete(cpf);
};
await sequencia("primeira concluída: segunda conversa bloqueada", (c) => digitarA(c), 0);
await sequencia("primeira incerta: segunda bloqueada", (c) => digitarA(c, { "etapa3-proposta-cadastro": "500" }, c.cpf), 0);
await sequencia("primeira falhou antes da etapa 3: segunda permitida", (c) => digitarA(c, { "etapa2-dados-pessoais": "erro" }, c.cpf), 1);
await sequencia("primeira invalidada pelo cliente: segunda permitida", async (c) => {
  await cliente(c.id, "sim");
  await prisma.operacaoFacta.create({ data: { conversaId: c.id, cpf: c.cpf, chave: `inv${c.id}`, tipo: "novo", versaoDados: "v", status: "invalidada" } });
}, 1);
await sequencia("primeira concluída há 31 dias: segunda permitida", async (c) => {
  await digitarA(c);
  await prisma.$executeRawUnsafe(`update operacoes_facta set updated_at = now() - interval '31 days' where conversa_id = '${c.id}'`);
}, 1);
await sequencia("primeira incerta e liberada pela equipe com motivo: segunda permitida", async (c) => {
  await digitarA(c, { "etapa3-proposta-cadastro": "500" }, c.cpf);
  const op = await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } });
  await liberarOperacao(op.id, "admin-teste", "conferi no portal: proposta não existe");
}, 1);
await cenario("N4 Mesmo CPF", "liberação sem motivo é recusada", async () => {
  const c = await conversa();
  await digitarA(c, { "etapa3-proposta-cadastro": "500" }, c.cpf);
  const op = await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } });
  let recusou = false;
  try { await liberarOperacao(op.id, "admin-teste", " "); } catch { recusou = true; }
  return { quebrou: !recusou, detalhe: `recusada=${recusou}` };
});
await cenario("N4 Mesmo CPF", "operação em andamento não pode ser liberada", async () => {
  const c = await conversa();
  const op = await prisma.operacaoFacta.create({ data: { conversaId: c.id, cpf: c.cpf, chave: `and${c.id}`, tipo: "novo", versaoDados: "v", status: "irreversivel" } });
  let recusou = false;
  try { await liberarOperacao(op.id, "admin-teste", "tentando liberar no meio"); } catch { recusou = true; }
  return { quebrou: !recusou, detalhe: `recusada=${recusou}` };
});
await cenario("N4 Mesmo CPF", "mesmos dados e mesma oferta confirmados de novo na mesma conversa: não diz contrato feito de novo", async () => {
  const c = await conversa();
  await digitarA(c);
  await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaVersao: { increment: 1 }, maisaEstado: confirmacao() as any } });
  await cliente(c.id, "sim"); deslocamento = 62_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
  return { quebrou: criadas(c.cpf) !== 1 || entregues(c.numero, /contrato foi feito/) !== 1, detalhe: `propostas=${criadas(c.cpf)} avisos=${entregues(c.numero, /contrato foi feito/)}` };
});

// N5: webhooks repetidos e status fora de ordem, pela rota real (12)
const { app } = await imp("src/app.ts");
const srvApp = http.createServer(app);
const portaApp = await ouvir(srvApp);
const postarEvolution = (corpo: unknown) => fetch(`http://127.0.0.1:${portaApp}/api/webhooks/evolution?token=tok`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const postarMeta = (corpo: unknown) => {
  const t = JSON.stringify(corpo);
  return fetch(`http://127.0.0.1:${portaApp}/api/webhooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + createHmac("sha256", "segredo-meta").update(t).digest("hex") }, body: t });
};
for (const [n, juntos] of [[2, true], [3, true], [5, true], [2, false]] as const) {
  await cenario("N5 Webhooks", `mensagem do cliente entregue ${n} vezes ${juntos ? "ao mesmo tempo" : "em sequência"}`, async () => {
    const numero = `5521955${String(seq++).padStart(6, "0")}`;
    const corpo = { event: "messages.upsert", instance: "a", data: { key: { id: `WA${numero}`, remoteJid: `${numero}@s.whatsapp.net`, fromMe: false }, message: { conversation: "oi" }, messageTimestamp: Math.floor(Date.now() / 1000) } };
    if (juntos) await Promise.all(Array.from({ length: n }, () => postarEvolution(corpo)));
    else for (let i = 0; i < n; i++) await postarEvolution(corpo);
    await sleep(300); await svc.aguardarFilas();
    const ct = await prisma.contato.findUnique({ where: { numeroWhatsapp: numero } });
    const ms = ct ? await prisma.mensagem.count({ where: { conversa: { contatoId: ct.id }, remetenteTipo: "cliente" } }) : 0;
    const rs = ct ? await prisma.mensagem.count({ where: { conversa: { contatoId: ct.id }, remetenteTipo: "maisa" } }) : 0;
    const respostasPrimeira = 2;
    return { quebrou: ms !== 1 || rs > respostasPrimeira, detalhe: `mensagens do cliente=${ms}, respostas=${rs}` };
  });
}
async function mensagemMaisaEnviada(c: { id: string }, externo: string, status: "enviado" | "incerto" = "enviado") {
  const m = await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "Pode me mandar o seu CPF?", externalId: externo, statusEntrega: "enviado" } });
  await prisma.saidaMaisa.create({ data: { conversaId: c.id, mensagemId: m.id, ordem: BigInt(Date.now()) * 1000n, status, proximaEm: new Date() } });
  return m;
}
for (const vezes of [2, 3]) {
  await cenario("N5 Webhooks", `Meta avisa a mesma falha ${vezes} vezes: uma nota, conversa com a equipe`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" }, { instanciaId: instMeta.id });
    await mensagemMaisaEnviada(c, `wamid.N5${c.id}`);
    const corpo = { object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, statuses: [{ id: `wamid.N5${c.id}`, status: "failed", timestamp: "1", recipient_id: c.numero, errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] };
    for (let i = 0; i < vezes; i++) await postarMeta(corpo);
    const ns = (await notas(c.id)).filter((n) => /não conseguiu entregar/.test(n)).length;
    return { quebrou: ns !== 1 || (await conv(c.id)).comMaisa, detalhe: `notas=${ns} comMaisa=${(await conv(c.id)).comMaisa}` };
  });
}
for (const vezes of [2, 3]) {
  await cenario("N5 Webhooks", `Evolution avisa o mesmo erro de entrega ${vezes} vezes: uma nota`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    await mensagemMaisaEnviada(c, `EVO-N5${c.id}`);
    for (let i = 0; i < vezes; i++) await postarEvolution({ event: "messages.update", instance: "a", data: { keyId: `EVO-N5${c.id}`, status: "ERROR" } });
    const ns = (await notas(c.id)).filter((n) => /não conseguiu entregar/.test(n)).length;
    return { quebrou: ns !== 1 || (await conv(c.id)).comMaisa, detalhe: `notas=${ns}` };
  });
}
for (const [prov, nome] of [["evolution", "Evolution"], ["meta", "Meta"]] as const) {
  await cenario("N5 Webhooks", `${nome} confirma a entrega de uma mensagem incerta: a equipe é avisada que chegou`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" }, prov === "meta" ? { instanciaId: instMeta.id } : {});
    await mensagemMaisaEnviada(c, `OK-${c.id}`, "incerto");
    if (prov === "evolution") await postarEvolution({ event: "messages.update", instance: "a", data: { keyId: `OK-${c.id}`, status: "DELIVERY_ACK" } });
    else await postarMeta({ object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, statuses: [{ id: `OK-${c.id}`, status: "delivered", timestamp: "1", recipient_id: c.numero }] } }] }] });
    const ok = (await notas(c.id)).some((n) => /chegou ao cliente/.test(n));
    return { quebrou: !ok, detalhe: `nota de confirmação=${ok}` };
  });
}
for (const status of ["DESCONHECIDO", 99]) {
  await cenario("N5 Webhooks", `status de entrega desconhecido (${status}) é ignorado sem efeito`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    const m = await mensagemMaisaEnviada(c, `X-${c.id}`);
    const r = await postarEvolution({ event: "messages.update", instance: "a", data: { keyId: `X-${c.id}`, status } });
    const depois = await prisma.mensagem.findUniqueOrThrow({ where: { id: m.id } });
    return { quebrou: r.status !== 200 || depois.statusEntrega !== "enviado" || !(await conv(c.id)).comMaisa, detalhe: `http=${r.status} status=${depois.statusEntrega}` };
  });
}

// N6: vários despachantes ao mesmo tempo (12)
for (const [k, mPor, w] of [[1, 5, 2], [1, 5, 5], [3, 3, 2], [3, 3, 4], [5, 2, 3], [5, 4, 6], [2, 8, 3], [8, 1, 4], [4, 4, 8], [6, 3, 2], [2, 2, 10], [10, 2, 5]] as const) {
  await cenario("N6 Fila de saída concorrente", `${k} conversa(s) × ${mPor} resposta(s), ${w} despachantes em processos diferentes`, async () => {
    const convs = [];
    for (let i = 0; i < k; i++) {
      const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
      await prisma.$transaction((tx: any) => registrarSaidas(tx, c.id, Array.from({ length: mPor }, (_, j) => `N6 ${c.id} parte ${j}`), true));
      convs.push(c);
    }
    evo.atraso = 30;
    await Promise.all(Array.from({ length: w }, () => worker({ acao: "despachar" })));
    evo.atraso = 0;
    await svc.despachar(); await svc.aguardarFilas();
    const prob: string[] = [];
    for (const c of convs) {
      const seqTextos = evo.entregues.filter((e) => e.numero === c.numero).map((e) => e.texto);
      const esperado = Array.from({ length: mPor }, (_, j) => `N6 ${c.id} parte ${j}`);
      if (seqTextos.length !== mPor) prob.push(`${c.numero}: ${seqTextos.length} entregas de ${mPor}`);
      else if (seqTextos.join("|") !== esperado.join("|")) prob.push(`${c.numero}: fora de ordem`);
    }
    return { quebrou: prob.length > 0, detalhe: prob.join("; ") };
  });
}

// N7: despachante morto em momento sorteado (15)
for (let i = 1; i <= 15; i++) {
  const ms = entre(0, 900);
  await cenario("N7 Queda no despachante", `despachante morto ${ms} ms depois do 1º envio`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    await prisma.$transaction((tx: any) => registrarSaidas(tx, c.id, [`N7 ${c.id} a`, `N7 ${c.id} b`, `N7 ${c.id} c`], true));
    evo.atraso = 250;
    await worker({ acao: "despachar" }, { depoisDe: () => evo.chamadas.some((x) => x.numero === c.numero), ms });
    evo.atraso = 0;
    // O envio interrompido só vira "incerto" quando o prazo de envio vence.
    await prisma.saidaMaisa.updateMany({ where: { conversaId: c.id, status: "processando" }, data: { travadoAte: new Date(Date.now() - 3 * 3_600_000) } });
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 60_000 });
    const prob = await invariantes(c);
    const cv = await conv(c.id);
    const todas = entregues(c.numero) >= 3;
    if (!todas && cv.comMaisa) prob.push("nem tudo entregue e a conversa continua com a Maisa");
    return { quebrou: prob.length > 0, detalhe: `entregues=${entregues(c.numero)} comMaisa=${cv.comMaisa} ${prob.join("; ")}` };
  });
}

// N8: Postgres cai durante o processamento de uma mensagem (6)
for (let i = 1; i <= 6; i++) {
  const ms = entre(0, 300);
  await cenario("N8 Postgres cai no processamento", `banco cai ${ms} ms depois de o processo começar a ler`, async () => {
    const c = await conversa({ etapa: "cpf", tentativas: 0, produto: "siape" });
    const m = await msg(c.id, "ok");
    const w = worker({ acao: "processar", conversaId: c.id, mensagemId: m.id });
    await sleep(1500 + ms);
    await pg.stop(); await sleep(800); await pg.start();
    await prisma.$disconnect(); await prisma.$connect();
    await w;
    await prisma.$executeRawUnsafe(`update conversas set maisa_lease_ate = null, maisa_lease_dono = null where id = '${c.id}'`);
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 60_000 });
    const e = await estado(c.id);
    const respostas = (await maisaRows(c.id)).length;
    const leu = e.ultimaMensagemId === m.id;
    const prob = await invariantes(c);
    // Atômico: leu e respondeu, ou não leu e não respondeu.
    if (leu !== respostas > 0 && (await conv(c.id)).comMaisa) prob.push(`estado e respostas desencontrados (leu=${leu}, respostas=${respostas})`);
    return { quebrou: prob.length > 0, detalhe: `leu=${leu} respostas=${respostas} ${prob.join("; ")}` };
  });
}

// N9: etapa 3 sem resposta confiável (10)
for (const modo of ["lento", "500", "queda", "erro", "cria_e_html", "408", "sem_codigo", "codigo_vazio", "502", "cria_e_erro"] as ModoFacta[]) {
  await cenario("N9 Etapa 3 incerta", `etapa 3 com ${modo}: desconhecida, sem dizer que a Facta recusou`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { modo: { "etapa3-proposta-cadastro": modo } });
    await cliente(c.id, "sim"); deslocamento = 31_000; await svc.executarDigitacoesPendentes(); await svc.aguardarFilas();
    const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
    const ns = (await notas(c.id)).join(" ");
    const ruim = /recusou antes|Facta recusou/.test(ns) || !/conferir no portal|Confira no portal|confira no portal/i.test(ns);
    const ev = await prisma.maisaEvento.findMany({ where: { conversaId: c.id }, orderBy: { createdAt: "asc" }, select: { rotulo: true, motivo: true } });
    return { quebrou: op?.status !== "desconhecida" || ruim, detalhe: `operação=${op?.status} nota adequada=${!ruim} eventos=${ev.map((e: any) => e.rotulo + (e.motivo ? `(${e.motivo.slice(0, 120)})` : "")).join(" > ")}` };
  });
}

// N10: processo morto perto do ponto sem volta (10)
for (let i = 1; i <= 10; i++) {
  const ms = entre(0, 900);
  await cenario("N10 Queda perto do ponto sem volta", `processo morto ${ms} ms depois da etapa 1`, async () => {
    const c = await conversa();
    facta.planos.set(c.cpf, { atraso: { "etapa2-dados-pessoais": 300, "etapa3-proposta-cadastro": 300 } });
    await cliente(c.id, "sim");
    await worker({ acao: "executar", deslocamento: 31_000 }, { depoisDe: () => chamadasFacta(c.cpf, "etapa1") > 0, ms });
    await prisma.$executeRawUnsafe(`update conversas set maisa_lease_ate = null, maisa_lease_dono = null where id = '${c.id}'`);
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 5 * 60_000 });
    await expirarTudo(); await worker({ acao: "recuperar", deslocamento: 10 * 60_000 });
    const prob = await invariantes(c);
    const op = await prisma.operacaoFacta.findFirst({ where: { conversaId: c.id } });
    const cv = await conv(c.id);
    if (op && ["preparada", "irreversivel"].includes(op.status)) prob.push(`operação parada em ${op.status}`);
    if (cv.comMaisa && op?.status === "desconhecida") prob.push("incerta e ainda com a Maisa");
    return { quebrou: prob.length > 0, detalhe: `criadas=${criadas(c.cpf)} op=${op?.status} comMaisa=${cv.comMaisa} ${prob.join("; ")}` };
  });
}
srvApp.close();

// ---------- fim ----------
const q = resultados.filter((r) => r.resultado === "QUEBROU");
console.log(`\n${resultados.length} cenários: ${q.length} quebraram, ${resultados.length - q.length} resistiram`);
const porGrupo: Record<string, [number, number]> = {};
for (const r of resultados) { const g = (porGrupo[r.grupo] ??= [0, 0]); g[r.resultado === "QUEBROU" ? 0 : 1]++; }
for (const [g, [a, b]] of Object.entries(porGrupo)) console.log(`  ${g}: ${a} quebraram, ${b} resistiram`);
writeFileSync(path.join(path.dirname(ESTE), "resultado.json"), JSON.stringify({ semente: args.includes("--seed") ? args[args.indexOf("--seed") + 1] : 20261112, resultados }, null, 2));
await prisma.$disconnect();
await pg.stop();
rmSync(dirPg, { recursive: true, force: true });
rmSync(pastaAntiga, { recursive: true, force: true });
process.exit(0);
