import fs from "fs";
import path from "path";
import multer from "multer";
import { env } from "../config/env.js";

const uploadsRoot = path.resolve(process.cwd(), env.UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const conversaId = req.body.conversaId || "sem-conversa";
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
