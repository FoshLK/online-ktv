import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminSongList,
  AdminSongSummary,
  CurrentUser,
  SongAssetDescriptor,
  SongAssetManifest,
  SongImportResult,
  SongStatus,
  SongSummary,
} from "@ktv/contracts";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { open, readFile, rm } from "node:fs/promises";
import { extname } from "node:path";
import { PrismaService } from "../database/prisma.service.js";
import { ObjectStorageService, type StoredObject } from "../storage/object-storage.service.js";
import { ImportSongDto } from "./songs.dto.js";
import type { AdminSongQueryDto, UpdateSongStatusDto } from "./songs.dto.js";
import type { UploadedSongFile, UploadedSongFiles } from "./song-upload.js";

interface AssetRecord {
  id: string;
  kind: "AUDIO" | "COVER" | "LYRIC_SOURCE";
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  version: number;
}

interface SongRecord {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  status: SongStatus;
  assetVersion: number;
  copyrightNote: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  assets: AssetRecord[];
}

@Injectable()
export class SongsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

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

    return songs.map((song) => this.toSummary(song));
  }

  async getManifest(songId: string): Promise<SongAssetManifest> {
    const song = await this.prisma.song.findFirst({
      where: { id: songId, status: "PUBLISHED" },
      include: { assets: { orderBy: { createdAt: "desc" } } },
    });
    if (!song) throw new NotFoundException("歌曲不存在或未发布");

    const currentAssets = song.assets.filter((asset) => asset.version === song.assetVersion);
    const audio = currentAssets.find((asset) => asset.kind === "AUDIO");
    if (!audio) throw new NotFoundException("歌曲音频资源不存在");
    const lyric = currentAssets.find((asset) => asset.kind === "LYRIC_SOURCE");

    return {
      song: this.toSummary(song),
      audio: this.toDescriptor(audio),
      ...(lyric ? { lyric: this.toDescriptor(lyric) } : {}),
    };
  }

  async listAdmin(query: AdminSongQueryDto): Promise<AdminSongList> {
    const normalizedQuery = query.q.trim();
    const where = normalizedQuery ? {
      OR: [
        { title: { contains: normalizedQuery, mode: "insensitive" as const } },
        { artist: { contains: normalizedQuery, mode: "insensitive" as const } },
      ],
    } : {};
    const [songs, total] = await this.prisma.$transaction([
      this.prisma.song.findMany({
        where,
        include: { assets: { orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.song.count({ where }),
    ]);
    return { items: songs.map((song) => this.toAdminSummary(song as SongRecord)), total };
  }

  async importSong(input: Record<string, unknown>, files: UploadedSongFiles, actor: CurrentUser): Promise<SongImportResult> {
    const temporaryFiles = [...(files.audio ?? []), ...(files.lyric ?? [])];
    let jobId: string | undefined;
    let songId: string | undefined;
    let committed = false;
    const storedKeys: string[] = [];

    try {
      const dto = await this.validateImportMetadata(input);
      if (!dto.rightsConfirmed) throw new BadRequestException("必须确认拥有该音频与歌词的处理和使用权限");
      const audioFile = this.requireSingleFile(files.audio, "音频");
      const lyricFile = this.requireSingleFile(files.lyric, "LRC 歌词");
      const audioFormat = await this.validateAudio(audioFile);
      await this.validateLyric(lyricFile);

      const job = await this.prisma.songImportJob.create({
        data: {
          creatorId: actor.id,
          sourceType: "ADMIN_UPLOAD",
          sourceLabel: audioFile.originalname.slice(0, 500),
          status: "RUNNING",
          progress: 10,
          startedAt: new Date(),
        },
      });
      jobId = job.id;

      const song = await this.prisma.song.create({
        data: {
          title: dto.title,
          artist: dto.artist,
          album: dto.album || null,
          durationMs: dto.durationMs,
          status: "PROCESSING",
          copyrightNote: dto.copyrightNote,
        },
      });
      songId = song.id;
      await this.prisma.songImportJob.update({ where: { id: job.id }, data: { songId: song.id, progress: 25 } });

      const audioKey = `songs/${song.id}/v1/audio.${audioFormat.extension}`;
      const lyricKey = `songs/${song.id}/v1/lyrics.lrc`;
      const audioObject = await this.storage.putFile(audioKey, audioFile.path);
      storedKeys.push(audioKey);
      await this.prisma.songImportJob.update({ where: { id: job.id }, data: { progress: 60 } });
      const lyricObject = await this.storage.putFile(lyricKey, lyricFile.path);
      storedKeys.push(lyricKey);

      await this.prisma.$transaction(async (transaction) => {
        await transaction.songAsset.createMany({
          data: [
            this.assetData(song.id, "AUDIO", audioFormat.mimeType, audioObject),
            this.assetData(song.id, "LYRIC_SOURCE", "text/plain; charset=utf-8", lyricObject),
          ],
        });
        await transaction.lyric.create({
          data: { songId: song.id, objectKey: lyricObject.objectKey, sha256: lyricObject.sha256 },
        });
        await transaction.song.update({
          where: { id: song.id },
          data: { status: "PUBLISHED", publishedAt: new Date(), assetVersion: 1 },
        });
        await transaction.songImportJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", progress: 100, finishedAt: new Date() },
        });
        await transaction.adminAuditLog.create({
          data: {
            actorId: actor.id,
            action: "SONG_IMPORT",
            targetType: "Song",
            targetId: song.id,
            reason: dto.copyrightNote,
            afterState: {
              title: dto.title,
              artist: dto.artist,
              audioSha256: audioObject.sha256,
              lyricSha256: lyricObject.sha256,
            },
          },
        });
      });
      committed = true;

      return { jobId: job.id, song: await this.getAdminSong(song.id) };
    } catch (error) {
      if (committed) throw error;
      await Promise.all(storedKeys.map((key) => this.storage.delete(key).catch(() => undefined)));
      if (jobId) {
        await this.prisma.songImportJob.update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            errorCode: "IMPORT_FAILED",
            errorDetail: (error instanceof Error ? error.message : "Unknown import error").slice(0, 4_000),
            finishedAt: new Date(),
          },
        }).catch(() => undefined);
      }
      if (songId) {
        await this.prisma.song.delete({ where: { id: songId } }).catch(() => undefined);
      }
      throw error;
    } finally {
      await Promise.all(temporaryFiles.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
    }
  }

  async updateStatus(songId: string, dto: UpdateSongStatusDto, actor: CurrentUser): Promise<AdminSongSummary> {
    const song = await this.prisma.song.findUnique({ where: { id: songId }, include: { assets: true } });
    if (!song) throw new NotFoundException("歌曲不存在");
    if (dto.status === "PUBLISHED" && !song.assets.some((asset) => asset.kind === "AUDIO" && asset.version === song.assetVersion)) {
      throw new BadRequestException("缺少当前版本音频，无法发布");
    }

    await this.prisma.$transaction([
      this.prisma.song.update({
        where: { id: songId },
        data: { status: dto.status, publishedAt: dto.status === "PUBLISHED" ? new Date() : song.publishedAt },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          actorId: actor.id,
          action: "SONG_STATUS_UPDATE",
          targetType: "Song",
          targetId: songId,
          reason: dto.reason,
          beforeState: { status: song.status },
          afterState: { status: dto.status },
        },
      }),
    ]);
    return this.getAdminSong(songId);
  }

  async getAssetForDownload(assetId: string): Promise<{
    objectKey: string;
    mimeType: string;
    sha256: string;
    fileName: string;
  }> {
    const asset = await this.prisma.songAsset.findFirst({
      where: { id: assetId, song: { status: "PUBLISHED" } },
      include: { song: { select: { assetVersion: true } } },
    });
    if (!asset || asset.version !== asset.song.assetVersion) throw new NotFoundException("歌曲资源不存在或已下架");
    return {
      objectKey: asset.objectKey,
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      fileName: asset.kind === "AUDIO" ? `audio${extname(asset.objectKey)}` : "lyrics.lrc",
    };
  }

  private async getAdminSong(songId: string): Promise<AdminSongSummary> {
    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      include: { assets: { orderBy: { createdAt: "desc" } } },
    });
    if (!song) throw new NotFoundException("歌曲不存在");
    return this.toAdminSummary(song as SongRecord);
  }

  private toSummary(song: {
    id: string;
    title: string;
    artist: string;
    durationMs: number;
    status: SongStatus;
    assetVersion: number;
  }): SongSummary {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
      status: song.status,
      assetVersion: song.assetVersion,
    };
  }

  private toAdminSummary(song: SongRecord): AdminSongSummary {
    const currentAssets = song.assets.filter((asset) => asset.version === song.assetVersion);
    const audio = currentAssets.find((asset) => asset.kind === "AUDIO");
    const lyric = currentAssets.find((asset) => asset.kind === "LYRIC_SOURCE");
    return {
      ...this.toSummary(song),
      album: song.album ?? undefined,
      copyrightNote: song.copyrightNote ?? undefined,
      publishedAt: song.publishedAt?.toISOString(),
      createdAt: song.createdAt.toISOString(),
      audio: audio ? this.toDescriptor(audio) : undefined,
      lyric: lyric ? this.toDescriptor(lyric) : undefined,
    };
  }

  private toDescriptor(asset: AssetRecord): SongAssetDescriptor {
    return {
      id: asset.id,
      kind: asset.kind === "AUDIO" ? "AUDIO" : "LYRIC_SOURCE",
      downloadUrl: `/api/assets/${asset.id}`,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      sha256: asset.sha256,
      version: asset.version,
      fileName: asset.kind === "AUDIO" ? `audio${extname(asset.objectKey)}` : "lyrics.lrc",
    };
  }

  private assetData(songId: string, kind: "AUDIO" | "LYRIC_SOURCE", mimeType: string, object: StoredObject) {
    return {
      songId,
      kind,
      objectKey: object.objectKey,
      mimeType,
      sizeBytes: BigInt(object.sizeBytes),
      sha256: object.sha256,
      version: 1,
    };
  }

  private requireSingleFile(files: UploadedSongFile[] | undefined, label: string): UploadedSongFile {
    if (!files || files.length !== 1) throw new BadRequestException(`必须上传一个${label}文件`);
    return files[0]!;
  }

  private async validateImportMetadata(input: Record<string, unknown>): Promise<ImportSongDto> {
    const dto = plainToInstance(ImportSongDto, input);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
      throw new BadRequestException(messages.length > 0 ? messages : "歌曲元数据格式错误");
    }
    return dto;
  }

  private async validateAudio(file: UploadedSongFile): Promise<{ extension: "mp3" | "wav"; mimeType: string }> {
    if (file.size < 44) throw new BadRequestException("音频文件为空或不完整");
    const extension = extname(file.originalname).toLowerCase();
    const handle = await open(file.path, "r");
    const header = Buffer.alloc(12);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }

    if (extension === ".wav" && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE") {
      return { extension: "wav", mimeType: "audio/wav" };
    }
    const hasId3 = header.subarray(0, 3).toString("ascii") === "ID3";
    const hasFrameSync = header[0] === 0xff && (header[1]! & 0xe0) === 0xe0;
    if (extension === ".mp3" && (hasId3 || hasFrameSync)) {
      return { extension: "mp3", mimeType: "audio/mpeg" };
    }
    throw new BadRequestException("仅支持内容有效的 MP3 或 WAV 音频");
  }

  private async validateLyric(file: UploadedSongFile): Promise<void> {
    if (extname(file.originalname).toLowerCase() !== ".lrc") throw new BadRequestException("歌词文件必须是 .lrc");
    if (file.size < 1 || file.size > 2 * 1024 * 1024) throw new BadRequestException("LRC 歌词大小必须在 2 MB 以内");
    const content = (await readFile(file.path)).toString("utf8");
    if (content.includes("\0") || content.includes("�")) throw new BadRequestException("LRC 歌词必须是 UTF-8 文本");
    if (!/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(content)) {
      throw new BadRequestException("LRC 歌词中没有找到有效时间标签");
    }
  }
}
