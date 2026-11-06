-- AlterTable
ALTER TABLE "conversas" ADD COLUMN     "com_maisa" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "instancias" ADD COLUMN     "maisa_ativa" BOOLEAN NOT NULL DEFAULT false;
