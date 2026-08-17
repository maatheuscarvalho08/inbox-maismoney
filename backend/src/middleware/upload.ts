import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env.js";

const uploadsRoot = path.resolve(process.cwd(), env.UPLOADS_DIR);

// Só aceita formato de UUID — impede que um conversaId malicioso (ex.: "../../etc")
// escape de uploadsRoot via path.join, já que o corpo do form ainda não foi validado
// pelo zod neste ponto (o Multer processa o destino antes do handler da rota rodar).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const conversaIdRaw = req.body.conversaId;
    const conversaId = typeof conversaIdRaw === "string" && UUID_RE.test(conversaIdRaw) ? conversaIdRaw : "sem-conversa";
    const dir = path.join(uploadsRoot, conversaId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const nomeSeguro = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    cb(null, nomeSeguro);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export { uploadsRoot };
