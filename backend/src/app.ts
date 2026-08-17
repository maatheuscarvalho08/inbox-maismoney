import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import conversasRoutes from "./modules/conversas/conversas.routes.js";
import mensagensRoutes from "./modules/mensagens/mensagens.routes.js";
import instanciasRoutes from "./modules/instancias/instancias.routes.js";
import templatesRoutes from "./modules/templates/templates.routes.js";
import disparosRoutes from "./modules/disparos/disparos.routes.js";
import metricasRoutes from "./modules/metricas/metricas.routes.js";
import usuariosRoutes from "./modules/usuarios/usuarios.routes.js";
import etiquetasRoutes from "./modules/etiquetas/etiquetas.routes.js";
import configRoutes from "./modules/config/config.routes.js";
import midiaRoutes from "./modules/midia/midia.routes.js";
import evolutionWebhookRoutes from "./modules/webhooks/evolution.routes.js";
import metaWebhookRoutes from "./modules/webhooks/meta.routes.js";

export const app = express();

// Roda atrás do Nginx na VPS — necessário para IP real (rate limit) e cookies/https corretos.
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Camada extra de proteção contra loop de script/uso abusivo de um token vazado.
// Webhooks ficam de fora porque precisam aceitar rajadas normais da Evolution API / Meta.
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/api/webhooks"),
});
app.use("/api", apiRateLimit);

app.use("/api/auth", authRoutes);
app.use("/api/conversas", conversasRoutes);
app.use("/api/mensagens", mensagensRoutes);
app.use("/api/instancias", instanciasRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/disparos", disparosRoutes);
app.use("/api/metricas", metricasRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/etiquetas", etiquetasRoutes);
app.use("/api/config", configRoutes);
app.use("/api/midia", midiaRoutes);
app.use("/api/webhooks", evolutionWebhookRoutes);
app.use("/api/webhooks", metaWebhookRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
});
