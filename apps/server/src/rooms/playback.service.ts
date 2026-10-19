import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CurrentUser, PlaybackCommand, PlaybackSnapshot, PlaybackStatus, SongStatus } from "@ktv/contracts";
import { PrismaService } from "../database/prisma.service.js";
import type { PlaybackControlDto } from "./playback.dto.js";

interface PlaybackRecord {
  id: string;
  roomId: string;
  status: PlaybackStatus;
  sequence: number;
  assetVersion: number;
  expectedChecksum: string;
  startAt: Date | null;
  pausedPositionMs: number | null;
  song: {
    id: string;
    title: string;
    artist: string;
    durationMs: number;
    status: SongStatus;
    assetVersion: number;
  };
  readyStates: Array<{
    userId: string;
    checksum: string | null;
    readyAt: Date | null;
  }>;
}

export interface PlaybackTransition {
  snapshot: PlaybackSnapshot;
  command?: PlaybackCommand;
}

@Injectable()
export class PlaybackService {
  private readonly startLeadMs = this.readStartLeadMs();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async prepare(roomId: string, songId: string, actor: CurrentUser): Promise<PlaybackSnapshot> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: { where: { leftAt: null }, select: { userId: true, role: true } },
        playbacks: {
          where: { status: { in: ["PREPARING", "SCHEDULED", "PLAYING", "PAUSED"] } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!room || room.status === "CLOSED") throw new NotFoundException("房间不存在或已关闭");
    this.assertCanControl(room.ownerId, room.members, actor);
    if (room.playbacks.length > 0) throw new ConflictException("当前已有歌曲正在准备或播放");
    if (room.members.length === 0) throw new ConflictException("房间内没有可参与播放的成员");

    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      include: {
        assets: {
          where: { kind: "AUDIO" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    const audio = song?.assets[0];
    if (!song || song.status !== "PUBLISHED" || !audio) {
      throw new NotFoundException("歌曲不存在、未发布或缺少音频资源");
    }

    const session = await this.prisma.playbackSession.create({
      data: {
        roomId,
        songId,
        assetVersion: audio.version,
        expectedChecksum: audio.sha256.toLowerCase(),
        readyStates: {
          create: room.members.map((member) => ({ userId: member.userId })),
        },
      },
      include: this.snapshotInclude(),
    });
    return this.toSnapshot(session as PlaybackRecord);
  }

  async markReady(sessionId: string, userId: string, checksum: string): Promise<PlaybackTransition> {
    const normalizedChecksum = checksum.toLowerCase();
    if (!/^[a-f\d]{64}$/.test(normalizedChecksum)) throw new BadRequestException("资源校验值格式错误");

    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.playbackSession.findUnique({
        where: { id: sessionId },
        include: this.snapshotInclude(),
      });
      if (!session || session.status === "ENDED" || session.status === "FAILED") {
        throw new NotFoundException("播放准备会话不存在或已结束");
      }
      if (session.status !== "PREPARING" && session.status !== "SCHEDULED") {
        throw new ConflictException("当前播放阶段不再接受资源准备状态");
      }
      if (session.expectedChecksum.toLowerCase() !== normalizedChecksum) {
        throw new BadRequestException("歌曲资源校验失败，请重新下载");
      }

      const participant = session.readyStates.find((state) => state.userId === userId);
      if (!participant) throw new ForbiddenException("当前用户不属于本次播放会话");
      if (!participant.readyAt) {
        await transaction.playbackReadyState.update({
          where: { playbackSessionId_userId: { playbackSessionId: sessionId, userId } },
          data: { checksum: normalizedChecksum, readyAt: new Date() },
        });
      }

      let refreshed = await transaction.playbackSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: this.snapshotInclude(),
      });
      const allReady = refreshed.readyStates.length > 0 && refreshed.readyStates.every(
        (state) => Boolean(state.readyAt) && state.checksum?.toLowerCase() === normalizedChecksum,
      );
      let command: PlaybackCommand | undefined;

      if (refreshed.status === "PREPARING" && allReady) {
        const startAt = new Date(Date.now() + this.startLeadMs);
        refreshed = await transaction.playbackSession.update({
          where: { id: sessionId },
          data: { status: "SCHEDULED", sequence: { increment: 1 }, startAt, pausedPositionMs: 0 },
          include: this.snapshotInclude(),
        });
        await transaction.room.update({ where: { id: refreshed.roomId }, data: { status: "PLAYING" } });
        command = {
          action: "START",
          sequence: refreshed.sequence,
          effectiveAtServerMs: startAt.getTime(),
          positionMs: 0,
        };
      }

      return { snapshot: this.toSnapshot(refreshed as PlaybackRecord), command };
    });
  }

  async reportPosition(
    sessionId: string,
    userId: string,
    sequence: number,
    positionMs: number,
    observedAtClientMs: number,
  ): Promise<{ accepted: boolean; serverMs: number }> {
    if (!Number.isInteger(positionMs) || positionMs < 0 || !Number.isFinite(observedAtClientMs)) {
      return { accepted: false, serverMs: Date.now() };
    }
    const session = await this.prisma.playbackSession.findUnique({
      where: { id: sessionId },
      select: { sequence: true, status: true },
    });
    if (!session || session.sequence !== sequence || !["SCHEDULED", "PLAYING", "PAUSED"].includes(session.status)) {
      return { accepted: false, serverMs: Date.now() };
    }
    const participant = await this.prisma.playbackReadyState.findUnique({
      where: { playbackSessionId_userId: { playbackSessionId: sessionId, userId } },
      select: { readyAt: true },
    });
    if (!participant?.readyAt) return { accepted: false, serverMs: Date.now() };

    await this.prisma.playbackReadyState.update({
      where: { playbackSessionId_userId: { playbackSessionId: sessionId, userId } },
      data: { lastPositionMs: positionMs, lastReportedAt: new Date() },
    });
    return { accepted: true, serverMs: Date.now() };
  }

  async control(roomId: string, dto: PlaybackControlDto, actor: CurrentUser): Promise<PlaybackTransition> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { members: { where: { leftAt: null }, select: { userId: true, role: true } } },
    });
    if (!room || room.status === "CLOSED") throw new NotFoundException("房间不存在或已关闭");
    this.assertCanControl(room.ownerId, room.members, actor);

    const session = await this.prisma.playbackSession.findFirst({
      where: { roomId, status: { in: ["PREPARING", "SCHEDULED", "PLAYING", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      include: this.snapshotInclude(),
    });
    if (!session) throw new NotFoundException("当前没有可控制的播放会话");

    const effectiveAt = new Date(Date.now() + 800);
    const positionMs = dto.positionMs ?? session.pausedPositionMs ?? 0;
    if ((dto.action === "PAUSE" || dto.action === "SEEK") && dto.positionMs === undefined) {
      throw new BadRequestException("暂停或跳转需要提供当前播放位置");
    }
    if (positionMs > session.song.durationMs) throw new BadRequestException("播放位置超过歌曲时长");

    let data: {
      status: PlaybackStatus;
      sequence: { increment: number };
      startAt?: Date | null;
      pausedPositionMs?: number | null;
      endedAt?: Date;
    };
    let commandAction: PlaybackCommand["action"];

    switch (dto.action) {
      case "PAUSE":
        if (!(["SCHEDULED", "PLAYING"] as PlaybackStatus[]).includes(session.status)) throw new ConflictException("当前状态不能暂停");
        data = { status: "PAUSED", sequence: { increment: 1 }, startAt: null, pausedPositionMs: positionMs };
        commandAction = "PAUSE";
        break;
      case "RESUME":
        if (session.status !== "PAUSED") throw new ConflictException("只有暂停状态可以继续播放");
        data = { status: "SCHEDULED", sequence: { increment: 1 }, startAt: effectiveAt };
        commandAction = "RESUME";
        break;
      case "SEEK":
        if (session.status === "PREPARING") throw new ConflictException("资源尚未准备完成");
        data = session.status === "PAUSED"
          ? { status: "PAUSED", sequence: { increment: 1 }, pausedPositionMs: positionMs }
          : { status: "SCHEDULED", sequence: { increment: 1 }, startAt: effectiveAt, pausedPositionMs: positionMs };
        commandAction = "SEEK";
        break;
      case "STOP":
        data = { status: "ENDED", sequence: { increment: 1 }, endedAt: new Date() };
        commandAction = "STOP";
        break;
    }

    const updated = await this.prisma.playbackSession.update({
      where: { id: session.id },
      data,
      include: this.snapshotInclude(),
    });
    if (dto.action === "STOP") {
      await this.prisma.room.update({ where: { id: roomId }, data: { status: "OPEN" } });
    }

    return {
      snapshot: this.toSnapshot(updated as PlaybackRecord),
      command: {
        action: commandAction,
        sequence: updated.sequence,
        effectiveAtServerMs: effectiveAt.getTime(),
        ...(dto.action === "STOP" ? {} : { positionMs }),
      },
    };
  }

  private snapshotInclude() {
    return {
      song: true,
      readyStates: { select: { userId: true, checksum: true, readyAt: true } },
    };
  }

  private readStartLeadMs(): number {
    const configured = Number(process.env.PLAYBACK_START_LEAD_MS ?? 3_000);
    return Number.isFinite(configured) ? Math.max(1_500, configured) : 3_000;
  }

  private toSnapshot(session: PlaybackRecord): PlaybackSnapshot {
    const readyUserIds = session.readyStates.filter((state) => state.readyAt).map((state) => state.userId);
    return {
      sessionId: session.id,
      roomId: session.roomId,
      song: {
        id: session.song.id,
        title: session.song.title,
        artist: session.song.artist,
        durationMs: session.song.durationMs,
        status: session.song.status,
        assetVersion: session.song.assetVersion,
      },
      state: session.status,
      sequence: session.sequence,
      assetVersion: session.assetVersion,
      expectedChecksum: session.expectedChecksum,
      startAtServerMs: session.startAt?.getTime(),
      pausedPositionMs: session.pausedPositionMs ?? undefined,
      readyUserIds,
      waitingUserIds: session.readyStates.filter((state) => !state.readyAt).map((state) => state.userId),
    };
  }

  private assertCanControl(
    ownerId: string,
    members: Array<{ userId: string; role: string }>,
    actor: CurrentUser,
  ): void {
    if (ownerId === actor.id || actor.role === "ADMIN" || actor.role === "SUPER_ADMIN") return;
    const member = members.find((candidate) => candidate.userId === actor.id);
    if (member?.role === "MODERATOR") return;
    throw new ForbiddenException("只有房主或房间管理员可以控制播放");
  }
}
