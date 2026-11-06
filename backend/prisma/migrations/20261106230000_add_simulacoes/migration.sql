-- CreateEnum
CREATE TYPE "ResultadoSimulacao" AS ENUM ('com_saldo', 'sem_saldo', 'erro');

-- CreateTable
CREATE TABLE "simulacoes" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "operador_id" TEXT,
    "banco" TEXT NOT NULL,
    "convenio" "Convenio",
    "resultado" "ResultadoSimulacao" NOT NULL,
    "valor_centavos" INTEGER,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulacoes_conversa_id_idx" ON "simulacoes"("conversa_id");

-- CreateIndex
CREATE INDEX "simulacoes_created_at_idx" ON "simulacoes"("created_at");

-- AddForeignKey
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulacoes" ADD CONSTRAINT "simulacoes_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
