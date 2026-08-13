import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { InvalidCredentialsError, login } from "./auth.service.js";

const router = Router();

// Limita tentativas de login para dificultar força bruta contra senhas.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente em alguns minutos." },
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

router.post(
  "/login",
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dados inválidos", detalhes: parsed.error.flatten() });
    }

    try {
      const resultado = await login(parsed.data.email, parsed.data.senha);
      res.json(resultado);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        return res.status(401).json({ error: "E-mail ou senha inválidos" });
      }
      throw err;
    }
  }),
);

router.get("/me", authenticate, (req, res) => {
  res.json({ usuario: req.user });
});

export default router;
