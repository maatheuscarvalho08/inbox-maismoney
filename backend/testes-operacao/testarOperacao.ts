// Testes de operação da Maisa: concorrência, reinício, idempotência na Facta, falha de
// entrega no WhatsApp e avisos. Roda o serviço real (maisa.service.ts) contra:
// - um Postgres 16 embutido, com as migrações reais aplicadas (garantias de verdade:
//   chave única, versão do estado, transações);
// - uma Facta falsa e uma Evolution falsas, servidores HTTP locais, que respondem certo,
//   erram, demoram ou derrubam a conexão. O código de chamada (facta.ts, evolutionApi.ts,
//   entrega.ts) é o real.
// Nada sai para a internet. A OpenAI fica desligada (só regras).
//
// Uso: cd backend/testes-operacao && npm install && npx tsx testarOperacao.ts [--filtro texto] [--verbose]
// Fica fora de src/ e do package.json principal: o Postgres embutido não entra na imagem.
import assert from "node:assert/strict";
import http from "node:http";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { fileURLToPath } from "node:url";

// Pasta do backend: as migrações e o schema reais.
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const filtro = args.includes("--filtro") ? args[args.indexOf("--filtro") + 1].toLowerCase() : null;
const verbose = args.includes("--verbose");

// ---------- Facta falsa ----------
type Modo = "ok" | "erro" | "lento" | "500" | "queda";
const facta = { modo: {} as Record<string, Modo>, chamadas: [] as string[], atrasoOk: 0 };
const RESPOSTA_FACTA: Record<string, Record<string, unknown>> = {
  "/gera-token": { erro: false, token: "token-teste" },
  "/proposta/etapa1-simulador": { erro: false, id_simulador: "SIM1" },
  "/proposta/etapa2-dados-pessoais": { erro: false, codigo_cliente: "CLI1" },
  "/proposta/etapa3-proposta-cadastro": { erro: false, codigo: "AF777", url_formalizacao: "https://facta.teste/af777" },
  "/proposta/envio-link": { erro: false, mensagem: "enviado" },
};
const servidorFacta = http.createServer((req, res) => {
  const rota = (req.url ?? "").split("?")[0];
  facta.chamadas.push(rota);
  const modo = facta.modo[rota] ?? "ok";
  req.resume();
  req.on("end", () => {
    if (modo === "queda") return req.socket.destroy();
    if (modo === "lento") return setTimeout(() => res.writableEnded || res.end("{}"), 2_000);
    if (modo === "500") return res.writeHead(500).end("{}");
    if (modo === "erro") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ erro: true, mensagem: `recusado em ${rota} (teste)` }));
    const corpo = JSON.stringify(RESPOSTA_FACTA[rota] ?? { erro: true, mensagem: "rota desconhecida" });
    setTimeout(() => res.writeHead(200, { "Content-Type": "application/json" }).end(corpo), rota.includes("etapa3") ? facta.atrasoOk : 0);
  });
});

// ---------- Evolution falsa ----------
type ModoEnvio = "ok" | "503" | "502" | "429" | "504" | "500" | "400" | "lento" | "queda";
const evolution = { fila: [] as ModoEnvio[], chamadas: 0, textos: [] as string[] };
let idEnvio = 0;
const servidorEvolution = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    evolution.chamadas++;
    const modo = evolution.fila.shift() ?? "ok";
    if (modo === "queda") return req.socket.destroy();
    if (modo === "lento") return setTimeout(() => res.writableEnded || res.end("{}"), 2_000);
    if (modo !== "ok") return res.writeHead(Number(modo), { "Content-Type": "application/json" }).end(JSON.stringify({ message: `HTTP ${modo} (teste)` }));
    try {
      evolution.textos.push(JSON.parse(corpo).text);
    } catch {
      /* corpo sem texto */
    }
    res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ key: { id: `EVO${++idEnvio}` } }));
  });
});

