import { Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Res, UseGuards } from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { ObjectStorageService } from "../storage/object-storage.service.js";
import { SongsService } from "./songs.service.js";

@Controller("assets")
@UseGuards(AccessTokenGuard)
export class AssetsController {
  constructor(
    @Inject(SongsService) private readonly songs: SongsService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  @Get(":assetId")
  async download(
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Headers("range") rangeHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.songs.getAssetForDownload(assetId);
    const stored = await this.storage.getLocalObject(asset.objectKey);

    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("ETag", `"sha256-${asset.sha256}"`);
    response.setHeader("Content-Disposition", `inline; filename="${asset.fileName}"`);

    const range = this.parseRange(rangeHeader, stored.sizeBytes);
    if (rangeHeader && !range) {
      response.status(416).setHeader("Content-Range", `bytes */${stored.sizeBytes}`);
      response.end();
      return;
    }

    if (range) {
      const { start, end } = range;
      response.status(206);
      response.setHeader("Content-Range", `bytes ${start}-${end}/${stored.sizeBytes}`);
      response.setHeader("Content-Length", end - start + 1);
      createReadStream(stored.absolutePath, { start, end }).pipe(response);
      return;
    }

    response.status(200).setHeader("Content-Length", stored.sizeBytes);
    createReadStream(stored.absolutePath).pipe(response);
  }

  private parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2]) || size < 1) return null;

    let start: number;
    let end: number;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    return { start, end: Math.min(end, size - 1) };
  }
}
