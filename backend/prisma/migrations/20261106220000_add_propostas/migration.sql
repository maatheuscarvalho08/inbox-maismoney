-- CreateEnum
CREATE TYPE "StatusProposta" AS ENUM ('digitada', 'em_analise', 'aprovada', 'paga', 'recusada', 'cancelada');

-- CreateTable
CREATE TABLE "propostas" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "operador_id" TEXT,
    "banco" TEXT NOT NULL,
    "convenio" "Convenio",
    "valor_centavos" INTEGER NOT NULL,
    "parcela_centavos" INTEGER,
    "prazo_meses" INTEGER,
    "numero_contrato" TEXT,
    "status" "StatusProposta" NOT NULL DEFAULT 'digitada',
    "motivo_recusa" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "propostas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "propostas_conversa_id_idx" ON "propostas"("conversa_id");

-- CreateIndex
CREATE INDEX "propostas_status_created_at_idx" ON "propostas"("status", "created_at");

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
