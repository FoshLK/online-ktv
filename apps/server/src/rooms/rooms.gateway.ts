import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
import type {
  ClientToServerEvents,
  CurrentUser,
  PlaybackCommand,
  PlaybackSnapshot,
  ServerToClientEvents,
} from "@ktv/contracts";
import type { Server, Socket } from "socket.io";
import { TokenService } from "../auth/token.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { RoomPresenceService } from "./room-presence.service.js";
import { PlaybackService } from "./playback.service.js";
import { RoomsService } from "./rooms.service.js";

interface RoomSocketData {
  currentUser?: CurrentUser;
}

type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, RoomSocketData>;
type RoomServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, RoomSocketData>;

@WebSocketGateway({
  namespace: "/rooms",
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"],
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: RoomServer;

  private readonly logger = new Logger(RoomsGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly presence: RoomPresenceService,
    private readonly playback: PlaybackService,
  ) {}

  async handleConnection(client: RoomSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error("Missing token");
      const payload = await this.tokens.verifyAccessToken(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new Error("Inactive user");

      client.data.currentUser = {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: true,
        role: user.role,
        status: user.status,
      };
      this.presence.connect(client.id, user.id);
      this.logger.debug(`authenticated socket=${client.id} user=${user.id}`);
    } catch {
      client.emit("system:error", { code: "UNAUTHORIZED", message: "实时连接登录状态无效" });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: RoomSocket): Promise<void> {
    const affectedRooms = this.presence.disconnect(client.id);
    await Promise.all(affectedRooms.map((roomId) => this.broadcastRoom(roomId)));
  }

  @SubscribeMessage("clock:ping")
  handleClockPing(@MessageBody() _sentAtClientMs: number): number {
    return Date.now();
  }

  @SubscribeMessage("room:join")
  async handleJoin(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() payload: { roomId: string },
  ): Promise<{ joined: boolean; serverMs: number }> {
    const user = this.requireUser(client);
    await this.rooms.getRoom(payload.roomId, user);
    await client.join(this.channel(payload.roomId));
    this.presence.join(client.id, payload.roomId);
    await this.broadcastRoom(payload.roomId);
    return { joined: true, serverMs: Date.now() };
  }

  @SubscribeMessage("room:leave")
  async handleLeave(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() payload: { roomId: string },
  ): Promise<{ left: boolean }> {
    this.requireUser(client);
    await client.leave(this.channel(payload.roomId));
    this.presence.leave(client.id, payload.roomId);
    await this.broadcastRoom(payload.roomId);
    return { left: true };
  }

  @SubscribeMessage("asset:ready")
  async handleAssetReady(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() payload: { sessionId: string; checksum: string },
  ): Promise<{ accepted: boolean; scheduled: boolean }> {
    const user = this.requireUser(client);
    const transition = await this.playback.markReady(payload.sessionId, user.id, payload.checksum);
    this.broadcastPlaybackSnapshot(transition.snapshot);
    if (transition.command) this.broadcastPlaybackCommand(transition.snapshot.roomId, transition.command);
    await this.broadcastRoom(transition.snapshot.roomId);
    return { accepted: true, scheduled: transition.command?.action === "START" };
  }

  @SubscribeMessage("playback:position")
  async handlePosition(
    @ConnectedSocket() client: RoomSocket,
    @MessageBody() payload: {
      sessionId: string;
      sequence: number;
      positionMs: number;
      observedAtClientMs: number;
    },
  ): Promise<{ accepted: boolean; serverMs: number }> {
    const user = this.requireUser(client);
    return this.playback.reportPosition(
      payload.sessionId,
      user.id,
      payload.sequence,
      payload.positionMs,
      payload.observedAtClientMs,
    );
  }

  broadcastPlaybackSnapshot(snapshot: PlaybackSnapshot): void {
    this.server.to(this.channel(snapshot.roomId)).emit("playback:snapshot", snapshot);
  }

  broadcastPlaybackCommand(roomId: string, command: PlaybackCommand): void {
    this.server.to(this.channel(roomId)).emit("playback:command", command);
  }

  async broadcastRoom(roomId: string): Promise<void> {
    try {
      const room = await this.rooms.getRoomForBroadcast(roomId);
      this.server.to(this.channel(roomId)).emit("room:details", room);
      this.server.to(this.channel(roomId)).emit("room:snapshot", room);
      this.server.to(this.channel(roomId)).emit("room:presence", {
        roomId,
        onlineUserIds: this.presence.getOnlineUserIds(roomId),
      });
    } catch {
      // 房间关闭后无需再广播快照。
    }
  }

  private extractToken(client: RoomSocket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string" && authToken) return authToken;
    const authorization = client.handshake.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      return authorization.slice(7);
    }
    return null;
  }

  private requireUser(client: RoomSocket): CurrentUser {
    const user = client.data.currentUser;
    if (!user) throw new WsException("实时连接尚未登录");
    return user;
  }

  private channel(roomId: string): string {
    return `room:${roomId}`;
  }
}
