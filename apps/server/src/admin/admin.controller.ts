import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  AdminAuditLogList,
  AdminImportJobList,
  AdminOverview,
  AdminPlaybackHistoryList,
  AdminRoomCloseResult,
  AdminRoomList,
  AdminUserList,
  AdminUserSummary,
  CurrentUser,
  RoomDetails,
} from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { Roles, RolesGuard } from "../auth/roles.guard.js";
import { RoomsGateway } from "../rooms/rooms.gateway.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { AdminListQueryDto, AdminRoomActionDto, AdminUpdateUserDto, AdminUserQueryDto } from "./admin.dto.js";
import { AdminService } from "./admin.service.js";

@Controller("admin")
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(RoomsGateway) private readonly gateway: RoomsGateway,
  ) {}

  @Get("overview")
  getOverview(): Promise<AdminOverview> {
    return this.admin.getOverview();
  }

  @Get("rooms")
  listRooms(): Promise<AdminRoomList> {
    return this.admin.listRooms();
  }

  @Post("rooms/:roomId/close")
  async closeRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Body() dto: AdminRoomActionDto,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<AdminRoomCloseResult> {
    const result = await this.admin.closeRoom(roomId, dto, actor);
    await this.gateway.closeRoomChannel(roomId, `房间已由管理员关闭：${dto.reason}`);
    return result;
  }

  @Post("rooms/:roomId/members/:userId/remove")
  async removeRoomMember(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: AdminRoomActionDto,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<RoomDetails> {
    await this.admin.removeRoomMember(roomId, userId, dto, actor);
    await this.gateway.evictUserFromRoom(roomId, userId, `你已被管理员移出房间：${dto.reason}`);
    return this.rooms.getRoomForBroadcast(roomId);
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

  @Get("import-jobs")
  listImportJobs(@Query() query: AdminListQueryDto): Promise<AdminImportJobList> {
    return this.admin.listImportJobs(query);
  }

  @Get("playback-history")
  listPlaybackHistory(@Query() query: AdminListQueryDto): Promise<AdminPlaybackHistoryList> {
    return this.admin.listPlaybackHistory(query);
  }

  @Get("audit-logs")
  listAuditLogs(@Query() query: AdminListQueryDto): Promise<AdminAuditLogList> {
    return this.admin.listAuditLogs(query);
  }
}
