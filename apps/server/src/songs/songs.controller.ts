import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { SongSummary } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { SongsService } from "./songs.service.js";

@Controller("songs")
@UseGuards(AccessTokenGuard)
export class SongsController {
  constructor(private readonly songs: SongsService) {}

  @Get()
  listSongs(@Query("q") query = ""): Promise<SongSummary[]> {
    return this.songs.listPublished(query);
  }
}
