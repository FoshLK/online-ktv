import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminOverview, AdminUserList, AdminUserSummary, CurrentUser } from "@ktv/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { RoomPresenceService } from "../rooms/room-presence.service.js";
import { RoomsService } from "../rooms/rooms.service.js";
import type { AdminUpdateUserDto, AdminUserQueryDto } from "./admin.dto.js";

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(RoomPresenceService) private readonly presence: RoomPresenceService,
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const [registeredUsers, activeRooms, pendingImportJobs, roomSummaries] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.room.count({ where: { status: { in: ["OPEN", "PLAYING"] } } }),
      this.prisma.songImportJob.count({
        where: { status: { in: ["QUEUED", "RUNNING", "REVIEW_REQUIRED", "FAILED"] } },
      }),
      this.rooms.listActiveRooms(),
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
    };
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
