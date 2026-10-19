import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SongsController } from "./songs.controller.js";
import { SongsService } from "./songs.service.js";

@Module({
  imports: [AuthModule],
  controllers: [SongsController],
  providers: [SongsService],
  exports: [SongsService],
})
export class SongsModule {}
