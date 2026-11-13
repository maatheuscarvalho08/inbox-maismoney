-- Fase 7: registro da interpretação conversacional. Só acrescenta uma tabela.
-- Não guarda texto do cliente nem CPF.
CREATE TABLE "maisa_interpretacoes" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "mensagem_id" TEXT,
    "modo" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "intencao" TEXT,
    "confianca" DOUBLE PRECISION,
    "tom" TEXT,
    "campos" TEXT[],
    "descartados" INTEGER NOT NULL DEFAULT 0,
    "acao" TEXT NOT NULL,
    "estrategia" TEXT,
    "tentativa" INTEGER,
    "reformulou" BOOLEAN NOT NULL DEFAULT false,
    "fonte_texto" TEXT,
    "falha" TEXT,
    "latencia_ms" INTEGER,
    "modelo" TEXT,
    "tokens_entrada" INTEGER,
    "tokens_saida" INTEGER,
    "rotulo_real" TEXT,
    "divergiu" BOOLEAN,
    "texto_sombra" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maisa_interpretacoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maisa_interpretacoes_conversa_id_idx" ON "maisa_interpretacoes"("conversa_id");
CREATE INDEX "maisa_interpretacoes_created_at_idx" ON "maisa_interpretacoes"("created_at");
CREATE INDEX "maisa_interpretacoes_modo_created_at_idx" ON "maisa_interpretacoes"("modo", "created_at");

ALTER TABLE "maisa_interpretacoes" ADD CONSTRAINT "maisa_interpretacoes_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
