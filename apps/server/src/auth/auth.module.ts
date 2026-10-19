import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AuthService } from "./auth.service.js";
import { MailService } from "./mail.service.js";
import { RolesGuard } from "./roles.guard.js";
import { TokenService } from "./token.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, MailService, TokenService, AccessTokenGuard, RolesGuard],
  exports: [TokenService, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
