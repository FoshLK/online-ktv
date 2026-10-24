import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminAuditLogList,
  AdminAuditLogSummary,
  AdminImportJobList,
  AdminImportJobSummary,
  AdminOverview,
  AdminPlaybackHistoryItem,
  AdminPlaybackHistoryList,
  AdminRoomCloseResult,
  AdminRoomList,
  AdminUserList,
  AdminUserSummary,
  CurrentUser,
  RoomDetails,
} from "@ktv/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { RoomPresenceService } from "../rooms/room-presence.service.js";
import { RoomsService } from "../rooms/rooms.service.js";
import type { AdminListQueryDto, AdminRoomActionDto, AdminUpdateUserDto, AdminUserQueryDto } from "./admin.dto.js";

interface ImportJobRecord {
  id: string;
  status: AdminImportJobSummary["status"];
  progress: number;
  sourceType: string;
  sourceLabel: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  creator: { id: string; username: string };
  song: { id: string; title: string; artist: string } | null;
}

interface PlaybackHistoryRecord {
  id: string;
  roomId: string;
  status: AdminPlaybackHistoryItem["state"];
  sequence: number;
  assetVersion: number;
  startAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
  room: { name: string };
  song: {
    id: string;
    title: string;
    artist: string;
    durationMs: number;
    status: AdminPlaybackHistoryItem["song"]["status"];
    assetVersion: number;
  };
  readyStates: Array<{ readyAt: Date | null }>;
}

