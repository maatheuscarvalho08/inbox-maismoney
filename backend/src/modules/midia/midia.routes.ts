import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validarAssinaturaMidia } from "../../lib/signedUrl.js";
import { env } from "../../config/env.js";

const router = Router();

router.get(
  "/:mensagemId",
  asyncHandler(async (req, res) => {
    const { mensagemId } = req.params;
    const { exp, sig } = req.query;

    // URL assinada = Meta/Evolution buscando a mídia pra entregar ao cliente.
    const viaAssinatura =
      typeof exp === "string" && typeof sig === "string" && validarAssinaturaMidia(mensagemId, Number(exp), sig);
    let autorizado = viaAssinatura;

    if (!autorizado) {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      if (token) {
        try {
          const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string };
          // Mesma regra do middleware authenticate: usuário desativado perde o acesso
          // na hora, não só quando o token expirar.
          const usuario = payload.sub ? await prisma.usuario.findUnique({ where: { id: payload.sub } }) : null;
          autorizado = Boolean(usuario?.ativo);
        } catch {
          autorizado = false;
        }
      }
    }

    if (!autorizado) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    const mensagem = await prisma.mensagem.findUnique({ where: { id: mensagemId } });
    if (!mensagem || !mensagem.midiaPath || mensagem.midiaDeleted) {
      return res.status(404).json({ error: "Mídia não disponível" });
    }

    const absPath = path.resolve(process.cwd(), mensagem.midiaPath);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: "Arquivo não encontrado" });
    }

    // ?baixar=jpg força download como JPG mesmo que o original seja PNG/WEBP
    // (sticker, print de tela) — o operador só precisa clicar em "Baixar" na
    // conversa, sem se preocupar com o formato que o WhatsApp mandou de verdade.
    if (req.query.baixar === "jpg" && mensagem.tipoMidia?.startsWith("image/")) {
      const buffer = await sharp(absPath).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
      res.setHeader("Content-Disposition", `attachment; filename="${mensagemId}.jpg"`);
      res.type("image/jpeg").send(buffer);
      return;
    }

    // Documento mandado pelo cliente pode ser qualquer coisa (ex.: um .html com
    // script). Servido com o tipo original, abrir no navegador rodaria o script na
    // origem do app e roubaria o token do operador — então, pro navegador, só
    // imagem/áudio/vídeo saem com o tipo real; o resto sai como download binário.
    // SVG é imagem, mas pode carregar script, então entra na regra do download.
    // Meta/Evolution (URL assinada) continuam recebendo o tipo real, que elas usam
    // pra validar o anexo — o sandbox impede script se alguém abrir esse link.
    res.setHeader("Content-Security-Policy", "sandbox");
    const tipo = mensagem.tipoMidia ?? "";
    const exibivel = /^(image|audio|video)\//.test(tipo) && !tipo.startsWith("image/svg");
    if (!exibivel && !viaAssinatura) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${mensagemId}${path.extname(absPath)}"`);
      fs.createReadStream(absPath).pipe(res);
      return;
    }

    res.sendFile(absPath);
  }),
);

export default router;
