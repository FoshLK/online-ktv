import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiHealth } from "@ktv/contracts";
import { RedisService } from "./redis/redis.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  @Get()
  getHealth(): ApiHealth {
    const runtime = this.redis.getRuntimeStatus();
    return {
      status: runtime.redis === "unavailable" ? "degraded" : "ok",
      service: "online-ktv-server",
      version: "0.6.0",
      timestamp: new Date().toISOString(),
      runtime,
    };
  }
}
