import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RoomPresenceService } from "./room-presence.service.js";
import { RoomsController } from "./rooms.controller.js";
import { RoomsGateway } from "./rooms.gateway.js";
import { RoomsService } from "./rooms.service.js";
import { PlaybackController } from "./playback.controller.js";
import { PlaybackService } from "./playback.service.js";

@Module({
  imports: [AuthModule],
  controllers: [RoomsController, PlaybackController],
  providers: [RoomPresenceService, RoomsService, PlaybackService, RoomsGateway],
  exports: [RoomPresenceService, RoomsService, PlaybackService, RoomsGateway],
})
export class RoomsModule {}
