import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import type { CurrentUser, JoinRoomResult, LeaveRoomResult, RoomDetails, RoomSummary } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { CreateRoomDto, UpdateRoomDto } from "./rooms.dto.js";
import { RoomsGateway } from "./rooms.gateway.js";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
@UseGuards(AccessTokenGuard)
export class RoomsController {
  constructor(
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(RoomsGateway) private readonly gateway: RoomsGateway,
  ) {}

  @Get()
  listRooms(): Promise<RoomSummary[]> {
    return this.rooms.listActiveRooms();
  }

  @Post()
  createRoom(@CurrentUserParam() user: CurrentUser, @Body() dto: CreateRoomDto): Promise<RoomDetails> {
    return this.rooms.createRoom(user, dto);
  }

  @Get(":roomId")
  getRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<RoomDetails> {
    return this.rooms.getRoom(roomId, user);
  }

  @Post(":roomId/join")
  joinRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<JoinRoomResult> {
    return this.rooms.joinRoom(roomId, user);
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<LeaveRoomResult> {
    const result = await this.rooms.leaveRoom(roomId, user);
    if (result.roomClosed) {
      await this.gateway.closeRoomChannel(roomId, "房主已关闭房间");
    } else {
      await this.gateway.reconcileRoomAfterMembershipChange(roomId);
    }
    return result;
  }

  @Patch(":roomId")
  async updateRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomDetails> {
    const room = await this.rooms.updateRoom(roomId, user, dto);
    await this.gateway.broadcastRoom(roomId);
    return room;
  }

  @Delete(":roomId")
  @HttpCode(204)
  async closeRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<void> {
    await this.rooms.closeRoom(roomId, user);
    await this.gateway.closeRoomChannel(roomId, "房间已由房主或管理员关闭");
  }

  @Delete(":roomId/members/:userId")
  async removeMember(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<RoomDetails> {
    await this.rooms.removeMember(roomId, userId, actor);
    await this.gateway.evictUserFromRoom(roomId, userId, "你已被移出房间");
    return this.rooms.getRoomForBroadcast(roomId);
  }
}
