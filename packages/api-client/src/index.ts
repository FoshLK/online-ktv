import type {
  AdminAuditLogList,
  AdminImportJobList,
  AdminOverview,
  AdminPlaybackHistoryList,
  AdminRoomActionRequest,
  AdminRoomCloseResult,
  AdminRoomList,
  AdminSongList,
  AdminSongSummary,
  AdminUpdateUserRequest,
  AdminUserList,
  AdminUserSummary,
  AuthSession,
  AuthTokens,
  CreateRoomRequest,
  CurrentUser,
  JoinRoomResult,
  LeaveRoomResult,
  LoginRequest,
  ImportSongMetadata,
  PlaybackControlRequest,
  PlaybackSnapshot,
  PreparePlaybackRequest,
  RegisterRequest,
  RegisterResponse,
  RoomDetails,
  RoomSummary,
  SongSummary,
  SongAssetManifest,
  SongImportResult,
  UpdateRoomRequest,
  VerifyEmailRequest,
} from "@ktv/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface KtvServerEndpoints {
  origin: string;
  apiUrl: string;
  roomSocketUrl: string;
}

/**
 * Accepts either a server origin (10.126.126.1:3000) or the legacy /api URL
 * and returns the two endpoints used by the desktop applications.
 */
export function resolveKtvServerEndpoints(value: string): KtvServerEndpoints {
  const candidate = value.trim();
  if (!candidate) throw new Error("服务器地址不能为空");

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("服务器地址格式无效");
  }

  if (!(["http:", "https:"] as string[]).includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("服务器地址必须使用 HTTP 或 HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("服务器地址不能包含账号、查询参数或片段");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath && normalizedPath !== "/api") {
    throw new Error("服务器地址只能填写主机与端口，可选以 /api 结尾");
  }

  const origin = parsed.origin;
  return {
    origin,
    apiUrl: `${origin}/api`,
    roomSocketUrl: `${origin}/rooms`,
  };
}

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: AuthTokens): void;
  clear(): void;
}

export function createBrowserTokenStore(storage: Storage, namespace: string): TokenStore {
  const accessKey = `${namespace}:access-token`;
  const refreshKey = `${namespace}:refresh-token`;

  return {
    getAccessToken: () => storage.getItem(accessKey),
    getRefreshToken: () => storage.getItem(refreshKey),
    setTokens: (tokens) => {
      storage.setItem(accessKey, tokens.accessToken);
      storage.setItem(refreshKey, tokens.refreshToken);
    },
    clear: () => {
      storage.removeItem(accessKey);
      storage.removeItem(refreshKey);
    },
  };
}

