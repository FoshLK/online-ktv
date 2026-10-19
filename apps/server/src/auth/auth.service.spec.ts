import assert from "node:assert/strict";
import test from "node:test";
import { hash as hashPassword, verify as verifyPassword } from "argon2";
import { AuthService } from "./auth.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { MailService } from "./mail.service.js";
import { TokenService } from "./token.service.js";

process.env.JWT_ACCESS_SECRET = "test-only-access-secret-with-more-than-thirty-two-characters";

test("register hashes the password and stores only a hashed email code", async () => {
  let createdUserData: Record<string, unknown> | undefined;
  let storedTokenHash = "";
  let deliveredCode = "";
  const prisma = {
    user: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdUserData = data;
        return { id: "user-1", email: String(data.email) };
      },
    },
    emailVerification: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { tokenHash: string } }) => {
        storedTokenHash = data.tokenHash;
        return data;
      },
    },
  } as unknown as PrismaService;
  const mail = {
    sendVerificationCode: async (_email: string, code: string) => {
      deliveredCode = code;
      return "development-log" as const;
    },
  } as unknown as MailService;
  const service = new AuthService(prisma, mail, new TokenService());

  const result = await service.register({ username: "测试用户", email: "USER@example.com", password: "password123" });

  assert.equal(result.email, "user@example.com");
  assert.equal(createdUserData?.usernameNormalized, "测试用户");
  assert.equal(await verifyPassword(String(createdUserData?.passwordHash), "password123"), true);
  assert.match(deliveredCode, /^\d{6}$/);
  assert.match(storedTokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedTokenHash, deliveredCode);
});

test("login issues a verifiable access token and stores a hashed refresh token", async () => {
  const passwordHash = await hashPassword("password123");
  let storedRefreshHash = "";
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    username: "tester",
    usernameNormalized: "tester",
    passwordHash,
    email: "tester@example.com",
    emailVerifiedAt: new Date(),
    role: "USER" as const,
    status: "ACTIVE" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    user: { findFirst: async () => user },
    userSession: {
      create: async ({ data }: { data: { refreshTokenHash: string } }) => {
        storedRefreshHash = data.refreshTokenHash;
        return data;
      },
    },
  } as unknown as PrismaService;
  const tokenService = new TokenService();
  const service = new AuthService(prisma, {} as MailService, tokenService);

  const session = await service.login(
    { login: "tester", password: "password123" },
    { ipAddress: "127.0.0.1", userAgent: "test" },
  );
  const payload = await tokenService.verifyAccessToken(session.accessToken);

  assert.equal(payload.sub, user.id);
  assert.equal(session.user.emailVerified, true);
  assert.match(storedRefreshHash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedRefreshHash, session.refreshToken);
});
