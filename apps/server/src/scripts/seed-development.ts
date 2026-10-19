import { argon2id, hash as hashPassword } from "argon2";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { PrismaService } from "../database/prisma.service.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const credentialsDirectory = fileURLToPath(new URL("../../../../data/", import.meta.url));
const credentialsPath = fileURLToPath(new URL("../../../../data/dev-admin-credentials.txt", import.meta.url));
const username = "dev-admin";
const email = "admin@local.ktv";
const password = randomBytes(18).toString("base64url");

const prisma = new PrismaService();

try {
  const passwordHash = await hashPassword(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.$connect();
  await prisma.user.upsert({
    where: { email },
    create: {
      username,
      usernameNormalized: username,
      email,
      passwordHash,
      emailVerifiedAt: new Date(),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    update: {
      passwordHash,
      emailVerifiedAt: new Date(),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  await mkdir(credentialsDirectory, { recursive: true });
  await writeFile(
    credentialsPath,
    [
      "# 仅用于本机开发，data/ 已被 Git 忽略。重新运行 seed 会轮换密码。",
      `username=${username}`,
      `email=${email}`,
      `password=${password}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  console.info(`开发超级管理员已就绪，凭据保存在：${credentialsPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
