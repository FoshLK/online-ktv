import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { CurrentUser, PlaybackSnapshot } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { PlaybackControlDto, PreparePlaybackDto } from "./playback.dto.js";
import { PlaybackService } from "./playback.service.js";
import { RoomsGateway } from "./rooms.gateway.js";

@Controller("rooms/:roomId/playback")
@UseGuards(AccessTokenGuard)
export class PlaybackController {
  constructor(
    private readonly playback: PlaybackService,
    private readonly gateway: RoomsGateway,
  ) {}

  @Post("prepare")
  async prepare(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Body() dto: PreparePlaybackDto,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<PlaybackSnapshot> {
    const snapshot = await this.playback.prepare(roomId, dto.songId, user);
    this.gateway.broadcastPlaybackSnapshot(snapshot);
    await this.gateway.broadcastRoom(roomId);
    return snapshot;
  }

  @Post("control")
  async control(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Body() dto: PlaybackControlDto,
    @CurrentUserParam() user: CurrentUser,
  ): Promise<PlaybackSnapshot> {
    const transition = await this.playback.control(roomId, dto, user);
    this.gateway.broadcastPlaybackSnapshot(transition.snapshot);
    if (transition.command) this.gateway.broadcastPlaybackCommand(roomId, transition.command);
    await this.gateway.broadcastRoom(roomId);
    return transition.snapshot;
  }
}