export class KtvApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenStore: TokenStore,
  ) {}

  async register(payload: RegisterRequest): Promise<RegisterResponse> {
    return this.request("/auth/register", { method: "POST", body: JSON.stringify(payload) }, false);
  }

  async verifyEmail(payload: VerifyEmailRequest): Promise<{ verified: true }> {
    return this.request("/auth/verify-email", { method: "POST", body: JSON.stringify(payload) }, false);
  }

  async resendVerification(email: string): Promise<{ accepted: true; delivery: "smtp" | "development-log" }> {
    return this.request("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }, false);
  }

  async login(payload: LoginRequest): Promise<AuthSession> {
    const session = await this.request<AuthSession>("/auth/login", { method: "POST", body: JSON.stringify(payload) }, false);
    this.tokenStore.setTokens(session);
    return session;
  }

  async me(): Promise<CurrentUser> {
    return this.request("/auth/me", { method: "GET" });
  }

  async listRooms(): Promise<RoomSummary[]> {
    return this.request("/rooms", { method: "GET" });
  }

  async getRoom(roomId: string): Promise<RoomDetails> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}`, { method: "GET" });
  }

  async createRoom(payload: CreateRoomRequest): Promise<RoomDetails> {
    return this.request("/rooms", { method: "POST", body: JSON.stringify(payload) });
  }

  async updateRoom(roomId: string, payload: UpdateRoomRequest): Promise<RoomDetails> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  }

  async joinRoom(roomId: string): Promise<JoinRoomResult> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}/join`, { method: "POST" });
  }

  async leaveRoom(roomId: string): Promise<LeaveRoomResult> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}/leave`, { method: "POST" });
  }

  async closeRoom(roomId: string): Promise<void> {
    await this.request(`/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
  }

  async getAdminOverview(): Promise<AdminOverview> {
    return this.request("/admin/overview", { method: "GET" });
  }

  async listAdminRooms(): Promise<AdminRoomList> {
    return this.request("/admin/rooms", { method: "GET" });
  }

  async closeAdminRoom(roomId: string, payload: AdminRoomActionRequest): Promise<AdminRoomCloseResult> {
    return this.request(`/admin/rooms/${encodeURIComponent(roomId)}/close`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async removeAdminRoomMember(
    roomId: string,
    userId: string,
    payload: AdminRoomActionRequest,
  ): Promise<RoomDetails> {
    return this.request(
      `/admin/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/remove`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  }

  async listAdminUsers(query = "", page = 1, pageSize = 50): Promise<AdminUserList> {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) parameters.set("q", query);
    return this.request(`/admin/users?${parameters.toString()}`, { method: "GET" });
  }

  async updateAdminUser(userId: string, payload: AdminUpdateUserRequest): Promise<AdminUserSummary> {
    return this.request(`/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async listAdminImportJobs(query = "", page = 1, pageSize = 50): Promise<AdminImportJobList> {
    return this.request(`/admin/import-jobs?${this.adminListParameters(query, page, pageSize)}`, { method: "GET" });
  }

  async listAdminPlaybackHistory(query = "", page = 1, pageSize = 50): Promise<AdminPlaybackHistoryList> {
    return this.request(`/admin/playback-history?${this.adminListParameters(query, page, pageSize)}`, { method: "GET" });
  }

  async listAdminAuditLogs(query = "", page = 1, pageSize = 50): Promise<AdminAuditLogList> {
    return this.request(`/admin/audit-logs?${this.adminListParameters(query, page, pageSize)}`, { method: "GET" });
  }

  async listSongs(query = ""): Promise<SongSummary[]> {
    const search = query ? `?q=${encodeURIComponent(query)}` : "";
    return this.request(`/songs${search}`, { method: "GET" });
  }

  async getSongManifest(songId: string): Promise<SongAssetManifest> {
    return this.request(`/songs/${encodeURIComponent(songId)}/manifest`, { method: "GET" });
  }

  async listAdminSongs(query = ""): Promise<AdminSongList> {
    const search = query ? `?q=${encodeURIComponent(query)}` : "";
    return this.request(`/admin/songs${search}`, { method: "GET" });
  }

  async importSong(metadata: ImportSongMetadata, audio: File, lyric: File): Promise<SongImportResult> {
    const body = new FormData();
    body.set("title", metadata.title);
    body.set("artist", metadata.artist);
    if (metadata.album) body.set("album", metadata.album);
    body.set("durationMs", String(metadata.durationMs));
    body.set("copyrightNote", metadata.copyrightNote);
    body.set("rightsConfirmed", String(metadata.rightsConfirmed));
    body.set("audio", audio, audio.name);
    body.set("lyric", lyric, lyric.name);
    return this.request("/admin/songs/import", { method: "POST", body });
  }

  async updateAdminSongStatus(
    songId: string,
    status: "PUBLISHED" | "DISABLED",
    reason: string,
  ): Promise<AdminSongSummary> {
    return this.request(`/admin/songs/${encodeURIComponent(songId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
  }

  resolveUrl(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  async preparePlayback(roomId: string, payload: PreparePlaybackRequest): Promise<PlaybackSnapshot> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}/playback/prepare`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async controlPlayback(roomId: string, payload: PlaybackControlRequest): Promise<PlaybackSnapshot> {
    return this.request(`/rooms/${encodeURIComponent(roomId)}/playback/control`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  async logout(): Promise<void> {
    const refreshToken = this.tokenStore.getRefreshToken();
    try {
      if (refreshToken) {
        await this.request("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, false);
      }
    } finally {
      this.tokenStore.clear();
    }
  }

  clearSession(): void {
    this.tokenStore.clear();
  }

  private adminListParameters(query: string, page: number, pageSize: number): string {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) parameters.set("q", query);
    return parameters.toString();
  }

  private async refresh(): Promise<boolean> {
    const refreshToken = this.tokenStore.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const tokens = await this.request<AuthTokens>(
        "/auth/refresh",
        { method: "POST", body: JSON.stringify({ refreshToken }) },
        false,
      );
      this.tokenStore.setTokens(tokens);
      return true;
    } catch {
      this.tokenStore.clear();
      return false;
    }
  }

  private async request<T>(path: string, init: RequestInit, authenticated = true, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    if (authenticated) {
      const accessToken = this.tokenStore.getAccessToken();
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (response.status === 401 && authenticated && retry && (await this.refresh())) {
      return this.request<T>(path, init, authenticated, false);
    }

    if (!response.ok) {
      const details = await response.json().catch(() => undefined);
      const rawMessage = details && typeof details === "object" && "message" in details ? details.message : undefined;
      const message = Array.isArray(rawMessage) ? rawMessage.join("；") : String(rawMessage ?? "请求失败");
      throw new ApiError(message, response.status, details);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
