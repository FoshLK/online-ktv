import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type { SongAssetManifest, SongSummary } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { SongsService } from "./songs.service.js";

@Controller("songs")
@UseGuards(AccessTokenGuard)
export class SongsController {
  constructor(@Inject(SongsService) private readonly songs: SongsService) {}

  @Get()
  listSongs(@Query("q") query = ""): Promise<SongSummary[]> {
    return this.songs.listPublished(query);
  }

  @Get(":songId/manifest")
  getManifest(@Param("songId", ParseUUIDPipe) songId: string): Promise<SongAssetManifest> {
    return this.songs.getManifest(songId);
  }
}
