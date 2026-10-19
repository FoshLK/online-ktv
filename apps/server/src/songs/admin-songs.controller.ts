import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { AdminSongList, AdminSongSummary, CurrentUser, SongImportResult } from "@ktv/contracts";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { CurrentUserParam } from "../auth/current-user.decorator.js";
import { Roles, RolesGuard } from "../auth/roles.guard.js";
import { songUploadOptions, type UploadedSongFiles } from "./song-upload.js";
import { AdminSongQueryDto, UpdateSongStatusDto } from "./songs.dto.js";
import { SongsService } from "./songs.service.js";

@Controller("admin/songs")
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminSongsController {
  constructor(@Inject(SongsService) private readonly songs: SongsService) {}

  @Get()
  list(@Query() query: AdminSongQueryDto): Promise<AdminSongList> {
    return this.songs.listAdmin(query);
  }

  @Post("import")
  @UseInterceptors(FileFieldsInterceptor(
    [{ name: "audio", maxCount: 1 }, { name: "lyric", maxCount: 1 }],
    songUploadOptions,
  ))
  importSong(
    @Body() dto: Record<string, unknown>,
    @UploadedFiles() files: UploadedSongFiles,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<SongImportResult> {
    return this.songs.importSong(dto, files ?? {}, actor);
  }

  @Patch(":songId/status")
  updateStatus(
    @Param("songId", ParseUUIDPipe) songId: string,
    @Body() dto: UpdateSongStatusDto,
    @CurrentUserParam() actor: CurrentUser,
  ): Promise<AdminSongSummary> {
    return this.songs.updateStatus(songId, dto, actor);
  }
}
