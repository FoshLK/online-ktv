import { Injectable } from "@nestjs/common";

@Injectable()
export class RoomPresenceService {
  private readonly socketUsers = new Map<string, string>();
  private readonly socketRooms = new Map<string, Set<string>>();

  connect(socketId: string, userId: string): void {
    this.socketUsers.set(socketId, userId);
    this.socketRooms.set(socketId, new Set());
  }

  join(socketId: string, roomId: string): void {
    const rooms = this.socketRooms.get(socketId) ?? new Set<string>();
    rooms.add(roomId);
    this.socketRooms.set(socketId, rooms);
  }

  leave(socketId: string, roomId: string): void {
    this.socketRooms.get(socketId)?.delete(roomId);
  }

  disconnect(socketId: string): string[] {
    const rooms = [...(this.socketRooms.get(socketId) ?? [])];
    this.socketRooms.delete(socketId);
    this.socketUsers.delete(socketId);
    return rooms;
  }

  getOnlineUserIds(roomId: string): string[] {
    const users = new Set<string>();
    for (const [socketId, rooms] of this.socketRooms) {
      if (!rooms.has(roomId)) continue;
      const userId = this.socketUsers.get(socketId);
      if (userId) users.add(userId);
    }
    return [...users];
  }

  isOnline(roomId: string, userId: string): boolean {
    return this.getOnlineUserIds(roomId).includes(userId);
  }

  getOnlineUserCount(): number {
    return new Set(this.socketUsers.values()).size;
  }
}
