-- Quem da equipe já viu a conversa desde a última mensagem do cliente. Zerada
-- (linhas apagadas) sempre que chega mensagem nova dele.
CREATE TABLE "conversa_visualizacoes" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "visto_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversa_visualizacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversa_visualizacoes_conversa_id_usuario_id_key" ON "conversa_visualizacoes"("conversa_id", "usuario_id");

ALTER TABLE "conversa_visualizacoes" ADD CONSTRAINT "conversa_visualizacoes_conversa_id_fkey"
  FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversa_visualizacoes" ADD CONSTRAINT "conversa_visualizacoes_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
