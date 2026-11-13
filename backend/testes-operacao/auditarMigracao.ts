// Auditoria da migração 20261113120000_maisa_interpretacoes em um Postgres 16 descartável
// (embutido, apagado ao terminar). Nunca toca em banco de produção.
// Uso: cd backend/testes-operacao && npx tsx auditarMigracao.ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { fileURLToPath } from "node:url";

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACAO = "20261113120000_maisa_interpretacoes";

let ok = 0;
let falhas = 0;
async function caso(nome: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`ok     ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`FALHOU ${nome}\n       ${e instanceof Error ? e.message : e}`);
  }
}

const dir = mkdtempSync(path.join(tmpdir(), "maisa-mig-"));
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "teste", password: "teste", port: 54332, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("mig");
  await pg.createDatabase("mig_sombra");
  const DB = "postgresql://teste:teste@127.0.0.1:54332/mig";
  Object.assign(process.env, { DATABASE_URL: DB, JWT_SECRET: "teste", OPENAI_API_KEY: "" });
  const run = (cmd: string) => execSync(cmd, { cwd: BACKEND, env: process.env, stdio: "pipe" }).toString();

  await caso("Migrações aplicam do zero em Postgres 16", async () => {
    const out = run("npx prisma migrate deploy");
    assert.match(out, new RegExp(MIGRACAO));
  });

  await caso("prisma migrate diff: migrações e schema.prisma idênticos", async () => {
    // --exit-code: sai com 2 (e o execSync lança) se houver qualquer diferença.
    const out = run(`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://teste:teste@127.0.0.1:54332/mig_sombra --exit-code`);
    assert.match(out, /No difference/i);
  });

  await caso("Histórico de migrações existentes não foi alterado", async () => {
    const mudou = execSync("git diff --name-status 3666115 HEAD -- prisma/migrations", { cwd: BACKEND }).toString().trim().split("\n").filter(Boolean);
    assert.deepEqual(mudou.map((l) => l.split(/\s+/)[0]), ["A"], `mudanças: ${mudou.join(" | ")}`);
    assert.match(mudou[0], new RegExp(MIGRACAO));
  });

  const { prisma } = await import("../src/db/prisma.js");

  await caso("Estrutura: colunas, tipos e nulabilidade", async () => {
    const cols = await prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'maisa_interpretacoes' ORDER BY ordinal_position`;
    const m = new Map(cols.map((c) => [c.column_name, c]));
    const esperado: Record<string, [string, "YES" | "NO"]> = {
      id: ["text", "NO"], conversa_id: ["text", "NO"], mensagem_id: ["text", "YES"], modo: ["text", "NO"], etapa: ["text", "NO"],
      intencao: ["text", "YES"], confianca: ["double precision", "YES"], tom: ["text", "YES"], campos: ["ARRAY", "YES"], descartados: ["integer", "NO"],
      acao: ["text", "NO"], estrategia: ["text", "YES"], tentativa: ["integer", "YES"], reformulou: ["boolean", "NO"], fonte_texto: ["text", "YES"],
      falha: ["text", "YES"], latencia_ms: ["integer", "YES"], modelo: ["text", "YES"], tokens_entrada: ["integer", "YES"], tokens_saida: ["integer", "YES"],
      rotulo_real: ["text", "YES"], divergiu: ["boolean", "YES"], texto_sombra: ["text", "YES"], created_at: ["timestamp without time zone", "NO"],
    };
    assert.deepEqual([...m.keys()].sort(), Object.keys(esperado).sort(), "conjunto de colunas");
    for (const [nome, [tipo, nulo]] of Object.entries(esperado)) {
      const c = m.get(nome)!;
      assert.equal(c.data_type, tipo, `tipo de ${nome}`);
      assert.equal(c.is_nullable, nulo, `nulabilidade de ${nome}`);
    }
    assert.match(m.get("created_at")!.column_default ?? "", /CURRENT_TIMESTAMP|now\(\)/i);
    assert.equal(m.get("descartados")!.column_default, "0");
    assert.equal(m.get("reformulou")!.column_default, "false");
  });

  await caso("Índices, chave primária e chave estrangeira com cascata", async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'maisa_interpretacoes'`;
    assert.deepEqual(idx.map((i) => i.indexname).sort(), [
      "maisa_interpretacoes_conversa_id_idx", "maisa_interpretacoes_created_at_idx", "maisa_interpretacoes_modo_created_at_idx", "maisa_interpretacoes_pkey",
    ]);
    const fk = await prisma.$queryRaw<{ tipo: string; ref: string }[]>`
      SELECT confdeltype::text AS tipo, confrelid::regclass::text AS ref FROM pg_constraint WHERE conname = 'maisa_interpretacoes_conversa_id_fkey'`;
    assert.equal(fk.length, 1);
    assert.equal(fk[0].tipo, "c", "ON DELETE CASCADE");
    assert.equal(fk[0].ref, "conversas");
  });

  await caso("Nada de CPF nem texto do cliente: nenhuma coluna para isso, só um texto livre curto", async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'maisa_interpretacoes'`;
    const nomes = cols.map((c) => c.column_name);
    for (const proibido of ["cpf", "texto", "conteudo", "mensagem", "nome", "telefone", "numero_whatsapp", "documento"]) {
      assert.ok(!nomes.includes(proibido), `coluna proibida: ${proibido}`);
    }
    // mensagem_id é só o identificador da mensagem. texto_sombra guarda o que a Maisa teria dito,
    // limitado a 500 caracteres pela aplicação (testado abaixo).
  });

  await caso("Gravação pela aplicação: texto_sombra limitado a 500 e sem dado do cliente", async () => {
    const { dadosDoRegistro } = await import("../src/modules/maisa/conversa/montagem.js");
    const contato = await prisma.contato.create({ data: { nome: "Teste", numeroWhatsapp: "5521999990001" } });
    const inst = await prisma.instancia.create({ data: { nome: "T", numero: "5521000000009", tipoConexao: "evolution", evolutionInstanceId: "x", maisaAtiva: true, status: "conectado" } });
    const conv = await prisma.conversa.create({ data: { instanciaId: inst.id, contatoId: contato.id, status: "aberta" } });
    const registro = {
      modo: "sombra" as const, etapa: "numero_contrato", intencao: "disponibilidade", confianca: 0.9, tom: "neutro", campos: [], descartados: 0, acao: "responder:continuar_com_orientacao",
      estrategia: "reformular", tentativa: 2, reformulou: true, fonteTexto: "reserva", falha: null, latenciaMs: 12.7, modelo: "falso", tokensEntrada: 10, tokensSaida: 5,
      rotuloReal: "numero_contrato_invalido", divergiu: true, textoSombra: "x".repeat(900),
    };
    const criada = await prisma.maisaInterpretacao.create({ data: dadosDoRegistro(conv.id, null, registro) });
    assert.equal(criada.textoSombra?.length, 500);
    assert.equal(criada.latenciaMs, 13);
    // Cascata: apagar a conversa apaga os registros.
    await prisma.conversa.delete({ where: { id: conv.id } });
    assert.equal(await prisma.maisaInterpretacao.count(), 0);
  });

  await caso("Retenção de 90 dias: a limpeza apaga o antigo e mantém o recente", async () => {
    const { limparConversa } = await import("../src/modules/maisa/conversa/montagem.js");
    const contato = await prisma.contato.create({ data: { nome: "Teste2", numeroWhatsapp: "5521999990002" } });
    const inst = await prisma.instancia.findFirstOrThrow();
    const conv = await prisma.conversa.create({ data: { instanciaId: inst.id, contatoId: contato.id, status: "aberta" } });
    const base = { conversaId: conv.id, modo: "ativo", etapa: "cpf", acao: "delegar:informar_dado", campos: [] as string[] };
    await prisma.maisaInterpretacao.create({ data: { ...base, createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    await prisma.maisaInterpretacao.create({ data: { ...base, createdAt: new Date(Date.now() - 89 * 86_400_000) } });
    await prisma.maisaInterpretacao.create({ data: { ...base } });
    const r = await limparConversa();
    assert.equal(r.registros, 1);
    assert.equal(await prisma.maisaInterpretacao.count(), 2);
  });

  await caso("Limpeza do cadastro anterior: apaga contratoSalvo vencido e preserva o resto do estado", async () => {
    const { limparConversa } = await import("../src/modules/maisa/conversa/montagem.js");
    const contato = await prisma.contato.create({ data: { nome: "Teste3", numeroWhatsapp: "5521999990003" } });
    const inst = await prisma.instancia.findFirstOrThrow();
    const velho = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const novo = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const a = await prisma.conversa.create({ data: { instanciaId: inst.id, contatoId: contato.id, status: "aberta", maisaEstado: { etapa: "inicio", tentativas: 0, contratoSalvo: { dados: { nome: "A" }, salvoEm: velho } } } });
    const contato2 = await prisma.contato.create({ data: { nome: "Teste4", numeroWhatsapp: "5521999990004" } });
    const b = await prisma.conversa.create({ data: { instanciaId: inst.id, contatoId: contato2.id, status: "aberta", maisaEstado: { etapa: "inicio", tentativas: 0, contratoSalvo: { dados: { nome: "B" }, salvoEm: novo } } } });
    const r = await limparConversa();
    assert.equal(r.cadastros, 1);
    const ea = (await prisma.conversa.findUniqueOrThrow({ where: { id: a.id } })).maisaEstado as Record<string, unknown>;
    const eb = (await prisma.conversa.findUniqueOrThrow({ where: { id: b.id } })).maisaEstado as Record<string, unknown>;
    assert.equal(ea.contratoSalvo, undefined);
    assert.equal(ea.etapa, "inicio");
    assert.ok(eb.contratoSalvo);
  });

  await caso("Rollback: remover a tabela não afeta nenhuma outra e a migração reaplica limpa", async () => {
    const antes = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`;
    await prisma.$executeRawUnsafe(`DROP TABLE "maisa_interpretacoes"`);
    const meio = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`;
    assert.equal(Number(meio[0].n), Number(antes[0].n) - 1);
    // Nada mais dependia da tabela: as conversas continuam lá.
    assert.ok((await prisma.conversa.count()) >= 2);
    // Reaplica o SQL da migração tal como está no repositório.
    const sql = readFileSync(path.join(BACKEND, "prisma/migrations", MIGRACAO, "migration.sql"), "utf-8");
    for (const comando of sql.split(/;\s*\n/).map((c) => c.trim()).filter((c) => c && !c.split("\n").every((l) => l.startsWith("--")))) {
      await prisma.$executeRawUnsafe(comando);
    }
    const depois = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`;
    assert.equal(Number(depois[0].n), Number(antes[0].n));
  });

  await prisma.$disconnect();
} finally {
  await pg.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${ok} de ${ok + falhas} passaram`);
process.exit(falhas ? 1 : 0);
