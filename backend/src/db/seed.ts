import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

async function main() {
  const nome = process.env.ADMIN_NOME ?? "Admin";
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;

  if (!email || !senha) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_SENHA no .env antes de rodar o seed");
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nome, email, senhaHash, role: "admin" },
  });

  console.log(`Usuario admin pronto: ${usuario.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
