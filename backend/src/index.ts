import http from "http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { initSocket } from "./ws/socket.js";
import { startMediaCleanupJob } from "./jobs/mediaCleanup.js";
import { startDiscadoraWorker } from "./queues/discadoraQueue.js";
import { startDisparoLoteWorker } from "./queues/disparoLoteQueue.js";
import { prisma } from "./db/prisma.js";

const server = http.createServer(app);
initSocket(server);
startMediaCleanupJob();
startDiscadoraWorker();
startDisparoLoteWorker();

server.listen(env.PORT, () => {
  console.log(`Backend rodando em http://localhost:${env.PORT}`);
});

async function desligar(sinal: string) {
  console.log(`${sinal} recebido — encerrando graciosamente...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  // Se algo travar (conexão pendente, etc.), força saída após 10s em vez de pendurar o container.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
