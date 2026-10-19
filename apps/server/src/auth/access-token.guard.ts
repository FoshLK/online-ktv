import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CurrentUser } from "@ktv/contracts";
import type { AuthenticatedRequest } from "./current-user.decorator.js";
import { PrismaService } from "../database/prisma.service.js";
import { TokenService } from "./token.service.js";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException("请先登录");

    try {
      const payload = await this.tokens.verifyAccessToken(authorization.slice(7));
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new Error("Inactive user");
      request.currentUser = this.toCurrentUser(user);
      return true;
    } catch {
      throw new UnauthorizedException("登录状态已失效");
    }
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
}