const ouvir = (s: http.Server, porta = 0) => new Promise<number>((r) => s.listen(porta, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const fechar = (s: http.Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });

async function main() {
  const portaFacta = await ouvir(servidorFacta);
  let portaEvolution = await ouvir(servidorEvolution);
  const dirPg = mkdtempSync(path.join(tmpdir(), "maisa-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dirPg, user: "teste", password: "teste", port: 54331, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("maisa_teste");
  await pg.createDatabase("maisa_sombra");
  const DB = "postgresql://teste:teste@127.0.0.1:54331/maisa_teste";

  // Tudo definido aqui vale mais que o .env local (o dotenv não sobrescreve).
  Object.assign(process.env, {
    DATABASE_URL: DB, JWT_SECRET: "teste", MAISA_MODO: "automatico", MAISA_BANCO_SIMULADO: "false", MAISA_SIMULADOR: "false",
    MAISA_DIGITA_PROPOSTA: "true", MAISA_DIGITACAO_LIBERADA: "true", MAISA_JANELA_CONFIRMACAO_S: "30", MAISA_FOLLOWUP_PORT: "false",
    MAISA_ENTREGA_TENTATIVAS: "3", FACTA_BASE_URL: `http://127.0.0.1:${portaFacta}`, FACTA_USER: "u", FACTA_PASS: "p",
    FACTA_LOGIN_CERTIFICADO: "cert", FACTA_CODIGO_MASTER: "1", FACTA_TIMEOUT_MS: "400",
    EVOLUTION_API_URL: `http://127.0.0.1:${portaEvolution}`, EVOLUTION_API_KEY: "k", EVOLUTION_TIMEOUT_MS: "400",
    META_ACCESS_TOKEN: "", OPENAI_API_KEY: "", PUBLIC_API_URL: "http://127.0.0.1:1",
  });

  // As migrações reais, do zero. E o esquema tem de bater com elas.
  execSync("npx prisma migrate deploy", { cwd: BACKEND, env: process.env, stdio: verbose ? "inherit" : "pipe" });
  const diff = execSync(
    `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://teste:teste@127.0.0.1:54331/maisa_sombra --exit-code`,
    { cwd: BACKEND, env: process.env, stdio: "pipe" },
  ).toString();

  const { prisma } = await import("../src/db/prisma.js");
  const { env } = await import("../src/config/env.js");
  const { initSocket } = await import("../src/ws/socket.js");
  const svc = await import("../src/modules/maisa/maisa.service.js");
  const { ehAceiteTardio } = await import("../src/modules/maisa/aceiteTardio.js");
  const { classificarFalhaEnvio } = await import("../src/modules/mensagens/falhaEnvio.js");
  const { TEXTOS } = await import("../src/modules/maisa/textos.js");
  type EstadoMaisa = import("../src/modules/maisa/fluxo.js").EstadoMaisa;

  // Socket real, sem clientes: guarda os eventos emitidos.
  const eventos: { nome: string; dado: any }[] = [];
  const io = initSocket(http.createServer());
  const emitir = io.emit.bind(io);
  (io as any).emit = (nome: string, ...a: unknown[]) => {
    eventos.push({ nome, dado: a[0] });
    return emitir(nome, ...a);
  };

  // Relógio da Maisa: o real mais um deslocamento que os testes avançam.
  let deslocamento = 0;
  svc.portasMaisa.agora = () => new Date(Date.now() + deslocamento);
  svc.portasMaisa.esperaReenvioMs = () => 0;
  svc.portasMaisa.digitando = () => 0;
  const avancarRelogio = (ms: number) => (deslocamento += ms);

  const instancia = await prisma.instancia.create({ data: { nome: "Teste", numero: "5521000000001", tipoConexao: "evolution", evolutionInstanceId: "inst-teste", maisaAtiva: true, status: "conectado" } });

  const DADOS = {
    nome: "Maria da Silva", rg: "123456789", orgaoEmissor: "SSP", estadoRg: "RJ", dataExpedicao: "2010-05-20",
    nomeMae: "Ana da Silva", nomePai: "José da Silva", cidadeNatural: "540", cidadeNaturalNome: "NITEROI", estadoNatural: "RJ",
    sexo: "F", estadoCivil: "4", estadoCivilNome: "SOLTEIRO", cep: "24020000", numero: "100", complemento: "",
    endereco: "Rua da Conceição", bairro: "Centro", cidade: "540", cidadeNome: "NITEROI", estado: "RJ", email: "maria@exemplo.com",
    matricula: "1234567", bancoConta: "104", agencia: "1234", conta: "123456", valorPatrimonio: "1", pixCpf: true, renda: 4670.31,
  };
  const estadoConfirmacao = (extra: Partial<EstadoMaisa> = {}): EstadoMaisa => ({
    etapa: "confirmacao", tentativas: 0, produto: "siape", dataNascimento: "1958-03-15", cpfFim: "0003",
    oferta: { banco: "Facta", valorCentavos: 1250000, parcelaCentavos: 30000, prazoMeses: 84, tabela: { codigoTabela: 1, prazo: 84, contrato: 12500, parcela: 300, coeficiente: 0.024 }, renda: 4670.31, matricula: "1234567" },
    contrato: { dados: DADOS as any, pergunta: TEXTOS.perguntaConfirmacao, origem: { renda: "extrato", matricula: "extrato" } },
    ...extra,
  });

  const { cpfValido } = await import("../src/modules/maisa/cpf.js");
  let CPF_VALIDO = "";
  for (let n = 200000000; !CPF_VALIDO; n++) for (let d = 0; d <= 99 && !CPF_VALIDO; d++) {
    const c = `${n}${String(d).padStart(2, "0")}`;
    if (cpfValido(c)) CPF_VALIDO = c;
  }
  // Um CPF por conversa: a trava por cliente bloquearia (de propósito) conversas com o mesmo CPF.
  const CPFS: string[] = [];
  for (let n = 400000000; CPFS.length < 400; n++) for (let d = 0; d <= 99; d++) { const c = `${n}${String(d).padStart(2, "0")}`; if (cpfValido(c)) { CPFS.push(c); break; } }
  let seq = 0;
  async function novaConversa(estado: EstadoMaisa | null = estadoConfirmacao(), extra: Record<string, unknown> = {}) {
    seq++;
    const contato = await prisma.contato.create({ data: { nome: `Cliente ${seq}`, cpf: CPFS[seq], numeroWhatsapp: `55219${String(seq).padStart(8, "0")}` } });
    return prisma.conversa.create({
      data: { instanciaId: instancia.id, contatoId: contato.id, comMaisa: true, status: "aberta", maisaEstado: (estado ?? undefined) as any, ...extra },
    });
  }
  async function mensagemCliente(conversaId: string, texto: string, criadaHaMs = 0) {
    return prisma.mensagem.create({ data: { conversaId, remetenteTipo: "cliente", conteudoTexto: texto, createdAt: new Date(Date.now() - criadaHaMs), timestamp: new Date(Date.now() - criadaHaMs) } });
  }
  // O que o webhook faz: grava e manda processar.
  async function cliente(conversaId: string, texto: string) {
    const m = await mensagemCliente(conversaId, texto);
    await svc.processarComMaisa(conversaId, m.id);
    // O despachante entrega depois de gravar: espera ele também.
    await svc.aguardarFilas();
    return m;
  }
  const estadoDe = async (id: string) => (await prisma.conversa.findUniqueOrThrow({ where: { id } })).maisaEstado as unknown as EstadoMaisa;
  const conversaDe = (id: string) => prisma.conversa.findUniqueOrThrow({ where: { id } });
  const respostasMaisa = (id: string) => prisma.mensagem.findMany({ where: { conversaId: id, remetenteTipo: "maisa" }, orderBy: { createdAt: "asc" } });
  const notas = async (id: string) => (await prisma.mensagem.findMany({ where: { conversaId: id, remetenteTipo: "nota" } })).map((n) => n.conteudoTexto ?? "");
  const etapa3 = () => facta.chamadas.filter((c) => c.includes("etapa3")).length;
  const etapa1 = () => facta.chamadas.filter((c) => c.includes("etapa1")).length;
  // "sim" confirmado e janela vencida: o job executa.
  async function simEJanela(conversaId: string) {
    await cliente(conversaId, "sim");
    avancarRelogio(31_000);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
  }
  function reiniciarFalsos() {
    deslocamento = 0;
    facta.modo = {};
    facta.atrasoOk = 0;
    evolution.fila = [];
    env.MAISA_DIGITACAO_LIBERADA = true;
    env.MAISA_FOLLOWUP_PORT = false;
  }

  // ---------- casos ----------
  const casos: { nome: string; grupo: string; fn: () => Promise<void> }[] = [];
  const caso = (grupo: string, nome: string, fn: () => Promise<void>) => casos.push({ grupo, nome, fn });

  // G0: banco
  caso("Banco", "Migrações do zero aplicam e batem com o schema.prisma", async () => {
    assert.match(diff, /No difference|empty migration|^\s*$/i);
  });

  // G1: concorrência
  for (const n of [2, 3, 5, 8, 10]) {
    caso("Concorrência", `${n} "sim" chegando ao mesmo tempo, cada um num processo, digitam uma vez só`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      const ms = await Promise.all(Array.from({ length: n }, () => mensagemCliente(c.id, "sim")));
      // Cada mensagem num "processo" diferente: sem a fila em memória entre elas.
      await Promise.all(ms.map((m) => { svc.esquecerFilas(); return svc.processarComMaisa(c.id, m.id); }));
      await svc.aguardarFilas();
      avancarRelogio(31_000);
      await Promise.all(Array.from({ length: n }, () => { svc.esquecerFilas(); return svc.executarDigitacoesPendentes(); }));
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 1, "chamadas à etapa 3 da Facta");
      assert.equal(await prisma.operacaoFacta.count({ where: { conversaId: c.id } }), 1, "operações");
      assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 1, "propostas");
    });
  }
  for (const n of [2, 5, 10]) {
    caso("Concorrência", `webhook repetido ${n} vezes ao mesmo tempo em processos diferentes responde uma vez`, async () => {
      const c = await novaConversa();
      const m = await mensagemCliente(c.id, "sim");
      await Promise.all(Array.from({ length: n }, () => { svc.esquecerFilas(); return svc.processarComMaisa(c.id, m.id); }));
      await svc.aguardarFilas();
      const r = await respostasMaisa(c.id);
      assert.equal(r.filter((x) => x.conteudoTexto === TEXTOS.confirmacaoRecebida).length, 1, "respostas de confirmação");
    });
  }
  for (const n of [2, 4, 8, 16]) {
    caso("Concorrência", `job de digitação disparado ${n} vezes ao mesmo tempo em processos diferentes digita uma vez`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      await cliente(c.id, "sim");
      avancarRelogio(31_000);
      await Promise.all(Array.from({ length: n }, () => { svc.esquecerFilas(); return svc.executarDigitacoesPendentes(); }));
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 1);
      assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 1);
      const r = await respostasMaisa(c.id);
      assert.equal(r.filter((x) => /contrato foi feito/.test(x.conteudoTexto ?? "")).length, 1, "link enviado uma vez");
    });
  }
  for (const n of [2, 4, 8]) {
    caso("Concorrência", `job disparado ${n} vezes no mesmo processo (fila em memória) digita uma vez`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      await cliente(c.id, "sim");
      avancarRelogio(31_000);
      await Promise.all(Array.from({ length: n }, () => svc.executarDigitacoesPendentes()));
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 1);
    });
  }
  for (let rep = 1; rep <= 5; rep++) {
    caso("Concorrência", `"sim" e "espera, o CEP tá errado" juntos em processos diferentes nunca digitam (rodada ${rep})`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      const sim = await mensagemCliente(c.id, "sim", 50);
      const corr = await mensagemCliente(c.id, "espera, o CEP tá errado");
      const ordem = rep % 2 ? [sim, corr] : [corr, sim];
      await Promise.all(ordem.map((m) => { svc.esquecerFilas(); return svc.processarComMaisa(c.id, m.id); }));
      await svc.aguardarFilas();
      avancarRelogio(31_000);
      await svc.executarDigitacoesPendentes();
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 0, "não pode digitar");
    });
  }
  for (let rep = 1; rep <= 5; rep++) {
    caso("Concorrência", `"sim" e logo depois "obrigada" mantêm a confirmação e digitam uma vez (rodada ${rep})`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      await cliente(c.id, "sim");
      await cliente(c.id, "obrigada");
      avancarRelogio(31_000);
      await svc.executarDigitacoesPendentes();
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 1);
    });
  }
  for (const texto of ["espera", "o nome da minha mãe está errado", "não", "quero falar com um atendente", "isso é golpe?", "pensando melhor, deixa eu ver com meu filho"]) {
    caso("Concorrência", `"sim" e depois "${texto}" dentro da janela cancelam a digitação`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      await cliente(c.id, "sim");
      await cliente(c.id, texto);
      avancarRelogio(31_000);
      await svc.executarDigitacoesPendentes();
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 0);
      assert.equal((await estadoDe(c.id)).confirmacaoPendente, undefined, "agendamento cancelado");
    });
  }
  caso("Concorrência", "Job antes da janela não digita; depois da janela digita", async () => {
    const c = await novaConversa();
    const antes = etapa3();
    await cliente(c.id, "sim");
    avancarRelogio(10_000);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa3() - antes, 0);
    avancarRelogio(25_000);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa3() - antes, 1);
  });
  // Fase 6.1 (C1): mensagem relevante depois do "sim" cancela (antes adiava até ser lida).
  caso("Concorrência", "Mensagem que chegou depois do sim, ainda não lida, cancela a digitação", async () => {
    const c = await novaConversa();
    const antes = etapa3();
    await cliente(c.id, "sim");
    const naoLida = await mensagemCliente(c.id, "espera, a agência está errada");
    avancarRelogio(31_000);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa3() - antes, 0, "não digitou");
    assert.equal((await estadoDe(c.id)).confirmacaoPendente, undefined, "agendamento cancelado");
    await svc.processarComMaisa(c.id, naoLida.id);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa3() - antes, 0, "a mensagem lida cancelou");
  });
  caso("Concorrência", "Operador assume durante a digitação: a proposta criada fica registrada com nota", async () => {
    const c = await novaConversa();
    await cliente(c.id, "sim");
    avancarRelogio(31_000);
    facta.atrasoOk = 250;
    const exec = svc.executarDigitacoesPendentes();
    await new Promise((r) => setTimeout(r, 120));
    await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: false, maisaVersao: { increment: 1 } } });
    await exec;
    await svc.aguardarFilas();
    assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 1, "proposta registrada");
    assert.ok((await notas(c.id)).some((n) => /conversa mudou no meio/.test(n)), "nota para a equipe");
    assert.equal((await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } })).status, "concluida");
  });

  // G2: webhook repetido e releitura
  for (const espera of [0, 1, 3]) {
    caso("Webhook repetido", `mesma mensagem processada de novo ${espera ? `depois de ${espera} outra(s)` : "em seguida"} não é lida duas vezes`, async () => {
      const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", produto: "siape", contrato: undefined, oferta: undefined }));
      const m = await cliente(c.id, "bom dia");
      for (let i = 0; i < espera; i++) await cliente(c.id, "ok");
      const antes = (await respostasMaisa(c.id)).length;
      await svc.processarComMaisa(c.id, m.id);
      await svc.aguardarFilas();
      assert.equal((await respostasMaisa(c.id)).length, antes, "nenhuma resposta nova");
    });
  }
  caso("Webhook repetido", "Recuperação rodando três vezes não lê de novo o que já foi lido", async () => {
    const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
    await cliente(c.id, "bom dia");
    const antes = (await respostasMaisa(c.id)).length;
    avancarRelogio(60_000);
    for (let i = 0; i < 3; i++) await svc.recuperarMensagensNaoLidas();
    await svc.aguardarFilas();
    assert.equal((await respostasMaisa(c.id)).length, antes);
  });

  // G3: reinício
  for (const atraso of [31_000, 120_000, 3_600_000]) {
    caso("Reinício", `"sim" agendado sobrevive ao reinício e digita uma vez (${atraso / 1000}s depois)`, async () => {
      const c = await novaConversa();
      const antes = etapa3();
      await cliente(c.id, "sim");
      svc.esquecerFilas(); // o processo reinicia: nada em memória
      avancarRelogio(atraso);
      await svc.recuperarMaisa();
      await svc.aguardarFilas();
      await svc.recuperarMaisa();
      await svc.aguardarFilas();
      assert.equal(etapa3() - antes, 1);
    });
  }
  for (const n of [1, 2, 4]) {
    caso("Reinício", `${n} mensagem(ns) que chegaram e não foram lidas são lidas uma vez, na ordem`, async () => {
      const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
      await cliente(c.id, "bom dia");
      const ms = [];
      for (let i = 0; i < n; i++) {
        await new Promise((r) => setTimeout(r, 5));
        ms.push(await mensagemCliente(c.id, i === n - 1 ? CPF_VALIDO : "ok"));
      }
      svc.esquecerFilas();
      avancarRelogio(60_000);
      await svc.recuperarMensagensNaoLidas();
      await svc.aguardarFilas();
      await svc.recuperarMensagensNaoLidas();
      await svc.aguardarFilas();
      const e = await estadoDe(c.id);
      assert.equal(e.ultimaMensagemId, ms[n - 1].id, "última lida");
      assert.equal(e.etapa, "nascimento", "o CPF da última mensagem foi lido");
    });
  }
  caso("Reinício", "Primeira mensagem de conversa nova que não foi lida é recuperada", async () => {
    const c = await novaConversa(null, { createdAt: new Date(Date.now() - 60_000) });
    await mensagemCliente(c.id, "oi", 40_000);
    avancarRelogio(40_000);
    await svc.recuperarMensagensNaoLidas();
    await svc.aguardarFilas();
    assert.ok((await respostasMaisa(c.id)).length >= 1);
  });
  caso("Reinício", "Conversa antiga sem estado (devolvida pela equipe) não é recuperada", async () => {
    const c = await novaConversa(null, { createdAt: new Date(Date.now() - 3 * 3_600_000) });
    await mensagemCliente(c.id, "oi", 40_000);
    avancarRelogio(40_000);
    await svc.recuperarMensagensNaoLidas();
    await svc.aguardarFilas();
    assert.equal((await respostasMaisa(c.id)).length, 0);
  });
  caso("Reinício", "Mensagem com menos de 20 segundos não é disputada com o webhook", async () => {
    const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
    await cliente(c.id, "bom dia");
    await mensagemCliente(c.id, "ok");
    const antes = (await respostasMaisa(c.id)).length;
    await svc.recuperarMensagensNaoLidas(1_000_000);
    await svc.aguardarFilas();
    assert.equal((await respostasMaisa(c.id)).length, antes);
  });
  const { chaveOperacao } = await import("../src/modules/maisa/operacaoFacta.js");
  async function operacaoDe(c: { id: string }, status: string, minutos: number) {
    const e = await estadoDe(c.id);
    const contato = await prisma.contato.findFirstOrThrow({ where: { conversas: { some: { id: c.id } } } });
    const k = chaveOperacao(contato.cpf!, e);
    await prisma.operacaoFacta.create({ data: { conversaId: c.id, cpf: contato.cpf!, chave: k.chave, tipo: k.tipo, versaoDados: k.versao, status, ...(status === "irreversivel" ? { irreversivelEm: new Date() } : {}) } });
    if (minutos) await prisma.$executeRawUnsafe(`update operacoes_facta set updated_at = now() - interval '${minutos} minutes' where conversa_id = '${c.id}'`);
  }
  const pendente = () => estadoConfirmacao({ confirmacaoPendente: { recebidoEm: new Date().toISOString(), executarEm: new Date().toISOString(), consentimento: "sim" } });
  for (const minutos of [6, 30, 120]) {
    caso("Reinício", `Digitação parada depois do ponto sem volta há ${minutos} min vira desconhecida, vai para a equipe e não chama a Facta`, async () => {
      const c = await novaConversa(pendente());
      await operacaoDe(c, "irreversivel", minutos);
      const antes = etapa1();
      svc.esquecerFilas();
      await svc.recuperarMaisa();
      await svc.aguardarFilas();
      assert.equal(etapa1() - antes, 0, "Facta não chamada");
      assert.equal((await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } })).status, "desconhecida");
      assert.equal((await conversaDe(c.id)).comMaisa, false, "com a equipe");
      assert.ok((await notas(c.id)).some((n) => /portal Facta/.test(n)));
    });
    caso("Reinício", `Digitação parada antes do ponto sem volta há ${minutos} min libera a reserva e a tentativa seguinte digita uma vez`, async () => {
      const c = await novaConversa(pendente());
      await operacaoDe(c, "preparada", minutos);
      svc.esquecerFilas();
      await svc.recuperarMaisa();
      await svc.aguardarFilas();
      const op = await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } });
      assert.equal(op.status, "concluida", "reaproveitou a reserva e concluiu");
      assert.equal(op.tentativas, 2);
      assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 1);
    });
  }
  caso("Reinício", "Digitação em andamento (preparada há pouco): outra execução não chama a Facta e passa para a equipe", async () => {
    const c = await novaConversa(pendente());
    await operacaoDe(c, "preparada", 0);
    const antes = etapa1();
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa1() - antes, 0);
    assert.equal((await conversaDe(c.id)).comMaisa, false);
    assert.ok((await notas(c.id)).some((n) => /NÃO feita/.test(n)));
  });

  // G4: Facta, etapa a etapa
  const ROTAS: [string, string][] = [
    ["etapa 1", "/proposta/etapa1-simulador"], ["etapa 2", "/proposta/etapa2-dados-pessoais"],
    ["etapa 3", "/proposta/etapa3-proposta-cadastro"], ["envio do link", "/proposta/envio-link"],
  ];
  const ESPERADO: Record<string, Record<Modo, string>> = {
    "etapa 1": { lento: "falhou", "500": "falhou", queda: "falhou", erro: "falhou", ok: "concluida" },
    "etapa 2": { lento: "falhou", "500": "falhou", queda: "falhou", erro: "falhou", ok: "concluida" },
    // Fase 6.1 (A4): qualquer resposta da etapa 3 sem código de proposta é "desconhecida".
    "etapa 3": { lento: "desconhecida", "500": "desconhecida", queda: "desconhecida", erro: "desconhecida", ok: "concluida" },
    "envio do link": { lento: "concluida", "500": "concluida", queda: "concluida", erro: "concluida", ok: "concluida" },
  };
  for (const [nome, rota] of ROTAS) {
    for (const modo of ["lento", "500", "queda", "erro"] as Modo[]) {
      const esperado = ESPERADO[nome][modo];
      caso("Facta", `${nome} ${modo === "lento" ? "com tempo esgotado" : modo === "queda" ? "com conexão derrubada" : modo === "500" ? "com HTTP 500" : "recusando"}: operação ${esperado}`, async () => {
        const c = await novaConversa();
        facta.modo[rota] = modo;
        await simEJanela(c.id);
        const op = await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } });
        assert.equal(op.status, esperado);
        const conv = await conversaDe(c.id);
        assert.equal(conv.comMaisa, false, "passou para a equipe");
        const propostas = await prisma.proposta.count({ where: { conversaId: c.id } });
        assert.equal(propostas, esperado === "concluida" ? 1 : 0, "proposta registrada só quando concluída");
        const textos = (await respostasMaisa(c.id)).map((m) => m.conteudoTexto ?? "");
        if (esperado === "concluida") assert.ok(textos.some((t) => /contrato foi feito/.test(t)));
        else assert.ok(!textos.some((t) => /contrato foi feito/.test(t)), "nunca diz que fez");
        if (esperado === "desconhecida") {
          assert.ok((await notas(c.id)).some((n) => /RESULTADO INCERTO/.test(n)));
          assert.ok(eventos.some((e) => e.nome === "maisa:aviso" && e.dado.conversaId === c.id && e.dado.tipo === "digitacao_incerta"), "aviso na tela");
        }
      });
      // Fase 6.1 (M5): falha antes da etapa 3 não criou nada e pode tentar de novo; incerta
      // ou concluída bloqueia até a equipe liberar.
      caso("Facta", `${nome} ${modo}: nova tentativa da mesma oferta ${esperado === "falhou" ? "é permitida (nada foi criado)" : "não chama a Facta"}`, async () => {
        const c = await novaConversa();
        facta.modo[rota] = modo;
        await simEJanela(c.id);
        facta.modo = {};
        const antes = facta.chamadas.length;
        await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaEstado: estadoConfirmacao() as any, maisaVersao: { increment: 1 } } });
        await simEJanela(c.id);
        const novas = facta.chamadas.slice(antes).filter((x) => x.includes("etapa3")).length;
        assert.equal(await prisma.operacaoFacta.count({ where: { conversaId: c.id } }), 1, "uma linha por oferta");
        if (esperado === "falhou") assert.equal(novas, 1, "nova tentativa chegou à etapa 3 uma vez");
        else assert.equal(novas, 0, "nenhuma chamada nova à etapa 3");
      });
    }
  }
  caso("Facta", "Tudo certo: proposta registrada uma vez, link enviado, operação concluída", async () => {
    const c = await novaConversa();
    await simEJanela(c.id);
    const op = await prisma.operacaoFacta.findFirstOrThrow({ where: { conversaId: c.id } });
    assert.equal(op.status, "concluida");
    assert.equal(op.codigoAf, "AF777");
    assert.equal((await prisma.proposta.findFirstOrThrow({ where: { conversaId: c.id } })).numeroContrato, "AF777");
  });
  // Fase 6.1 (C3): operação concluída nunca é apresentada como contrato novo.
  caso("Facta", "Oferta já concluída e cliente diz sim de novo: não chama a Facta e não diz \"contrato feito\" de novo", async () => {
    const c = await novaConversa();
    await simEJanela(c.id);
    const antes = facta.chamadas.length;
    await prisma.conversa.update({ where: { id: c.id }, data: { comMaisa: true, maisaEstado: estadoConfirmacao() as any, maisaVersao: { increment: 1 } } });
    await simEJanela(c.id);
    assert.equal(facta.chamadas.length - antes, 0);
    assert.equal((await respostasMaisa(c.id)).filter((m) => /contrato foi feito/.test(m.conteudoTexto ?? "")).length, 1);
    assert.ok((await respostasMaisa(c.id)).some((m) => /conferindo/.test(m.conteudoTexto ?? "")));
    assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 1, "uma proposta só");
  });

  // G5: trava
  caso("Trava", "Trava desligada: não chama a Facta e passa para a equipe com os dados", async () => {
    env.MAISA_DIGITACAO_LIBERADA = false;
    const c = await novaConversa();
    const antes = facta.chamadas.length;
    await simEJanela(c.id);
    assert.equal(facta.chamadas.length - antes, 0);
    assert.equal(await prisma.operacaoFacta.count({ where: { conversaId: c.id } }), 0);
    assert.ok((await notas(c.id)).some((n) => /MAISA_DIGITACAO_LIBERADA/.test(n) && /DADOS PARA O CADASTRO/.test(n)));
  });
  for (const [desc, estado] of [
    ["cadastro sem e-mail", estadoConfirmacao({ contrato: { dados: { ...DADOS, email: undefined } as any, pergunta: "" } })],
    ["port sem número do contrato", estadoConfirmacao({ alternativa: { operacao: "port_refin", trocoCentavos: 100, motivo: "t", digitacao: { banco: "CEF", bancoCodigo: "104", parcela: 400, prazoRestante: 70, prazoOriginal: 120, saldoDevedor: 18000, port: { codigoTabela: 2, prazo: 70, contrato: 18000, parcela: 390, coeficiente: 0.02 }, refin: { codigoTabela: 3, prazo: 96, contrato: 20000, parcela: 400, coeficiente: 0.02 } } as any } })],
    ["oferta sem tabela", estadoConfirmacao({ oferta: { banco: "Facta", valorCentavos: 1, parcelaCentavos: 1, prazoMeses: 1 } })],
    ["dado do extrato divergente sem validação", estadoConfirmacao({ contrato: { dados: DADOS as any, pergunta: "", correcoes: [{ campo: "renda", origem: "extrato", anterior: 4670.31, novo: 9000, em: "", aplicada: false }] } })],
  ] as [string, EstadoMaisa][]) {
    caso("Trava", `Trava ligada, mas ${desc}: não chama a Facta`, async () => {
      const c = await novaConversa(estado);
      const antes = facta.chamadas.length;
      await simEJanela(c.id);
      assert.equal(facta.chamadas.length - antes, 0);
      assert.equal((await conversaDe(c.id)).comMaisa, false);
    });
  }

  // G6: entrega no WhatsApp
  const ENTREGAS: [string, ModoEnvio[], { entregue: boolean; chamadas: number }][] = [
    // Fase 6.1 (M1): a Evolution não documenta erros de envio; 5xx e 429 não provam que nada saiu.
    ["503: incerto, não repete", ["503", "ok"], { entregue: false, chamadas: 1 }],
    ["502: incerto, não repete", ["502", "ok"], { entregue: false, chamadas: 1 }],
    ["504: incerto, não repete", ["504", "ok"], { entregue: false, chamadas: 1 }],
    ["429: incerto, não repete", ["429", "ok"], { entregue: false, chamadas: 1 }],
    ["400 (número inválido): não repete", ["400"], { entregue: false, chamadas: 1 }],
    ["500: resultado incerto, não repete", ["500"], { entregue: false, chamadas: 1 }],
    ["tempo esgotado: não repete para não duplicar", ["lento"], { entregue: false, chamadas: 1 }],
    ["conexão derrubada: não repete", ["queda"], { entregue: false, chamadas: 1 }],
    ["entrega de primeira", ["ok"], { entregue: true, chamadas: 1 }],
  ];
  for (const [desc, fila, esp] of ENTREGAS) {
    caso("WhatsApp", `Resposta da Maisa com ${desc}`, async () => {
      const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
      evolution.fila = [...fila];
      const antes = evolution.chamadas;
      await cliente(c.id, "ok");
      assert.equal(evolution.chamadas - antes, esp.chamadas, "chamadas à Evolution");
      const r = await respostasMaisa(c.id);
      assert.equal(r.length, 1, "uma linha só no histórico");
      assert.equal(r[0].tentativasEntrega, esp.chamadas);
      assert.equal(r[0].statusEntrega, esp.entregue ? "enviado" : "falhou");
      const conv = await conversaDe(c.id);
      assert.equal(conv.comMaisa, esp.entregue, esp.entregue ? "segue com a Maisa" : "foi para a equipe");
      if (!esp.entregue) {
        assert.equal((await estadoDe(c.id)).saida, "falha_entrega");
        assert.ok((await notas(c.id)).some((n) => /não conseguiu entregar/.test(n)));
        assert.ok(eventos.some((e) => e.nome === "maisa:aviso" && e.dado.conversaId === c.id && e.dado.tipo === "entrega_falhou"));
      }
    });
  }
  caso("WhatsApp", "Evolution fora do ar (conexão recusada): tenta 3 vezes e passa para a equipe", async () => {
    const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
    await fechar(servidorEvolution);
    try {
      await cliente(c.id, "ok");
    } finally {
      portaEvolution = await ouvir(servidorEvolution, portaEvolution);
    }
    const r = await respostasMaisa(c.id);
    assert.equal(r[0].tentativasEntrega, 3);
    assert.equal((await conversaDe(c.id)).comMaisa, false);
  });
  caso("WhatsApp", "Falha na primeira de duas respostas: a segunda não é enviada e vai na nota", async () => {
    const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
    evolution.fila = ["400"];
    const antes = evolution.chamadas;
    await cliente(c.id, "obrigado");
    assert.equal(evolution.chamadas - antes, 1);
    // Fila de saída: as duas respostas são gravadas juntas; a segunda nunca sai.
    const r = await respostasMaisa(c.id);
    assert.equal(r.length, 2);
    assert.equal(r[1].statusEntrega, null, "a segunda não foi enviada");
    assert.equal((await prisma.saidaMaisa.findUniqueOrThrow({ where: { mensagemId: r[1].id } })).status, "falhou");
    assert.ok((await notas(c.id)).some((n) => /Não enviei também/.test(n)));
  });
  caso("WhatsApp", "Falha ao avisar \"vou fazer o contrato\": a digitação agendada é cancelada", async () => {
    const c = await novaConversa();
    evolution.fila = ["400"];
    const antes = etapa1();
    await cliente(c.id, "sim");
    avancarRelogio(31_000);
    await svc.executarDigitacoesPendentes();
    await svc.aguardarFilas();
    assert.equal(etapa1() - antes, 0, "não digitou");
    assert.equal((await estadoDe(c.id)).confirmacaoPendente, undefined);
  });
  for (const [msg, falha] of [
    [{ isAxiosError: true, code: "ECONNREFUSED" }, "nao_enviada"], [{ isAxiosError: true, code: "ENOTFOUND" }, "nao_enviada"],
    [{ isAxiosError: true, code: "ECONNABORTED" }, "incerta"], [{ isAxiosError: true, code: "ECONNRESET" }, "incerta"],
    [{ isAxiosError: true, response: { status: 503 } }, "incerta"], [{ isAxiosError: true, response: { status: 401 } }, "recusada"],
    [{ isAxiosError: true, response: { status: 500 } }, "incerta"], [new Error("qualquer"), "incerta"],
  ] as [unknown, string][]) {
    caso("WhatsApp", `Classificação de falha: ${JSON.stringify(msg) === "{}" ? "Error" : JSON.stringify(msg)} é ${falha}`, async () => {
      assert.equal(classificarFalhaEnvio(msg), falha);
    });
  }

  // G6b: botão Enviar e Reenviar não duplicam mensagem da fila de saída (fase 7, correção do botão)
  const { default: jwt } = await import("jsonwebtoken");
  const { app } = await import("../src/app.js");
  const srvApp = http.createServer(app);
  const portaApp = await ouvir(srvApp);
  const admin = await prisma.usuario.create({ data: { nome: "Admin Teste", email: `adm${Date.now()}@teste.local`, senhaHash: "x", role: "admin" } });
  const token = jwt.sign({ sub: admin.id, role: "admin" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const chamar = (metodo: string, rota: string, corpo: unknown = {}) =>
    fetch(`http://127.0.0.1:${portaApp}/api${rota}`, { method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: metodo === "GET" ? undefined : JSON.stringify(corpo) });
  async function mensagemNaFila(conversaId: string, status: string, extra: Record<string, unknown> = {}) {
    const m = await prisma.mensagem.create({ data: { conversaId, remetenteTipo: "maisa", conteudoTexto: "Resposta da Maisa na fila", ...extra } });
    await prisma.saidaMaisa.create({ data: { conversaId, mensagemId: m.id, ordem: BigInt(Date.now()) * 1000n, status, proximaEm: new Date() } });
    return m;
  }
  for (const status of ["pendente", "processando", "enviado", "incerto", "falhou"]) {
    caso("Botão Enviar", `"Enviar" numa mensagem da fila (${status}) é recusado e não chama a Evolution`, async () => {
      const c = await novaConversa(null);
      const m = await mensagemNaFila(c.id, status);
      const antes = evolution.chamadas;
      const r = await chamar("POST", `/maisa/mensagens/${m.id}/enviar`);
      assert.equal(r.status, 409);
      assert.equal(evolution.chamadas - antes, 0);
    });
  }
  for (const status of ["pendente", "processando"]) {
    caso("Botão Enviar", `"Reenviar" numa mensagem ${status} é recusado`, async () => {
      const c = await novaConversa(null);
      const m = await mensagemNaFila(c.id, status, { statusEntrega: "falhou", erroEntrega: "x" });
      const antes = evolution.chamadas;
      const r = await chamar("POST", `/mensagens/${m.id}/reenviar`);
      assert.equal(r.status, 409);
      assert.equal(evolution.chamadas - antes, 0);
    });
  }
  caso("Botão Enviar", "Reenviar entrega incerta sem confirmação é recusado; com confirmação envia uma vez", async () => {
    const c = await novaConversa(null);
    const m = await mensagemNaFila(c.id, "incerto", { statusEntrega: "falhou", erroEntrega: "tempo esgotado" });
    const antes = evolution.chamadas;
    const sem = await chamar("POST", `/mensagens/${m.id}/reenviar`);
    assert.equal(sem.status, 409);
    assert.equal(evolution.chamadas - antes, 0, "sem confirmação não envia");
    const com = await chamar("POST", `/mensagens/${m.id}/reenviar`, { confirmarIncerto: true });
    assert.equal(com.status, 200);
    assert.equal(evolution.chamadas - antes, 1, "com confirmação envia uma vez");
  });
  caso("Botão Enviar", "Despachante e cliques de \"Enviar\" ao mesmo tempo: uma entrega só", async () => {
    const c = await novaConversa(estadoConfirmacao({ etapa: "cpf", contrato: undefined, oferta: undefined }));
    await prisma.$transaction((tx: any) => (svc as any).registrarSaidasParaTeste?.(tx, c.id, ["Uma só vez"]) ?? tx.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "Uma só vez" } }).then((m: any) => tx.saidaMaisa.create({ data: { conversaId: c.id, mensagemId: m.id, ordem: BigInt(Date.now()) * 1000n, proximaEm: new Date() } })));
    const m = await prisma.mensagem.findFirstOrThrow({ where: { conversaId: c.id, remetenteTipo: "maisa" } });
    const antes = evolution.chamadas;
    await Promise.all([svc.despachar(c.id), chamar("POST", `/maisa/mensagens/${m.id}/enviar`), chamar("POST", `/maisa/mensagens/${m.id}/enviar`), chamar("POST", `/mensagens/${m.id}/reenviar`)]);
    await svc.aguardarFilas();
    assert.equal(evolution.chamadas - antes, 1, "uma única entrega");
  });
  caso("Botão Enviar", "A lista de mensagens traz a situação da fila (saidaStatus)", async () => {
    const c = await novaConversa(null);
    const m = await mensagemNaFila(c.id, "pendente");
    const r = await chamar("GET", `/mensagens?conversaId=${c.id}`);
    const j = (await r.json()) as { mensagens: { id: string; saidaStatus: string | null }[] };
    assert.equal(j.mensagens.find((x) => x.id === m.id)?.saidaStatus, "pendente");
  });
  caso("Botão Enviar", "Modo copiloto (sem fila): a sugestão ainda pode ser enviada, uma vez", async () => {
    const c = await novaConversa(null);
    const m = await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "Sugestão do copiloto" } });
    const antes = evolution.chamadas;
    const r = await chamar("POST", `/maisa/mensagens/${m.id}/enviar`);
    assert.equal(r.status, 200);
    assert.equal(evolution.chamadas - antes, 1);
    const de_novo = await chamar("POST", `/maisa/mensagens/${m.id}/enviar`);
    assert.equal(de_novo.status, 400, "já enviada");
    assert.equal(evolution.chamadas - antes, 1);
  });

  // G7: aceite depois da transferência
  const finalizada = (saida: string, extra: Partial<EstadoMaisa> = {}) =>
    estadoConfirmacao({ etapa: "finalizada", saida, motivoTransferencia: saida, contrato: undefined, ...extra });
  caso("Aceite tardio", "Carrinho e depois \"sim\": avisa a equipe, não executa nada", async () => {
    const c = await novaConversa(finalizada("carrinho"), { comMaisa: false });
    const antes = facta.chamadas.length;
    await cliente(c.id, "sim, quero");
    assert.ok((await notas(c.id)).some((n) => /quer seguir/.test(n)));
    assert.ok(eventos.some((e) => e.nome === "maisa:aviso" && e.dado.conversaId === c.id && e.dado.tipo === "aceite_apos_transferencia"));
    assert.equal(facta.chamadas.length - antes, 0);
    assert.equal((await respostasMaisa(c.id)).length, 0, "a Maisa não responde");
    assert.equal((await conversaDe(c.id)).comMaisa, false);
  });
  caso("Aceite tardio", "Dois \"sim\" seguidos geram um aviso só; depois de 7 horas, outro", async () => {
    const c = await novaConversa(finalizada("recusou"), { comMaisa: false });
    await cliente(c.id, "pensando bem, quero");
    await cliente(c.id, "quero sim");
    assert.equal((await notas(c.id)).filter((n) => /quer seguir/.test(n)).length, 1);
    avancarRelogio(7 * 3_600_000);
    await cliente(c.id, "pode fazer");
    assert.equal((await notas(c.id)).filter((n) => /quer seguir/.test(n)).length, 2);
  });
  caso("Aceite tardio", "Equipe já conversando com o cliente: não avisa", async () => {
    const c = await novaConversa(finalizada("objecao"), { comMaisa: false });
    await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "maisa", conteudoTexto: "x", createdAt: new Date(Date.now() - 60_000) } });
    await prisma.mensagem.create({ data: { conversaId: c.id, remetenteTipo: "operador", conteudoTexto: "oi, sou da equipe" } });
    await cliente(c.id, "sim");
    assert.equal((await notas(c.id)).filter((n) => /quer seguir/.test(n)).length, 0);
  });
  caso("Aceite tardio", "Sem oferta antes da transferência: não avisa", async () => {
    const c = await novaConversa(finalizada("humano", { oferta: undefined }), { comMaisa: false });
    await cliente(c.id, "sim");
    assert.equal((await notas(c.id)).filter((n) => /quer seguir/.test(n)).length, 0);
  });
  for (const [texto, aceite] of [
    ["sim", true], ["quero sim", true], ["pensando bem, quero", true], ["mudei de ideia, pode fazer", true], ["pode seguir", true], ["bora", true],
    ["sim?", false], ["quero não", false], ["não quero", false], ["pensando bem, não", false], ["obrigado", false], ["quanto fica?", false], ["ok", false],
  ] as [string, boolean][]) {
    caso("Aceite tardio", `"${texto}" ${aceite ? "é" : "não é"} aceite depois da transferência`, async () => assert.equal(ehAceiteTardio(texto), aceite));
  }

  // G8: oferta de portabilidade
  const estadoPort = (ofertaEm: string | undefined): EstadoMaisa => ({
    etapa: "oferta_port", tentativas: 0, produto: "siape", dataNascimento: "1958-03-15", ofertaEm, followupEnviado: false,
    alternativa: { operacao: "portabilidade", trocoCentavos: null, motivo: "port", reducoes: [{ banco: "CEF", atual: 390.47, nova: 387.5, restantes: 68 }] },
  });
  caso("Port sem resposta", "Lembrete em 10 minutos com MAISA_FOLLOWUP_PORT ligado", async () => {
    env.MAISA_FOLLOWUP_PORT = true;
    const c = await novaConversa(estadoPort(new Date(Date.now() + deslocamento - 11 * 60_000).toISOString()));
    await svc.verificarOfertasPendentes();
    await svc.aguardarFilas();
    assert.ok((await respostasMaisa(c.id)).some((m) => m.conteudoTexto === TEXTOS.followupOfertaPort));
  });
  caso("Port sem resposta", "Carrinho em 24 horas com MAISA_FOLLOWUP_PORT ligado, com as simulações na nota", async () => {
    env.MAISA_FOLLOWUP_PORT = true;
    const c = await novaConversa(estadoPort(new Date(Date.now() + deslocamento - 25 * 3_600_000).toISOString()));
    await svc.verificarOfertasPendentes();
    await svc.aguardarFilas();
    const conv = await conversaDe(c.id);
    assert.ok(conv.carrinhoEm, "no Carrinho");
    assert.equal(conv.comMaisa, false);
    assert.ok((await notas(c.id)).some((n) => /portabilidade em 24 horas/.test(n)));
  });
  caso("Port sem resposta", "Desligado (padrão): nada acontece", async () => {
    const c = await novaConversa(estadoPort(new Date(Date.now() + deslocamento - 25 * 3_600_000).toISOString()));
    await svc.verificarOfertasPendentes();
    await svc.aguardarFilas();
    assert.equal((await conversaDe(c.id)).comMaisa, true);
    assert.equal((await respostasMaisa(c.id)).length, 0);
  });
  caso("Port sem resposta", "Conversa antiga sem a hora da oferta: o relógio começa agora, sem mensagem", async () => {
    env.MAISA_FOLLOWUP_PORT = true;
    const c = await novaConversa(estadoPort(undefined));
    await svc.verificarOfertasPendentes();
    await svc.aguardarFilas();
    assert.ok((await estadoDe(c.id)).ofertaEm);
    assert.equal((await respostasMaisa(c.id)).length, 0);
  });
  caso("Port sem resposta", "Cliente respondeu à oferta: o relógio recomeça e não vai para o Carrinho", async () => {
    env.MAISA_FOLLOWUP_PORT = true;
    const c = await novaConversa(estadoPort(new Date(Date.now() + deslocamento - 23 * 3_600_000).toISOString()));
    await cliente(c.id, "bom dia");
    avancarRelogio(2 * 3_600_000);
    await svc.verificarOfertasPendentes();
    await svc.aguardarFilas();
    assert.equal((await conversaDe(c.id)).carrinhoEm, null);
  });

  // ---------- Modo sombra (fase 7, etapa 3) ----------
  // O interpretador real fica sem chave (OPENAI_API_KEY vazia): nenhuma chamada sai. Um motor falso
  // devolve o que o cenário pedir, para provar o que a camada nova faria sem enviar nada.
  const montagem = await import("../src/modules/maisa/conversa/montagem.js");
  const estadoContrato = (): EstadoMaisa => ({
    etapa: "numero_contrato", tentativas: 0, produto: "siape",
    alternativa: {
      operacao: "port_refin", trocoCentavos: 90000, motivo: "teste",
      digitacao: { banco: "104 - CEF", bancoCodigo: "104", parcela: 390.47, prazoRestante: 80, prazoOriginal: 120, saldoDevedor: 19000, port: { codigoTabela: 1, prazo: 96, contrato: 20000, parcela: 390, coeficiente: 0.02 }, refin: { codigoTabela: 1, prazo: 96, contrato: 20000, parcela: 390, coeficiente: 0.02 } },
    },
  });
  const META0 = { latenciaMs: 5, modelo: "falso", tokensEntrada: 10, tokensSaida: 5 };
  const registroFalso = (extra: Record<string, unknown> = {}) => ({
    modo: "sombra" as const, etapa: "numero_contrato", intencao: "aguardando_orientacao", confianca: 0.9, tom: "neutro", campos: [] as string[], descartados: 0,
    acao: "responder:explicar_proximo_passo", estrategia: "reformular", tentativa: 1, reformulou: true, fonteTexto: "reserva", falha: null,
    latenciaMs: 5, modelo: "falso", tokensEntrada: 10, tokensSaida: 5, rotuloReal: null, divergiu: null, textoSombra: null, ...extra,
  });
  const TEXTO_SOMBRA = "TEXTO-DA-SOMBRA Pode deixar, estou aguardando e falta só o número do contrato.";
  const motorFalso = (modo: "responder" | "erro") => ({
    async decidir() {
      if (modo === "erro") throw new Error("motor quebrou");
      return {
        tipo: "responder" as const, respostas: [TEXTO_SOMBRA], rotulo: "conversa_explicar_proximo_passo", interpretacao: {} as never,
        memoria: { perguntas: {}, orientacoes: [], irritacoes: 0, reclamacoesRepeticao: 0, baixaConfianca: 0, falhasModelo: 0, ajudasSemProgresso: 0 },
        registro: registroFalso(),
      };
    },
  });
  const comModo = async (modo: "desligado" | "sombra", fn: () => Promise<void>) => {
    const antes = env.MAISA_CONVERSA_MODO;
    env.MAISA_CONVERSA_MODO = modo;
    try {
      await fn();
    } finally {
      env.MAISA_CONVERSA_MODO = antes;
      montagem.substituirMotorParaTeste(null);
    }
  };
  const linhas = (id: string) => prisma.maisaInterpretacao.findMany({ where: { conversaId: id } });
  const resumo = async (id: string) => {
    const e = await estadoDe(id);
    return { etapa: e.etapa, tentativas: e.tentativas, respostas: (await respostasMaisa(id)).map((r) => r.conteudoTexto) };
  };

  caso("Modo sombra", "Desligado: comportamento antigo, nada gravado na tabela nova", async () => {
    await comModo("desligado", async () => {
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "Estou só esperando você");
      const r = await resumo(c.id);
      assert.deepEqual(r.respostas, [TEXTOS.numeroContratoInvalido]);
      assert.equal(await linhas(c.id).then((x) => x.length), 0);
    });
  });

  caso("Modo sombra", "Sombra: a resposta enviada é a mesma do modo desligado e a sombra nunca é enviada", async () => {
    let desligado: Awaited<ReturnType<typeof resumo>>;
    await comModo("desligado", async () => {
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "Estou só esperando você");
      desligado = await resumo(c.id);
    });
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("responder") as never);
      const enviadasAntes = evolution.textos.length;
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "Estou só esperando você");
      await montagem.aguardarSombras();
      const r = await resumo(c.id);
      assert.deepEqual(r, desligado!, "estado e respostas iguais ao modo desligado");
      assert.ok(!evolution.textos.some((t) => t.includes("TEXTO-DA-SOMBRA")), "texto da sombra foi enviado ao cliente");
      assert.equal(evolution.textos.length - enviadasAntes, 1, "só a resposta real sai pelo WhatsApp");
      assert.equal((await prisma.mensagem.findMany({ where: { conversaId: c.id, remetenteTipo: "maisa" } })).length, 1);
      assert.equal(await prisma.saidaMaisa.count({ where: { conversaId: c.id } }), 1);
    });
  });

  caso("Modo sombra", "Sombra não consulta, simula, autoriza nem digita", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("responder") as never);
      const antes = facta.chamadas.length;
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "pode digitar a proposta, eu autorizo");
      await montagem.aguardarSombras();
      assert.equal(facta.chamadas.length - antes, 0, "chamadas à Facta");
      assert.equal(await prisma.operacaoFacta.count({ where: { conversaId: c.id } }), 0);
      assert.equal(await prisma.proposta.count({ where: { conversaId: c.id } }), 0);
    });
  });

  caso("Modo sombra", "O registro permite achar a divergência e não guarda texto do cliente nem CPF", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("responder") as never);
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, `meu cpf é ${CPF_VALIDO} e estou só esperando você`);
      await montagem.aguardarSombras();
      const l = await linhas(c.id);
      assert.equal(l.length, 1);
      assert.equal(l[0].modo, "sombra");
      // O fluxo antigo leu o CPF como número do contrato (comportamento anterior à fase 7,
      // registrado como risco). O registro guarda a decisão antiga para comparar.
      assert.equal(l[0].rotuloReal, "numero_contrato", "decisão antiga");
      assert.equal(l[0].acao, "responder:explicar_proximo_passo", "decisão nova");
      assert.equal(l[0].divergiu, true);
      assert.ok(l[0].textoSombra?.startsWith("TEXTO-DA-SOMBRA"));
      const bruto = JSON.stringify(l[0]);
      assert.ok(!bruto.includes(CPF_VALIDO), "CPF no registro");
      assert.ok(!/esperando você/.test(bruto), "texto do cliente no registro");
      assert.ok(l[0].mensagemId, "liga a linha à mensagem");
    });
  });

  caso("Modo sombra", "Erro do motor da sombra não interrompe o atendimento", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("erro") as never);
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "Estou só esperando você");
      await montagem.aguardarSombras();
      const r = await resumo(c.id);
      assert.deepEqual(r.respostas, [TEXTOS.numeroContratoInvalido]);
      assert.equal(r.etapa, "numero_contrato");
    });
  });

  caso("Modo sombra", "Interpretador real sem chave: registra a falha, sem chamada externa, atendimento normal", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(null);
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "Estou só esperando você");
      await montagem.aguardarSombras();
      const r = await resumo(c.id);
      assert.deepEqual(r.respostas, [TEXTOS.numeroContratoInvalido]);
      const l = await linhas(c.id);
      assert.equal(l.length, 1);
      assert.equal(l[0].falha, "sem_chave");
      assert.equal(l[0].intencao, null);
      assert.equal(l[0].divergiu, false);
    });
  });

  caso("Modo sombra", "Interruptor: voltar para desligado para de gravar na hora", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("responder") as never);
      const c = await novaConversa(estadoContrato());
      await cliente(c.id, "oi, aguardando");
      await montagem.aguardarSombras();
      assert.equal((await linhas(c.id)).length, 1);
      env.MAISA_CONVERSA_MODO = "desligado";
      await cliente(c.id, "continuo aguardando");
      await montagem.aguardarSombras();
      assert.equal((await linhas(c.id)).length, 1, "gravou depois de desligar");
    });
  });

  caso("Modo sombra", "Sombra não guarda nem reaproveita cadastro anterior (só o modo ativo faz isso)", async () => {
    await comModo("sombra", async () => {
      montagem.substituirMotorParaTeste(motorFalso("responder") as never);
      const c = await novaConversa({ ...estadoContrato(), etapa: "coleta", contrato: { dados: { nome: "Maria da Silva" } as any, pergunta: "Qual é o seu RG?" } });
      await cliente(c.id, "quero falar com uma pessoa");
      await montagem.aguardarSombras();
      const e = await estadoDe(c.id);
      assert.equal((e as any).contratoSalvo, undefined);
    });
  });

  // ---------- execução ----------
  const lista = filtro ? casos.filter((c) => `${c.grupo} ${c.nome}`.toLowerCase().includes(filtro)) : casos;
  let ok = 0;
  const falhas: string[] = [];
  const porGrupo: Record<string, { ok: number; total: number }> = {};
  for (const c of lista) {
    reiniciarFalsos();
    (porGrupo[c.grupo] ??= { ok: 0, total: 0 }).total++;
    try {
      await c.fn();
      await svc.aguardarFilas();
      // Cada caso usa conversas novas. As de casos anteriores saem da Maisa para os jobs
      // do próximo caso não mexerem nelas.
      await prisma.conversa.updateMany({ where: { comMaisa: true }, data: { comMaisa: false } });
      ok++;
      porGrupo[c.grupo].ok++;
      if (verbose) console.log(`ok     [${c.grupo}] ${c.nome}`);
    } catch (err) {
      await svc.aguardarFilas().catch(() => {});
      falhas.push(`[${c.grupo}] ${c.nome}: ${err instanceof Error ? err.message : err}`);
      console.log(`FALHOU [${c.grupo}] ${c.nome}\n       ${err instanceof Error ? err.message.split("\n").slice(0, 6).join("\n       ") : err}`);
    }
  }
  console.log("\nPor grupo:");
  for (const [g, r] of Object.entries(porGrupo)) console.log(`  ${g}: ${r.ok}/${r.total}`);
  console.log(`\n${ok} de ${lista.length} passaram`);

  await prisma.$disconnect();
  io.close();
  srvApp.close();
  await fechar(servidorFacta);
  await fechar(servidorEvolution);
  await pg.stop();
  rmSync(dirPg, { recursive: true, force: true });
  process.exit(falhas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
