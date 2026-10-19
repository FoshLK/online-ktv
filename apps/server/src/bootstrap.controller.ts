import { Controller, Get } from "@nestjs/common";
import type { RoomSummary } from "@ktv/contracts";

@Controller("bootstrap")
export class BootstrapController {
  @Get()
  getBootstrap(): { capabilities: string[]; featuredRooms: RoomSummary[] } {
    return {
      capabilities: [
        "accounts",
        "rooms",
        "song-library",
        "asset-download",
        "asset-readiness",
        "native-cache",
        "clock-sync",
        "admin-audit",
      ],
      featuredRooms: [],
    };
  }
}
