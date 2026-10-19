import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthSession, AuthTokens, CurrentUser, RegisterResponse } from "@ktv/contracts";
import { argon2id, hash as hashPassword, verify as verifyPassword } from "argon2";
import { createHash, randomInt } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { LoginDto, RegisterDto } from "./auth.dto.js";
import { MailService, type MailDelivery } from "./mail.service.js";
import { TokenService } from "./token.service.js";

interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const username = dto.username.trim();
    const usernameNormalized = username.toLocaleLowerCase("zh-CN");
    const email = dto.email.toLowerCase();
    const passwordHash = await hashPassword(dto.password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    let user: { id: string; email: string };
    try {
      user = await this.prisma.user.create({
        data: { username, usernameNormalized, email, passwordHash },
        select: { id: true, email: true },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException("用户名或邮箱已被使用");
      throw error;
    }

    const delivery = await this.createAndSendVerification(user.id, user.email);
    return { userId: user.id, email: user.email, verificationRequired: true, delivery };
  }

  async verifyEmail(email: string, code: string): Promise<{ verified: true }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new BadRequestException("验证码无效或已过期");
    if (user.emailVerifiedAt) return { verified: true };

    const tokenHash = this.hashVerificationCode(user.id, code);
    const verification = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!verification) throw new BadRequestException("验证码无效或已过期");

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailVerification.update({ where: { id: verification.id }, data: { usedAt: new Date() } }),
    ]);
    return { verified: true };
  }

  async resendVerification(email: string): Promise<{ accepted: true; delivery: MailDelivery }> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || user.emailVerifiedAt) return { accepted: true, delivery: this.defaultDelivery() };
    const delivery = await this.createAndSendVerification(user.id, normalizedEmail);
    return { accepted: true, delivery };
  }

  async login(dto: LoginDto, context: SessionContext): Promise<AuthSession> {
    const login = dto.login.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: login }, { usernameNormalized: login }] },
    });
    if (!user || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("用户名、邮箱或密码错误");
    }
    if (user.status !== "ACTIVE") throw new ForbiddenException("账号当前不可用");
    if (!user.emailVerifiedAt) throw new ForbiddenException("请先完成邮箱验证");

    const currentUser = this.toCurrentUser(user);
    const tokenResult = await this.createSession(currentUser, context);
    return { user: currentUser, ...tokenResult };
  }

  async refresh(refreshToken: string, context: SessionContext): Promise<AuthTokens> {
    const refreshTokenHash = this.tokens.hashOpaqueToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== "ACTIVE" ||
      !session.user.emailVerifiedAt
    ) {
      throw new UnauthorizedException("刷新令牌无效或已过期");
    }

    const nextRefresh = this.tokens.issueRefreshToken();
    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.userSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException("刷新令牌已被使用");
      await transaction.userSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: nextRefresh.hash,
          expiresAt: nextRefresh.expiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });

    return {
      accessToken: await this.tokens.issueAccessToken(this.toCurrentUser(session.user)),
      refreshToken: nextRefresh.token,
      accessTokenExpiresInSeconds: this.tokens.accessTokenExpiresInSeconds,
      refreshTokenExpiresAt: nextRefresh.expiresAt.toISOString(),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { refreshTokenHash: this.tokens.hashOpaqueToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(user: CurrentUser, context: SessionContext): Promise<AuthTokens> {
    const refresh = this.tokens.issueRefreshToken();
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    return {
      accessToken: await this.tokens.issueAccessToken(user),
      refreshToken: refresh.token,
      accessTokenExpiresInSeconds: this.tokens.accessTokenExpiresInSeconds,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  private async createAndSendVerification(userId: string, email: string): Promise<MailDelivery> {
    const code = randomInt(100_000, 1_000_000).toString();
    await this.prisma.emailVerification.deleteMany({ where: { userId, usedAt: null } });
    await this.prisma.emailVerification.create({
      data: {
        userId,
        tokenHash: this.hashVerificationCode(userId, code),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    return this.mail.sendVerificationCode(email, code);
  }

  private hashVerificationCode(userId: string, code: string): string {
    return createHash("sha256").update(`${userId}:${code}`).digest("hex");
  }

  private toCurrentUser(user: {
    id: string;
    username: string;
    email: string;
    emailVerifiedAt: Date | null;
    role: CurrentUser["role"];
    status: CurrentUser["status"];
  }): CurrentUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      role: user.role,
      status: user.status,
    };
  }

  private defaultDelivery(): MailDelivery {
    return process.env.SMTP_AUTH_CODE ? "smtp" : "development-log";
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }
}
