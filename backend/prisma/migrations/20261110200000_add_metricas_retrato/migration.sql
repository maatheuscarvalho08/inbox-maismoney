-- CreateTable
CREATE TABLE "metricas_retratos" (
    "id" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metricas_retratos_pkey" PRIMARY KEY ("id")
);
