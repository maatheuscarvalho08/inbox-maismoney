-- AlterTable
ALTER TABLE "mensagens" ADD COLUMN "analise_resumo" TEXT;

-- CreateTable
CREATE TABLE "analises_extrato" (
    "mensagem_id" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "origem" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analises_extrato_pkey" PRIMARY KEY ("mensagem_id")
);

-- AddForeignKey
ALTER TABLE "analises_extrato" ADD CONSTRAINT "analises_extrato_mensagem_id_fkey" FOREIGN KEY ("mensagem_id") REFERENCES "mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
