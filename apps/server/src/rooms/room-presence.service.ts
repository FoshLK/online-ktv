import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { RuntimeInfrastructureStatus } from "@ktv/contracts";
import { randomUUID } from "node:crypto";
import { RedisService } from "../redis/redis.service.js";

@Injectable()
export class RoomPresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomPresenceService.name);
  private readonly socketUsers = new Map<string, string>();
  private readonly socketRooms = new Map<string, Set<string>>();
  private readonly instanceId = `${process.env.SERVER_INSTANCE_ID?.trim() || "server"}-${randomUUID()}`;
  private readonly ttlSeconds = this.readTtlSeconds();
  private readonly heartbeatMs = Math.max(5_000, Math.floor(this.ttlSeconds * 1_000 / 3));
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastRedisWarningAt = 0;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.refreshLocalSockets();
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await this.removeLocalSocketsFromRedis();
  }

  async connect(socketId: string, userId: string): Promise<void> {
    this.socketUsers.set(socketId, userId);
    this.socketRooms.set(socketId, new Set());
    await this.syncSocket(socketId);
  }

  async join(socketId: string, roomId: string): Promise<void> {
    if (!this.socketUsers.has(socketId)) return;
    const rooms = this.socketRooms.get(socketId) ?? new Set<string>();
    rooms.add(roomId);
    this.socketRooms.set(socketId, rooms);
    await this.syncSocket(socketId);
  }

  async leave(socketId: string, roomId: string): Promise<void> {
    this.socketRooms.get(socketId)?.delete(roomId);
    const client = this.redis.getClient();
    if (!client) return;
    try {
      await client.zRem(this.roomRegistryKey(roomId), this.socketHandle(socketId));
      await this.syncSocket(socketId);
    } catch (error) {
      this.reportRedisError(error);
    }
  }

  async disconnect(socketId: string): Promise<string[]> {
    const rooms = [...(this.socketRooms.get(socketId) ?? [])];
    this.socketRooms.delete(socketId);
    this.socketUsers.delete(socketId);

    const client = this.redis.getClient();
    if (!client) return rooms;
    const handle = this.socketHandle(socketId);
    try {
      const transaction = client.multi()
        .del(this.socketKey(handle))
        .zRem(this.globalRegistryKey(), handle);
      for (const roomId of rooms) transaction.zRem(this.roomRegistryKey(roomId), handle);
      await transaction.exec();
    } catch (error) {
      this.reportRedisError(error);
    }
    return rooms;
  }

  async getOnlineUserIds(roomId: string): Promise<string[]> {
    const redisUsers = await this.readUsersFromRegistry(this.roomRegistryKey(roomId));
    return redisUsers ?? this.getLocalOnlineUserIds(roomId);
  }

  async isOnline(roomId: string, userId: string): Promise<boolean> {
    return (await this.getOnlineUserIds(roomId)).includes(userId);
  }

  async getOnlineUserCount(): Promise<number> {
    const redisUsers = await this.readUsersFromRegistry(this.globalRegistryKey());
    return redisUsers?.length ?? new Set(this.socketUsers.values()).size;
  }

  getRuntimeStatus(): RuntimeInfrastructureStatus {
    return this.redis.getRuntimeStatus();
  }

  private async syncSocket(socketId: string): Promise<void> {
    const client = this.redis.getClient();
    const userId = this.socketUsers.get(socketId);
    if (!client || !userId) return;

    const handle = this.socketHandle(socketId);
    try {
      const [seconds, microseconds] = await client.time();
      const redisNow = Number(seconds) * 1_000 + Math.floor(Number(microseconds) / 1_000);
      const expiresAt = redisNow + this.ttlSeconds * 1_000;
      const transaction = client.multi()
        .set(this.socketKey(handle), userId, { EX: this.ttlSeconds })
        .zAdd(this.globalRegistryKey(), { score: expiresAt, value: handle });
      for (const roomId of this.socketRooms.get(socketId) ?? []) {
        transaction.zAdd(this.roomRegistryKey(roomId), { score: expiresAt, value: handle });
      }
      await transaction.exec();
    } catch (error) {
      this.reportRedisError(error);
    }
  }

  private async refreshLocalSockets(): Promise<void> {
    if (!this.redis.getClient() || this.socketUsers.size === 0) return;
    await Promise.all([...this.socketUsers.keys()].map((socketId) => this.syncSocket(socketId)));
  }

  private async removeLocalSocketsFromRedis(): Promise<void> {
    const client = this.redis.getClient();
    if (!client || this.socketUsers.size === 0) return;
    try {
      const transaction = client.multi();
      for (const socketId of this.socketUsers.keys()) {
        const handle = this.socketHandle(socketId);
        transaction.del(this.socketKey(handle)).zRem(this.globalRegistryKey(), handle);
        for (const roomId of this.socketRooms.get(socketId) ?? []) {
          transaction.zRem(this.roomRegistryKey(roomId), handle);
        }
      }
      await transaction.exec();
    } catch (error) {
      this.reportRedisError(error);
    }
  }

  private async readUsersFromRegistry(registryKey: string): Promise<string[] | null> {
    const client = this.redis.getClient();
    if (!client) return null;

    try {
      const [seconds, microseconds] = await client.time();
      const now = Number(seconds) * 1_000 + Math.floor(Number(microseconds) / 1_000);
      await client.zRemRangeByScore(registryKey, 0, now);
      const handles = await client.zRangeByScore(registryKey, now + 1, "+inf");
      if (handles.length === 0) return [];

      const userIds = await client.mGet(handles.map((handle) => this.socketKey(handle)));
      const users = new Set<string>();
      const staleHandles: string[] = [];
      userIds.forEach((userId, index) => {
        if (userId) users.add(userId);
        else if (handles[index]) staleHandles.push(handles[index]);
      });
      if (staleHandles.length > 0) {
        const cleanup = client.multi().zRem(registryKey, staleHandles);
        if (registryKey !== this.globalRegistryKey()) cleanup.zRem(this.globalRegistryKey(), staleHandles);
        await cleanup.exec();
      }
      return [...users];
    } catch (error) {
      this.reportRedisError(error);
      return null;
    }
  }

  private getLocalOnlineUserIds(roomId: string): string[] {
    const users = new Set<string>();
    for (const [socketId, rooms] of this.socketRooms) {
      if (!rooms.has(roomId)) continue;
      const userId = this.socketUsers.get(socketId);
      if (userId) users.add(userId);
    }
    return [...users];
  }

  private socketHandle(socketId: string): string {
    return `${this.instanceId}:${socketId}`;
  }

  private socketKey(handle: string): string {
    return this.redis.key(`presence:socket:${handle}`);
  }

  private globalRegistryKey(): string {
    return this.redis.key("presence:online");
  }

  private roomRegistryKey(roomId: string): string {
    return this.redis.key(`presence:room:${roomId}`);
  }

  private readTtlSeconds(): number {
    const parsed = Number(process.env.PRESENCE_TTL_SECONDS);
    return Number.isInteger(parsed) && parsed >= 15 ? parsed : 60;
  }

  private reportRedisError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastRedisWarningAt < 10_000) return;
    this.lastRedisWarningAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis 在线状态操作失败，当前请求使用本机状态：${message}`);
  }
}
