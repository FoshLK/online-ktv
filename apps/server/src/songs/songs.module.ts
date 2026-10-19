import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminSongsController } from "./admin-songs.controller.js";
import { AssetsController } from "./assets.controller.js";
import { SongsController } from "./songs.controller.js";
import { SongsService } from "./songs.service.js";

@Module({
  imports: [AuthModule],
  controllers: [SongsController, AdminSongsController, AssetsController],
  providers: [SongsService],
  exports: [SongsService],
})
export class SongsModule {}
