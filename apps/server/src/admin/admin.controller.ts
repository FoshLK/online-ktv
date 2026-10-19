import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from "@nestjs/common";
import type { AdminOverview, AdminUserList, AdminUserSummary, CurrentUser } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { Roles, RolesGuard } from "../auth/roles.guard.js";
import { AdminUpdateUserDto, AdminUserQueryDto } from "./admin.dto.js";
import { AdminService } from "./admin.service.js";

@Controller("admin")
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  getOverview(): Promise<AdminOverview> {
    return this.admin.getOverview();
  }

  @Get("users")
  listUsers(@Query() query: AdminUserQueryDto): Promise<AdminUserList> {
    return this.admin.listUsers(query);
  }

  @Patch("users/:userId")
  updateUser(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<AdminUserSummary> {
    return this.admin.updateUser(userId, dto, actor);
  }
}
