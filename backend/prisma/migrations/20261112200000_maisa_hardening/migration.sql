-- Hardening da Maisa (fases 5 e 6.1). Acrescenta colunas e tabelas; os dados existentes
-- só recebem dois ajustes, ambos no fim: a marca da última mensagem lida e a saída da
-- Maisa de conversas já finalizadas.

-- Versão do estado e lease do processamento.
ALTER TABLE "conversas" ADD COLUMN "maisa_versao" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "conversas" ADD COLUMN "maisa_lease_ate" TIMESTAMP(3);
ALTER TABLE "conversas" ADD COLUMN "maisa_lease_dono" TEXT;

-- Tentativas de entrega de cada mensagem.
ALTER TABLE "mensagens" ADD COLUMN "tentativas_entrega" INTEGER NOT NULL DEFAULT 0;

-- Digitações na Facta.
CREATE TABLE "operacoes_facta" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "versao_dados" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparada',
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "etapa" TEXT,
    "codigo_af" TEXT,
    "url" TEXT,
    "erro" TEXT,
    "irreversivel_em" TIMESTAMP(3),
    "liberada_por" TEXT,
    "liberada_em" TIMESTAMP(3),
    "motivo_liberacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operacoes_facta_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "operacoes_facta_status_check" CHECK ("status" IN ('preparada', 'irreversivel', 'concluida', 'falhou', 'desconhecida', 'invalidada', 'liberada')),
    -- Liberação sempre com quem liberou e por quê.
    CONSTRAINT "operacoes_facta_liberacao_check" CHECK ("status" <> 'liberada' OR ("liberada_por" IS NOT NULL AND "motivo_liberacao" IS NOT NULL))
);
CREATE UNIQUE INDEX "operacoes_facta_chave_key" ON "operacoes_facta"("chave");
CREATE INDEX "operacoes_facta_conversa_id_idx" ON "operacoes_facta"("conversa_id");
CREATE INDEX "operacoes_facta_cpf_status_idx" ON "operacoes_facta"("cpf", "status");
CREATE INDEX "operacoes_facta_status_updated_at_idx" ON "operacoes_facta"("status", "updated_at");
-- Restrict: o rastro da digitação não some quando alguém apaga a conversa.
ALTER TABLE "operacoes_facta" ADD CONSTRAINT "operacoes_facta_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fila de saída da Maisa.
CREATE TABLE "saidas_maisa" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "mensagem_id" TEXT NOT NULL,
    "ordem" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "travado_ate" TIMESTAMP(3),
    "travado_por" TEXT,
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "saidas_maisa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saidas_maisa_status_check" CHECK ("status" IN ('pendente', 'processando', 'enviado', 'falhou', 'incerto'))
);
CREATE UNIQUE INDEX "saidas_maisa_mensagem_id_key" ON "saidas_maisa"("mensagem_id");
CREATE INDEX "saidas_maisa_status_proxima_em_idx" ON "saidas_maisa"("status", "proxima_em");
CREATE INDEX "saidas_maisa_conversa_id_ordem_idx" ON "saidas_maisa"("conversa_id", "ordem");
ALTER TABLE "saidas_maisa" ADD CONSTRAINT "saidas_maisa_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversas que a Maisa já atendia ganham a marca da última mensagem do cliente que já
-- teve resposta (da Maisa ou da equipe). Mensagens depois da última resposta ficam como
-- não lidas: a recuperação lê, em vez de perdê-las (podem ter chegado durante o deploy).
UPDATE "conversas" c
SET "maisa_estado" = c."maisa_estado" || jsonb_build_object(
      'ultimaMensagemId', m."id",
      'ultimaMensagemEm', to_char(m."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM (
  SELECT DISTINCT ON (cl."conversa_id") cl."conversa_id", cl."id", cl."created_at"
  FROM "mensagens" cl
  LEFT JOIN (
    SELECT "conversa_id", max("created_at") AS ultima_resposta
    FROM "mensagens" WHERE "remetente_tipo" IN ('maisa', 'operador') GROUP BY "conversa_id"
  ) r ON r."conversa_id" = cl."conversa_id"
  WHERE cl."remetente_tipo" = 'cliente' AND r.ultima_resposta IS NOT NULL AND cl."created_at" <= r.ultima_resposta
  ORDER BY cl."conversa_id", cl."created_at" DESC, cl."id" DESC
) m
WHERE m."conversa_id" = c."id"
  AND jsonb_typeof(c."maisa_estado") = 'object'
  AND NOT (c."maisa_estado" ? 'ultimaMensagemEm');
-- Sem nenhuma mensagem respondida: a marca fica na criação da conversa.
UPDATE "conversas" c
SET "maisa_estado" = c."maisa_estado" || jsonb_build_object('ultimaMensagemEm', to_char(c."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
WHERE jsonb_typeof(c."maisa_estado") = 'object'
  AND NOT (c."maisa_estado" ? 'ultimaMensagemEm');

-- Conversa finalizada pela Maisa não pode continuar com ela. Ajusta o que já existir e
-- o banco passa a recusar esse estado.
UPDATE "conversas" SET "com_maisa" = false WHERE "com_maisa" AND "maisa_estado"->>'etapa' = 'finalizada';
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_finalizada_fora_da_maisa"
  CHECK (NOT ("com_maisa" AND COALESCE("maisa_estado"->>'etapa', '') = 'finalizada'));
