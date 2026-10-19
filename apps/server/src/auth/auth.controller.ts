import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthSession, AuthTokens, CurrentUser, RegisterResponse } from "@ktv/contracts";
import type { Request } from "express";
import { AccessTokenGuard } from "./access-token.guard.js";
import { LoginDto, RefreshTokenDto, RegisterDto, ResendVerificationDto, VerifyEmailDto } from "./auth.dto.js";
import { AuthService } from "./auth.service.js";
import { CurrentUserParam } from "./current-user.decorator.js";
import { Roles, RolesGuard } from "./roles.guard.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.auth.register(dto);
  }

  @Post("verify-email")
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ verified: true }> {
    return this.auth.verifyEmail(dto.email, dto.code);
  }

  @Post("resend-verification")
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthSession> {
    return this.auth.login(dto, this.sessionContext(request));
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken, this.sessionContext(request));
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  me(@CurrentUserParam() user: CurrentUser): CurrentUser {
    return user;
  }

  @Get("admin-session")
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  adminSession(@CurrentUserParam() user: CurrentUser): CurrentUser {
    return user;
  }

  private sessionContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get("user-agent")?.slice(0, 500),
    };
  }
}
