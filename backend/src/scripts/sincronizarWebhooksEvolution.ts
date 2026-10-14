// Reaponta o webhook de todas as instâncias Evolution cadastradas para a URL atual
// (com o EVOLUTION_WEBHOOK_TOKEN do ambiente). Rodar ANTES de colocar o token no
// .env do backend, passando ele só pra este processo:
//
//   docker compose -f docker-compose.prod.yml exec -e EVOLUTION_WEBHOOK_TOKEN=xxx \
//     backend node dist/scripts/sincronizarWebhooksEvolution.js
//
// Assim a Evolution já passa a mandar o token enquanto o backend ainda aceita sem
// ele — nenhuma mensagem é recusada na troca.
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { configurarWebhookEvolution, mensagemErroEvolution } from "../integrations/evolutionApi.js";

async function main() {
  if (!env.EVOLUTION_WEBHOOK_TOKEN) {
    throw new Error("Passe EVOLUTION_WEBHOOK_TOKEN para este comando (-e EVOLUTION_WEBHOOK_TOKEN=...)");
  }

  const instancias = await prisma.instancia.findMany({
    where: { tipoConexao: "evolution", evolutionInstanceId: { not: null } },
  });

  let falhas = 0;
  for (const instancia of instancias) {
    try {
      await configurarWebhookEvolution(instancia.evolutionInstanceId!);
      console.log(`OK: ${instancia.nome} (${instancia.evolutionInstanceId})`);
    } catch (err) {
      falhas++;
      console.error(`FALHOU: ${instancia.nome} (${instancia.evolutionInstanceId}): ${mensagemErroEvolution(err)}`);
    }
  }

  console.log(`${instancias.length - falhas}/${instancias.length} instância(s) atualizada(s).`);
  if (falhas > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
