import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CurrentUser,
  JoinRoomResult,
  LeaveRoomResult,
  PlaybackSnapshot,
  RoomDetails,
  RoomMemberRole,
  RoomStatus,
  RoomSummary,
  SongStatus,
} from "@ktv/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { RoomPresenceService } from "./room-presence.service.js";
import type { CreateRoomDto, UpdateRoomDto } from "./rooms.dto.js";

const activePlaybackStates = ["PREPARING", "SCHEDULED", "PLAYING", "PAUSED"] as const;

interface RoomRecord {
  id: string;
  name: string;
  ownerId: string;
  status: RoomStatus;
  capacity: number;
  announcement: string | null;
  owner: { username: string };
  members: Array<{
    userId: string;
    role: RoomMemberRole;
    joinedAt: Date;
    mutedAt: Date | null;
    user: { username: string };
  }>;
  playbacks: Array<{
    id: string;
    status: PlaybackSnapshot["state"];
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
    readyStates: Array<{ userId: string; readyAt: Date | null }>;
  }>;
}

@Injectable()
export class RoomsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomPresenceService) private readonly presence: RoomPresenceService,
  ) {}

  async listActiveRooms(): Promise<RoomSummary[]> {
    const rooms = await this.prisma.room.findMany({
      where: { status: { in: ["OPEN", "PLAYING"] } },
      orderBy: { updatedAt: "desc" },
      include: this.roomInclude(),
    });
    return rooms.map((room) => this.toRoomDetails(room as RoomRecord));
  }

  async getRoom(roomId: string, user: CurrentUser): Promise<RoomDetails> {
    const room = await this.findRoom(roomId);
    const isMember = room.members.some((member) => member.userId === user.id);
    if (!isMember && user.role === "USER") throw new ForbiddenException("请先加入房间");
    return this.toRoomDetails(room);
  }

  async getRoomForBroadcast(roomId: string): Promise<RoomDetails> {
    return this.toRoomDetails(await this.findRoom(roomId));
  }

  async createRoom(user: CurrentUser, dto: CreateRoomDto): Promise<RoomDetails> {
    const activeMembership = await this.prisma.roomMember.findFirst({
      where: { userId: user.id, leftAt: null, room: { status: { in: ["OPEN", "PLAYING"] } } },
      select: { roomId: true },
    });
    if (activeMembership) throw new ConflictException("请先退出当前房间再创建新房间");

    const room = await this.prisma.room.create({
      data: {
        name: dto.name,
        capacity: dto.capacity,
        announcement: dto.announcement || null,
        ownerId: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      include: this.roomInclude(),
    });
    return this.toRoomDetails(room as RoomRecord);
  }

  async joinRoom(roomId: string, user: CurrentUser): Promise<JoinRoomResult> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const room = await transaction.room.findUnique({
        where: { id: roomId },
        include: {
          members: { where: { leftAt: null }, select: { userId: true } },
          bans: {
            where: { userId: user.id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            select: { id: true },
          },
        },
      });
      if (!room || room.status === "CLOSED") throw new NotFoundException("房间不存在或已关闭");
      if (room.bans.length > 0 && user.role === "USER") throw new ForbiddenException("你暂时无法加入这个房间");

      const alreadyJoined = room.members.some((member) => member.userId === user.id);
      if (!alreadyJoined && room.members.length >= room.capacity) throw new ConflictException("房间人数已满");

      const otherMembership = await transaction.roomMember.findFirst({
        where: {
          userId: user.id,
          leftAt: null,
          roomId: { not: roomId },
          room: { status: { in: ["OPEN", "PLAYING"] } },
        },
        select: { roomId: true },
      });
      if (otherMembership) throw new ConflictException("请先退出当前房间");

      if (!alreadyJoined) {
        const previousMembership = await transaction.roomMember.findUnique({
          where: { roomId_userId: { roomId, userId: user.id } },
          select: { id: true },
        });
        if (previousMembership) {
          await transaction.roomMember.update({
            where: { id: previousMembership.id },
            data: { leftAt: null, joinedAt: now, mutedAt: null },
          });
        } else {
          await transaction.roomMember.create({ data: { roomId, userId: user.id } });
        }
      }
    });

    return { room: await this.getRoom(roomId, user), joined: true };
  }

  async leaveRoom(roomId: string, user: CurrentUser): Promise<LeaveRoomResult> {
    const room = await this.findRoom(roomId);
    const membership = room.members.find((member) => member.userId === user.id);
    if (!membership) throw new NotFoundException("你不在这个房间中");

    const now = new Date();
    if (room.ownerId === user.id) {
      await this.prisma.$transaction([
        this.prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED", closedAt: now } }),
        this.prisma.roomMember.updateMany({ where: { roomId, leftAt: null }, data: { leftAt: now } }),
      ]);
      return { roomId, left: true, roomClosed: true };
    }

    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId: user.id } },
      data: { leftAt: now },
    });
    return { roomId, left: true, roomClosed: false };
  }

  async updateRoom(roomId: string, user: CurrentUser, dto: UpdateRoomDto): Promise<RoomDetails> {
    const room = await this.findRoom(roomId);
    this.assertCanManage(room, user);
    if (dto.capacity !== undefined && dto.capacity < room.members.length) {
      throw new ConflictException("房间容量不能小于当前成员数量");
    }
    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.announcement !== undefined ? { announcement: dto.announcement || null } : {}),
      },
    });
    return this.getRoomForBroadcast(roomId);
  }

  async closeRoom(roomId: string, user: CurrentUser): Promise<void> {
    const room = await this.findRoom(roomId);
    this.assertCanManage(room, user);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED", closedAt: now } }),
      this.prisma.roomMember.updateMany({ where: { roomId, leftAt: null }, data: { leftAt: now } }),
    ]);
  }

  async removeMember(roomId: string, targetUserId: string, actor: CurrentUser): Promise<RoomDetails> {
    const room = await this.findRoom(roomId);
    this.assertCanManage(room, actor);
    if (targetUserId === room.ownerId) throw new ConflictException("不能移除房主");
    const result = await this.prisma.roomMember.updateMany({
      where: { roomId, userId: targetUserId, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException("房间成员不存在");
    return this.getRoomForBroadcast(roomId);
  }

  private async findRoom(roomId: string): Promise<RoomRecord> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: this.roomInclude(),
    });
    if (!room || room.status === "CLOSED") throw new NotFoundException("房间不存在或已关闭");
    return room as RoomRecord;
  }

  private roomInclude() {
    return {
      owner: { select: { username: true } },
      members: {
        where: { leftAt: null },
        orderBy: { joinedAt: "asc" as const },
        include: { user: { select: { username: true } } },
      },
      playbacks: {
        where: { status: { in: [...activePlaybackStates] } },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        include: { song: true, readyStates: { select: { userId: true, readyAt: true } } },
      },
    };
  }

  private toRoomDetails(room: RoomRecord): RoomDetails {
    const playback = room.playbacks[0];
    const readyUserIds = playback?.readyStates.filter((state) => state.readyAt).map((state) => state.userId) ?? [];
    const participantIds = playback?.readyStates.map((state) => state.userId) ?? [];
    const song = playback ? {
      id: playback.song.id,
      title: playback.song.title,
      artist: playback.song.artist,
      durationMs: playback.song.durationMs,
      status: playback.song.status,
      assetVersion: playback.song.assetVersion,
    } : undefined;
    const currentPlayback: PlaybackSnapshot | undefined = playback && song ? {
      sessionId: playback.id,
      roomId: room.id,
      song,
      state: playback.status === "SCHEDULED"
        && playback.startAt !== null
        && playback.startAt.getTime() <= Date.now()
        ? "PLAYING"
        : playback.status,
      sequence: playback.sequence,
      assetVersion: playback.assetVersion,
      expectedChecksum: playback.expectedChecksum,
      startAtServerMs: playback.startAt?.getTime(),
      pausedPositionMs: playback.pausedPositionMs ?? undefined,
      readyUserIds,
      waitingUserIds: participantIds.filter((userId) => !readyUserIds.includes(userId)),
    } : undefined;

    return {
      id: room.id,
      name: room.name,
      ownerId: room.ownerId,
      ownerName: room.owner.username,
      status: room.status,
      memberCount: room.members.length,
      capacity: room.capacity,
      announcement: room.announcement ?? undefined,
      currentSong: song,
      members: room.members.map((member) => ({
        userId: member.userId,
        username: member.user.username,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        muted: Boolean(member.mutedAt),
        online: this.presence.isOnline(room.id, member.userId),
      })),
      currentPlayback,
    };
  }

  private assertCanManage(room: RoomRecord, user: CurrentUser): void {
    if (room.ownerId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN") return;
    const membership = room.members.find((member) => member.userId === user.id);
    if (membership?.role === "MODERATOR") return;
    throw new ForbiddenException("只有房主或管理员可以执行此操作");
  }
}