interface AuditLogRecord {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  beforeState: unknown;
  afterState: unknown;
  ipAddress: string | null;
  createdAt: Date;
  actor: { id: string; username: string } | null;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(RoomPresenceService) private readonly presence: RoomPresenceService,
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const [registeredUsers, activeRooms, pendingImportJobs, roomSummaries, recentImportJobs] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.room.count({ where: { status: { in: ["OPEN", "PLAYING"] } } }),
      this.prisma.songImportJob.count({
        where: { status: { in: ["QUEUED", "RUNNING", "REVIEW_REQUIRED", "FAILED"] } },
      }),
      this.rooms.listActiveRooms(),
      this.prisma.songImportJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 3,
        include: {
          creator: { select: { id: true, username: true } },
          song: { select: { id: true, title: true, artist: true } },
        },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        registeredUsers,
        onlineUsers: this.presence.getOnlineUserCount(),
        activeRooms,
        pendingImportJobs,
      },
      activeRooms: roomSummaries,
      recentImportJobs: recentImportJobs.map((job) => this.toImportJob(job as ImportJobRecord)),
    };
  }

  async listRooms(): Promise<AdminRoomList> {
    const items = await this.rooms.listActiveRooms();
    return { items, total: items.length, generatedAt: new Date().toISOString() };
  }

  async closeRoom(roomId: string, dto: AdminRoomActionDto, actor: CurrentUser): Promise<AdminRoomCloseResult> {
    await this.rooms.closeRoom(roomId, actor, dto.reason);
    return { roomId, closed: true };
  }

  removeRoomMember(
    roomId: string,
    userId: string,
    dto: AdminRoomActionDto,
    actor: CurrentUser,
  ): Promise<RoomDetails> {
    return this.rooms.removeMember(roomId, userId, actor, dto.reason);
  }

  async listUsers(query: AdminUserQueryDto): Promise<AdminUserList> {
    const where = query.q ? {
      OR: [
        { username: { contains: query.q, mode: "insensitive" as const } },
        { email: { contains: query.q, mode: "insensitive" as const } },
      ],
    } : {};
    const now = new Date();
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: {
            select: {
              sessions: { where: { revokedAt: null, expiresAt: { gt: now } } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map((user) => this.toAdminUser(user, user._count.sessions)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async updateUser(userId: string, dto: AdminUpdateUserDto, actor: CurrentUser): Promise<AdminUserSummary> {
    if (dto.role === undefined && dto.status === undefined) throw new BadRequestException("没有需要更新的用户字段");
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException("用户不存在");
    if (actor.id === target.id && (dto.status !== undefined || dto.role !== undefined)) {
      throw new ConflictException("不能在当前会话中修改自己的状态或角色");
    }
    if (actor.role !== "SUPER_ADMIN") {
      if (dto.role !== undefined) throw new ForbiddenException("只有超级管理员可以修改用户角色");
      if (target.role !== "USER") throw new ForbiddenException("普通管理员不能修改其他管理员");
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: userId },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
      });
      if (dto.status && dto.status !== "ACTIVE") {
        await transaction.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await transaction.adminAuditLog.create({
        data: {
          actorId: actor.id,
          action: "USER_UPDATE",
          targetType: "User",
          targetId: userId,
          reason: dto.reason,
          beforeState: { role: target.role, status: target.status },
          afterState: { role: updated.role, status: updated.status },
        },
      });
      const activeSessionCount = await transaction.userSession.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      return this.toAdminUser(updated, activeSessionCount);
    });
  }

  async listImportJobs(query: AdminListQueryDto): Promise<AdminImportJobList> {
    const where = query.q ? {
      OR: [
        { sourceLabel: { contains: query.q, mode: "insensitive" as const } },
        { creator: { username: { contains: query.q, mode: "insensitive" as const } } },
        { song: { is: { title: { contains: query.q, mode: "insensitive" as const } } } },
        { song: { is: { artist: { contains: query.q, mode: "insensitive" as const } } } },
      ],
    } : {};
    const [jobs, total] = await this.prisma.$transaction([
      this.prisma.songImportJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          creator: { select: { id: true, username: true } },
          song: { select: { id: true, title: true, artist: true } },
        },
      }),
      this.prisma.songImportJob.count({ where }),
    ]);
    return {
      items: jobs.map((job) => this.toImportJob(job as ImportJobRecord)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listPlaybackHistory(query: AdminListQueryDto): Promise<AdminPlaybackHistoryList> {
    const where = query.q ? {
      OR: [
        { room: { name: { contains: query.q, mode: "insensitive" as const } } },
        { song: { title: { contains: query.q, mode: "insensitive" as const } } },
        { song: { artist: { contains: query.q, mode: "insensitive" as const } } },
      ],
    } : {};
    const [sessions, total] = await this.prisma.$transaction([
      this.prisma.playbackSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          room: { select: { name: true } },
          song: true,
          readyStates: { select: { readyAt: true } },
        },
      }),
      this.prisma.playbackSession.count({ where }),
    ]);
    return {
      items: sessions.map((session) => this.toPlaybackHistory(session as PlaybackHistoryRecord)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listAuditLogs(query: AdminListQueryDto): Promise<AdminAuditLogList> {
    const where = query.q ? {
      OR: [
        { action: { contains: query.q, mode: "insensitive" as const } },
        { targetType: { contains: query.q, mode: "insensitive" as const } },
        { targetId: { contains: query.q, mode: "insensitive" as const } },
        { reason: { contains: query.q, mode: "insensitive" as const } },
        { actor: { is: { username: { contains: query.q, mode: "insensitive" as const } } } },
      ],
    } : {};
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, username: true } } },
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return {
      items: logs.map((log) => this.toAuditLog(log as AuditLogRecord)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private toImportJob(job: ImportJobRecord): AdminImportJobSummary {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      sourceType: job.sourceType,
      sourceLabel: job.sourceLabel ?? undefined,
      errorCode: job.errorCode ?? undefined,
      errorDetail: job.errorDetail ?? undefined,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      finishedAt: job.finishedAt?.toISOString(),
      creator: job.creator,
      song: job.song ?? undefined,
    };
  }

  private toPlaybackHistory(session: PlaybackHistoryRecord): AdminPlaybackHistoryItem {
    return {
      id: session.id,
      roomId: session.roomId,
      roomName: session.room.name,
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
      participantCount: session.readyStates.length,
      readyCount: session.readyStates.filter((state) => state.readyAt).length,
      createdAt: session.createdAt.toISOString(),
      startedAt: session.startAt?.toISOString(),
      endedAt: session.endedAt?.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private toAuditLog(log: AuditLogRecord): AdminAuditLogSummary {
    return {
      id: log.id,
      actor: log.actor ?? undefined,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId ?? undefined,
      reason: log.reason ?? undefined,
      beforeState: log.beforeState ?? undefined,
      afterState: log.afterState ?? undefined,
      ipAddress: log.ipAddress ?? undefined,
      createdAt: log.createdAt.toISOString(),
    };
  }

  private toAdminUser(user: {
    id: string;
    username: string;
    email: string;
    emailVerifiedAt: Date | null;
    role: AdminUserSummary["role"];
    status: AdminUserSummary["status"];
    createdAt: Date;
  }, activeSessionCount: number): AdminUserSummary {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      activeSessionCount,
    };
  }
}
