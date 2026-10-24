import { Controller, Get } from "@nestjs/common";
import type { ApiHealth } from "@ktv/contracts";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): ApiHealth {
    return {
      status: "ok",
      service: "online-ktv-server",
      version: "0.5.0",
      timestamp: new Date().toISOString(),
    };
  }
}
