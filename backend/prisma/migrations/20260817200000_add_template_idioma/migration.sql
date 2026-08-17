-- Templates aprovados na Meta podem ter idioma diferente de pt_BR (ex.: cadastrados
-- errado como "en" mas com texto em português) — a Meta exige bater o idioma exato
-- do template aprovado no envio, então isso não pode ficar fixo no código.
ALTER TABLE "templates" ADD COLUMN "idioma" TEXT NOT NULL DEFAULT 'pt_BR';
