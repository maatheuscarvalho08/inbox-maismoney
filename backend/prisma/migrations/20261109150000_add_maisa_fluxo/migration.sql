-- AlterEnum
ALTER TYPE "RemetenteTipo" ADD VALUE 'maisa';

-- AlterTable
ALTER TABLE "conversas" ADD COLUMN     "maisa_estado" JSONB;

-- CreateTable
CREATE TABLE "maisa_eventos" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "etapa_antes" TEXT,
    "etapa_depois" TEXT NOT NULL,
    "rotulo" TEXT,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maisa_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maisa_eventos_conversa_id_idx" ON "maisa_eventos"("conversa_id");

-- CreateIndex
CREATE INDEX "maisa_eventos_created_at_idx" ON "maisa_eventos"("created_at");

-- AddForeignKey
ALTER TABLE "maisa_eventos" ADD CONSTRAINT "maisa_eventos_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

