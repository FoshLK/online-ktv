import { Injectable } from "@nestjs/common";
import type { SongSummary } from "@ktv/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class SongsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublished(query: string): Promise<SongSummary[]> {
    const normalizedQuery = query.trim().slice(0, 100);
    const songs = await this.prisma.song.findMany({
      where: {
        status: "PUBLISHED",
        ...(normalizedQuery ? {
          OR: [
            { title: { contains: normalizedQuery, mode: "insensitive" as const } },
            { artist: { contains: normalizedQuery, mode: "insensitive" as const } },
          ],
        } : {}),
      },
      orderBy: [{ title: "asc" }, { artist: "asc" }],
      take: 100,
    });

    return songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
      status: song.status,
      assetVersion: song.assetVersion,
    }));
  }
}
