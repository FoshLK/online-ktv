import type {
  AdminOverview,
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
  PlaybackControlRequest,
  PlaybackSnapshot,
  PreparePlaybackRequest,
  RegisterRequest,
  RegisterResponse,
  RoomDetails,
  RoomSummary,
  SongSummary,
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

  async listSongs(query = ""): Promise<SongSummary[]> {
    const search = query ? `?q=${encodeURIComponent(query)}` : "";
    return this.request(`/songs${search}`, { method: "GET" });
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
    headers.set("Content-Type", "application/json");
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
