import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { PrismaService } from "../database/prisma.service.js";

loadEnv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const identifier = process.argv[2]?.trim().toLowerCase();
if (!identifier) {
  console.error("用法：npm run admin:promote -- <用户名或邮箱>");
  process.exitCode = 1;
} else {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { usernameNormalized: identifier }] },
      select: { id: true, username: true, email: true, emailVerifiedAt: true, role: true },
    });
    if (!user) throw new Error("找不到该用户，请先在用户端完成注册");
    if (!user.emailVerifiedAt) throw new Error("该用户尚未完成邮箱验证");
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
      select: { username: true, email: true, role: true },
    });
    console.info(`已授予管理员权限：${updated.username} <${updated.email}> (${updated.role})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
