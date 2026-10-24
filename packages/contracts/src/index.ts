export type EntityId = string;

export type UserRole = "USER" | "ADMIN" | "SUPER_ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";
export type RoomStatus = "OPEN" | "PLAYING" | "CLOSED";
export type RoomMemberRole = "OWNER" | "MODERATOR" | "MEMBER";
export type SongStatus = "DRAFT" | "PROCESSING" | "PUBLISHED" | "DISABLED";
export type PlaybackStatus = "PREPARING" | "SCHEDULED" | "PLAYING" | "PAUSED" | "ENDED" | "FAILED";
export type ImportJobStatus = "QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "FAILED" | "COMPLETED";

export interface CurrentUser {
  id: EntityId;
  username: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  userId: EntityId;
  email: string;
  verificationRequired: true;
  delivery: "smtp" | "development-log";
}

export interface VerifyEmailRequest {
  email: string;
  code: string;
}

export interface LoginRequest {
  login: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: string;
}

export interface AuthSession extends AuthTokens {
  user: CurrentUser;
}

export interface RoomSummary {
  id: EntityId;
  name: string;
  ownerId: EntityId;
  ownerName: string;
  status: RoomStatus;
  memberCount: number;
  capacity: number;
  announcement?: string;
  currentSong?: SongSummary;
}

export interface RoomMemberSummary {
  userId: EntityId;
  username: string;
  role: RoomMemberRole;
  joinedAt: string;
  muted: boolean;
  online: boolean;
}

export interface RoomDetails extends RoomSummary {
  members: RoomMemberSummary[];
  currentPlayback?: PlaybackSnapshot;
}

export interface CreateRoomRequest {
  name: string;
  capacity: number;
  announcement?: string;
}

export interface UpdateRoomRequest {
  name?: string;
  capacity?: number;
  announcement?: string | null;
}

export interface JoinRoomResult {
  room: RoomDetails;
  joined: true;
}

export interface LeaveRoomResult {
  roomId: EntityId;
  left: true;
  roomClosed: boolean;
}

export interface SongSummary {
  id: EntityId;
  title: string;
  artist: string;
  durationMs: number;
  status: SongStatus;
  coverUrl?: string;
  assetVersion: number;
}

export interface SongAssetDescriptor {
  id: EntityId;
  kind: "AUDIO" | "LYRIC_SOURCE";
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  fileName: string;
}

export interface SongAssetManifest {
  song: SongSummary;
  audio: SongAssetDescriptor;
  lyric?: SongAssetDescriptor;
}

export interface AdminSongSummary extends SongSummary {
  album?: string;
  copyrightNote?: string;
  publishedAt?: string;
  createdAt: string;
  audio?: SongAssetDescriptor;
  lyric?: SongAssetDescriptor;
}

export interface AdminSongList {
  items: AdminSongSummary[];
  total: number;
}

export interface ImportSongMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  copyrightNote: string;
  rightsConfirmed: true;
}

export interface SongImportResult {
  jobId: EntityId;
  song: AdminSongSummary;
}

export interface PlaybackSnapshot {
  sessionId: EntityId;
  roomId: EntityId;
  song: SongSummary;
  state: PlaybackStatus;
  sequence: number;
  assetVersion: number;
  expectedChecksum: string;
  startAtServerMs?: number;
  pausedPositionMs?: number;
  readyUserIds: EntityId[];
  waitingUserIds: EntityId[];
}

export interface PreparePlaybackRequest {
  songId: EntityId;
}

export interface PlaybackControlRequest {
  action: "PAUSE" | "RESUME" | "SEEK" | "STOP";
  positionMs?: number;
}

export interface PlaybackCommand {
  sessionId: EntityId;
  roomId: EntityId;
  action: "START" | "PAUSE" | "RESUME" | "SEEK" | "STOP";
  sequence: number;
  effectiveAtServerMs: number;
  positionMs?: number;
}

export interface AdminOverview {
  generatedAt: string;
  stats: {
    registeredUsers: number;
    onlineUsers: number;
    activeRooms: number;
    pendingImportJobs: number;
  };
  activeRooms: RoomSummary[];
  recentImportJobs: AdminImportJobSummary[];
}

export interface AdminRoomList {
  items: RoomDetails[];
  total: number;
  generatedAt: string;
}

export interface AdminRoomActionRequest {
  reason: string;
}

export interface AdminRoomCloseResult {
  roomId: EntityId;
  closed: true;
}

export interface AdminUserSummary extends CurrentUser {
  createdAt: string;
  activeSessionCount: number;
}

export interface AdminUserList {
  items: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUpdateUserRequest {
  status?: UserStatus;
  role?: UserRole;
  reason: string;
}

export interface AdminImportJobSummary {
  id: EntityId;
  status: ImportJobStatus;
  progress: number;
  sourceType: string;
  sourceLabel?: string;
  errorCode?: string;
  errorDetail?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  creator: {
    id: EntityId;
    username: string;
  };
  song?: {
    id: EntityId;
    title: string;
    artist: string;
  };
}

export interface AdminImportJobList {
  items: AdminImportJobSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminPlaybackHistoryItem {
  id: EntityId;
  roomId: EntityId;
  roomName: string;
  song: SongSummary;
  state: PlaybackStatus;
  sequence: number;
  assetVersion: number;
  participantCount: number;
  readyCount: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
}

export interface AdminPlaybackHistoryList {
  items: AdminPlaybackHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAuditLogSummary {
  id: EntityId;
  actor?: {
    id: EntityId;
    username: string;
  };
  action: string;
  targetType: string;
  targetId?: string;
  reason?: string;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress?: string;
  createdAt: string;
}

export interface AdminAuditLogList {
  items: AdminAuditLogSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiHealth {
  status: "ok" | "degraded";
  service: string;
  version: string;
  timestamp: string;
}

export interface ClientToServerEvents {
  "clock:ping": (sentAtClientMs: number, acknowledge: (serverMs: number) => void) => void;
  "room:join": (payload: { roomId: EntityId }, acknowledge?: (result: { joined: boolean; serverMs: number }) => void) => void;
  "room:leave": (payload: { roomId: EntityId }, acknowledge?: (result: { left: boolean }) => void) => void;
  "asset:ready": (payload: {
    sessionId: EntityId;
    checksum: string;
  }, acknowledge?: (result: { accepted: boolean; scheduled: boolean }) => void) => void;
  "playback:position": (payload: {
    sessionId: EntityId;
    sequence: number;
    positionMs: number;
    observedAtClientMs: number;
  }, acknowledge?: (result: { accepted: boolean; serverMs: number }) => void) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (room: RoomSummary) => void;
  "room:details": (room: RoomDetails) => void;
  "room:presence": (payload: { roomId: EntityId; onlineUserIds: EntityId[] }) => void;
  "playback:snapshot": (snapshot: PlaybackSnapshot) => void;
  "playback:command": (payload: PlaybackCommand) => void;
  "system:error": (payload: { code: string; message: string }) => void;
}
