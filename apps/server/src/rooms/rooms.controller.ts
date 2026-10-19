import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import type { CurrentUser, JoinRoomResult, LeaveRoomResult, RoomDetails, RoomSummary } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { CreateRoomDto, UpdateRoomDto } from "./rooms.dto.js";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
@UseGuards(AccessTokenGuard)
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

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
  leaveRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<LeaveRoomResult> {
    return this.rooms.leaveRoom(roomId, user);
  }

  @Patch(":roomId")
  updateRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomDetails> {
    return this.rooms.updateRoom(roomId, user, dto);
  }

  @Delete(":roomId")
  @HttpCode(204)
  async closeRoom(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<void> {
    await this.rooms.closeRoom(roomId, user);
  }

  @Delete(":roomId/members/:userId")
  removeMember(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<RoomDetails> {
    return this.rooms.removeMember(roomId, userId, actor);
  }
}
