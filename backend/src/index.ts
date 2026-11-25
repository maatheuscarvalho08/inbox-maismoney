import http from "http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { initSocket } from "./ws/socket.js";
import { startMediaCleanupJob } from "./jobs/mediaCleanup.js";
import { startDiscadoraWorker } from "./queues/discadoraQueue.js";
import { startDisparoLoteWorker } from "./queues/disparoLoteQueue.js";
import { startFallbackEvolutionWorker } from "./queues/fallbackEvolutionQueue.js";
import { aguardarDespachos, startMaisaJobs } from "./modules/maisa/maisa.service.js";
import { prisma } from "./db/prisma.js";
import { startMonitor } from "./modules/alertas/monitor.js";

const server = http.createServer(app);
initSocket(server);
startMediaCleanupJob();
startDiscadoraWorker();
startDisparoLoteWorker();
startFallbackEvolutionWorker();
startMonitor();
startMaisaJobs();

server.listen(env.PORT, () => {
  console.log(`Backend rodando em http://localhost:${env.PORT}`);
});

async function desligar(sinal: string) {
  console.log(`${sinal} recebido — encerrando graciosamente...`);
  server.close(async () => {
    // Mensagem da Maisa no meio do envio termina antes de sair: um deploy não pode cortar a
    // entrega e mandar a conversa para a equipe como "envio interrompido".
    await Promise.race([aguardarDespachos(), new Promise((r) => setTimeout(r, 8_000))]).catch(() => undefined);
    await prisma.$disconnect();
    process.exit(0);
  });

  // Se algo travar (conexão pendente, etc.), força saída após 25s em vez de pendurar o container.
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
