import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { alertasAtivos, podeVerAlertas } from "./monitor.js";

const router = Router();

// Alertas do sistema ativos agora. Quem não está em ALERTAS_EMAILS recebe a lista vazia.
router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({ alertas: (await podeVerAlertas(req.user!.id)) ? alertasAtivos() : [] });
  } catch (err) {
    next(err);
  }
});

export default router;
