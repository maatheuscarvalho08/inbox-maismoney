import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env.js";

// Áudio de campanha é reutilizável entre campanhas e não segue a regra de deleção de
// 4 dias (essa regra só se aplica a mídia de conversa, ligada a mensagens) — por isso
// fica numa pasta própria, fora de qualquer conversaId, e o job de limpeza nunca a toca
// porque só consulta midiaPath em `mensagens`.
const audioDir = path.resolve(process.cwd(), env.UPLOADS_DIR, "campanhas");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(audioDir, { recursive: true });
    cb(null, audioDir);
  },
  filename: (_req, file, cb) => {
    const nomeSeguro = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    cb(null, nomeSeguro);
  },
});

export const uploadAudio = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      cb(new Error("Envie um arquivo de áudio"));
      return;
    }
    cb(null, true);
  },
});
