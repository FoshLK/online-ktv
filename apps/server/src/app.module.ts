import { Module } from "@nestjs/common";
import { BootstrapController } from "./bootstrap.controller.js";
import { HealthController } from "./health.controller.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { RoomsModule } from "./rooms/rooms.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { SongsModule } from "./songs/songs.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { RedisModule } from "./redis/redis.module.js";

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule, AuthModule, RoomsModule, AdminModule, SongsModule],
  controllers: [HealthController, BootstrapController],
})
export class AppModule {}
