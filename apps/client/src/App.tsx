import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ApiError, createBrowserTokenStore, KtvApiClient, resolveKtvServerEndpoints } from "@ktv/api-client";
import type {
  ClientToServerEvents,
  CurrentUser,
  PlaybackCommand,
  PlaybackControlRequest,
  PlaybackSnapshot,
  RoomDetails,
  RoomSummary,
  ServerToClientEvents,
  SongSummary,
} from "@ktv/contracts";
import { DesktopShell, Panel, StatusBadge } from "@ktv/ui";
import { io, type Socket } from "socket.io-client";
import { SynchronizedPlayer, type CachedPlaybackAssets } from "./playback/SynchronizedPlayer";

const navigation = [
  { id: "hall", label: "房间大厅", icon: "⌂" },
  { id: "rooms", label: "我的房间", icon: "◉" },
  { id: "songs", label: "曲库", icon: "♫" },
  { id: "downloads", label: "下载管理", icon: "⇩" },
  { id: "settings", label: "设置", icon: "⚙" },
];

const serverStorageKey = "ktv-client:server-origin";

function initialServerOrigin(): string {
  const configured = localStorage.getItem(serverStorageKey) ?? import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3000";
  try {
    return resolveKtvServerEndpoints(configured).origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

export function App() {
  const [serverOrigin, setServerOrigin] = useState(initialServerOrigin);
  const endpoints = useMemo(() => resolveKtvServerEndpoints(serverOrigin), [serverOrigin]);
  const tokenStore = useMemo(() => createBrowserTokenStore(localStorage, "ktv-client"), []);
  const api = useMemo(
    () => new KtvApiClient(endpoints.apiUrl, tokenStore),
    [endpoints.apiUrl, tokenStore],
  );
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.me().then(setUser).catch(() => api.clearSession()).finally(() => setLoading(false));
  }, [api]);

  const changeServer = (value: string) => {
    const next = resolveKtvServerEndpoints(value).origin;
    if (next === serverOrigin) return;
    api.clearSession();
    localStorage.setItem(serverStorageKey, next);
    setUser(null);
    setServerOrigin(next);
  };

  if (loading) return <div className="auth-screen"><div className="auth-loading">正在恢复登录状态…</div></div>;
  if (!user) return <AuthScreen api={api} serverOrigin={serverOrigin} onServerChange={changeServer} onAuthenticated={setUser} />;
  return (
    <KtvHome
      api={api}
      user={user}
      roomSocketUrl={endpoints.roomSocketUrl}
      serverOrigin={serverOrigin}
      onServerChange={changeServer}
      onLogout={async () => {
        await api.logout();
        setUser(null);
      }}
    />
  );
}

function AuthScreen({
  api,
  serverOrigin,
  onServerChange,
  onAuthenticated,
}: {
  api: KtvApiClient;
  serverOrigin: string;
  onServerChange: (value: string) => void;
  onAuthenticated: (user: CurrentUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "verify">("login");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (mode === "register") {
        const result = await api.register({ username, email, password });
        setEmail(result.email);
        setNotice(result.delivery === "development-log" ? "开发模式：验证码已输出到服务端终端。" : "验证码已发送，请检查邮箱。");
        setMode("verify");
      } else if (mode === "verify") {
        await api.verifyEmail({ email, code });
        setLogin(email);
        setNotice("邮箱验证成功，现在可以登录。");
        setMode("login");
      } else {
        const session = await api.login({ login, password });
        onAuthenticated(session.user);
      }
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法连接服务器，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand"><span>K</span><div><strong>线上 KTV</strong><small>和朋友唱在一起</small></div></div>
        <div className="auth-heading">
          <h1>{mode === "login" ? "欢迎回来" : mode === "register" ? "创建账号" : "验证邮箱"}</h1>
          <p>{mode === "verify" ? `验证码已发送至 ${email}` : "登录后进入你的音乐房间"}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={2} maxLength={32} required placeholder="2–32 个字符" /></label>}
          {mode === "register" && <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="用于接收验证码" /></label>}
          {mode === "login" && <label>用户名或邮箱<input value={login} onChange={(event) => setLogin(event.target.value)} required autoComplete="username" placeholder="输入用户名或邮箱" /></label>}
          {mode !== "verify" && <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 8 个字符" /></label>}
          {mode === "verify" && <label>6 位验证码<input className="verification-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="\d{6}" required placeholder="000000" /></label>}
          {notice && <p className="form-notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
          <button className="auth-submit" disabled={submitting} type="submit">{submitting ? "请稍候…" : mode === "login" ? "登录" : mode === "register" ? "注册并验证" : "完成验证"}</button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? <button type="button" onClick={() => { setMode("register"); setError(""); }}>还没有账号？立即注册</button> : <button type="button" onClick={() => { setMode("login"); setError(""); }}>返回账号登录</button>}
          {mode === "verify" && <button type="button" onClick={async () => { const result = await api.resendVerification(email); setNotice(result.delivery === "development-log" ? "新验证码已输出到服务端终端。" : "新验证码已发送。"); }}>重新发送验证码</button>}
        </div>
        <ServerAddressEditor serverOrigin={serverOrigin} onSave={onServerChange} compact />
      </section>
      <aside className="auth-visual"><div className="auth-orbit"><span>♫</span></div><h2>同步每一次开唱</h2><p>歌曲准备、服务器时钟与播放状态都由房间统一协调。</p></aside>
    </div>
  );
}

function KtvHome({
  api,
  user,
  roomSocketUrl,
  serverOrigin,
  onServerChange,
  onLogout,
}: {
  api: KtvApiClient;
  user: CurrentUser;
  roomSocketUrl: string;
  serverOrigin: string;
  onServerChange: (value: string) => void;
  onLogout: () => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("hall");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomDetails | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [workingRoomId, setWorkingRoomId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [socketState, setSocketState] = useState<"offline" | "connecting" | "online">("offline");
  const [clockOffsetMs, setClockOffsetMs] = useState<number | null>(null);
  const [clockRttMs, setClockRttMs] = useState<number | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [preparingSongId, setPreparingSongId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadState[]>([]);
  const [cachedPlaybackAssets, setCachedPlaybackAssets] = useState<Record<string, CachedPlaybackAssets>>({});
  const [playbackCommand, setPlaybackCommand] = useState<PlaybackCommand | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const preparingSessions = useRef(new Set<string>());
  const cachedPlaybackAssetsRef = useRef(new Map<string, CachedPlaybackAssets>());
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  const loadRooms = useCallback(async () => {
    setError("");
    try {
      setRooms(await api.listRooms());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取房间列表");
    } finally {
      setLoadingRooms(false);
    }
  }, [api]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const loadSongs = useCallback(async (query = "") => {
    setLoadingSongs(true);
    setError("");
    try {
      setSongs(await api.listSongs(query));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取曲库");
    } finally {
      setLoadingSongs(false);
    }
  }, [api]);

  useEffect(() => {
    if (activeId === "songs") void loadSongs();
  }, [activeId, loadSongs]);

  useEffect(() => {
    if (!currentRoom) {
      setSocketState("offline");
      setClockOffsetMs(null);
      setClockRttMs(null);
      return;
    }

    setSocketState("connecting");
    setClockOffsetMs(null);
    setClockRttMs(null);
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(roomSocketUrl, {
      auth: { token: api.getAccessToken() },
      transports: ["websocket"],
      reconnection: true,
    });
    socketRef.current = socket;
    let closed = false;
    const retryTimers = new Set<number>();
    const clockTimers = new Set<number>();
    let clockInterval: number | undefined;

    const updateDownload = (entry: DownloadState) => {
      setDownloads((items) => {
        const existing = items.findIndex((item) => item.sessionId === entry.sessionId);
        if (existing < 0) return [entry, ...items].slice(0, 20);
        return items.map((item, index) => index === existing ? entry : item);
      });
    };

    const prepareAssets = (snapshot: PlaybackSnapshot, attempt = 1) => {
      if (closed || snapshot.state === "ENDED" || snapshot.state === "FAILED") return;
      const cachedAsset = cachedPlaybackAssetsRef.current.get(snapshot.sessionId);
      if (cachedAsset) {
        if (snapshot.waitingUserIds.includes(user.id)) {
          socket.emit("asset:ready", { sessionId: snapshot.sessionId, checksum: snapshot.expectedChecksum });
        }
        return;
      }
      if (preparingSessions.current.has(snapshot.sessionId)) return;
      preparingSessions.current.add(snapshot.sessionId);
      updateDownload({
        sessionId: snapshot.sessionId,
        songTitle: snapshot.song.title,
        status: "downloading",
        detail: attempt === 1 ? "正在下载并校验音频与歌词" : `第 ${attempt} 次重试下载`,
      });

      void (async () => {
        const manifest = await api.getSongManifest(snapshot.song.id);
        if (manifest.audio.sha256.toLowerCase() !== snapshot.expectedChecksum.toLowerCase()) {
          throw new Error("播放会话与曲库音频校验值不一致");
        }
        const token = api.getAccessToken();
        if (!token) throw new Error("登录状态已失效");
        const assets = [manifest.audio, ...(manifest.lyric ? [manifest.lyric] : [])];
        let audioResult: CachedAsset | undefined;
        let lyricResult: CachedAsset | undefined;
        for (const asset of assets) {
          const result = await invoke<CachedAsset>("cache_song_asset", {
            url: api.resolveUrl(asset.downloadUrl),
            accessToken: token,
            songId: snapshot.song.id,
            assetVersion: snapshot.assetVersion,
            expectedSha256: asset.sha256,
            fileName: asset.fileName,
          });
          if (asset.kind === "AUDIO") audioResult = result;
          if (asset.kind === "LYRIC_SOURCE") lyricResult = result;
        }
        if (!audioResult) throw new Error("音频资源清单为空");

        const cached: CachedPlaybackAssets = {
          sessionId: snapshot.sessionId,
          audioPath: audioResult.path,
          ...(lyricResult ? { lyricPath: lyricResult.path } : {}),
        };
        cachedPlaybackAssetsRef.current.set(snapshot.sessionId, cached);
        setCachedPlaybackAssets((items) => ({ ...items, [snapshot.sessionId]: cached }));
        const cacheHit = audioResult.cacheHit && (lyricResult?.cacheHit ?? true);

        if (!snapshot.waitingUserIds.includes(user.id)) {
          updateDownload({
            sessionId: snapshot.sessionId,
            songTitle: snapshot.song.title,
            status: "ready",
            detail: `${cacheHit ? "已命中本地缓存" : "资源已恢复"}，播放器已就绪`,
            path: audioResult.path,
          });
          return;
        }

        socket.emit("asset:ready", { sessionId: snapshot.sessionId, checksum: audioResult.sha256 }, (result) => {
          if (!result?.accepted) {
            updateDownload({ sessionId: snapshot.sessionId, songTitle: snapshot.song.title, status: "error", detail: "服务器未接受资源就绪状态" });
            return;
          }
          updateDownload({
            sessionId: snapshot.sessionId,
            songTitle: snapshot.song.title,
            status: "ready",
            detail: `${cacheHit ? "已命中本地缓存" : "下载完成"}，SHA-256 校验通过`,
            path: audioResult?.path,
          });
        });
      })().catch((downloadError) => {
        preparingSessions.current.delete(snapshot.sessionId);
        const message = downloadError instanceof Error ? downloadError.message : String(downloadError);
        updateDownload({ sessionId: snapshot.sessionId, songTitle: snapshot.song.title, status: "error", detail: message });
        if (!closed && attempt < 3) {
          const timer = window.setTimeout(() => {
            retryTimers.delete(timer);
            prepareAssets(snapshot, attempt + 1);
          }, attempt * 2_000);
          retryTimers.add(timer);
        }
      });
    };

    const pingClock = () => {
      const sentAt = Date.now();
      socket.emit("clock:ping", sentAt, (serverMs) => {
        if (closed) return;
        const receivedAt = Date.now();
        const roundTripMs = receivedAt - sentAt;
        if (roundTripMs > 2_000) return;
        setClockRttMs(roundTripMs);
        setClockOffsetMs(serverMs - Math.round((sentAt + receivedAt) / 2));
      });
    };

    socket.on("connect", () => {
      setSocketState("online");
      socket.emit("room:join", { roomId: currentRoom.id });
      if (clockInterval !== undefined) window.clearInterval(clockInterval);
      for (const delay of [0, 180, 420]) {
        const timer = window.setTimeout(() => {
          clockTimers.delete(timer);
          pingClock();
        }, delay);
        clockTimers.add(timer);
      }
      clockInterval = window.setInterval(pingClock, 15_000);
    });
    socket.on("disconnect", () => {
      setSocketState("offline");
      if (clockInterval !== undefined) window.clearInterval(clockInterval);
      clockInterval = undefined;
    });
    socket.on("room:details", (room) => {
      if (room.id !== currentRoom.id) return;
      setCurrentRoom(room);
      setRooms((items) => items.map((item) => item.id === room.id ? room : item));
      if (room.currentPlayback) prepareAssets(room.currentPlayback);
    });
    socket.on("playback:snapshot", (snapshot) => {
      if (snapshot.roomId !== currentRoom.id) return;
      setCurrentRoom((room) => {
        if (!room) return room;
        if (snapshot.state === "ENDED" || snapshot.state === "FAILED") {
          return { ...room, status: "OPEN", currentSong: undefined, currentPlayback: undefined };
        }
        return {
          ...room,
          status: snapshot.state === "PREPARING" ? room.status : "PLAYING",
          currentSong: snapshot.song,
          currentPlayback: snapshot,
        };
      });
      prepareAssets(snapshot);
    });
    socket.on("playback:command", (nextCommand) => {
      if (nextCommand.roomId === currentRoom.id) setPlaybackCommand(nextCommand);
    });
    socket.on("system:error", (payload) => setError(payload.message));

    return () => {
      closed = true;
      socketRef.current = null;
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      clockTimers.forEach((timer) => window.clearTimeout(timer));
      if (clockInterval !== undefined) window.clearInterval(clockInterval);
      socket.emit("room:leave", { roomId: currentRoom.id });
      socket.disconnect();
    };
  }, [api, currentRoom?.id, user.id]);

  const joinRoom = async (roomId: string) => {
    setWorkingRoomId(roomId);
    setError("");
    try {
      const result = await api.joinRoom(roomId);
      setCurrentRoom(result.room);
      setActiveId("rooms");
      await loadRooms();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "加入房间失败");
    } finally {
      setWorkingRoomId(null);
    }
  };

  const leaveRoom = async () => {
    if (!currentRoom) return;
    setWorkingRoomId(currentRoom.id);
    setError("");
    try {
      await api.leaveRoom(currentRoom.id);
      setCurrentRoom(null);
      setPlaybackCommand(null);
      setActiveId("hall");
      await loadRooms();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "退出房间失败");
    } finally {
      setWorkingRoomId(null);
    }
  };

  const prepareSong = async (song: SongSummary) => {
    if (!currentRoom) {
      setError("请先创建或加入一个房间");
      return;
    }
    setPreparingSongId(song.id);
    setError("");
    try {
      const snapshot = await api.preparePlayback(currentRoom.id, { songId: song.id });
      setPlaybackCommand(null);
      setCurrentRoom((room) => room ? { ...room, currentSong: snapshot.song, currentPlayback: snapshot } : room);
      setActiveId("rooms");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "歌曲准备失败");
    } finally {
      setPreparingSongId(null);
    }
  };

  const controlPlayback = async (action: PlaybackControlRequest["action"], positionMs?: number) => {
    if (!currentRoom) return;
    setControlBusy(true);
    setError("");
    try {
      const snapshot = await api.controlPlayback(currentRoom.id, {
        action,
        ...(positionMs === undefined ? {} : { positionMs: Math.round(positionMs) }),
      });
      setCurrentRoom((room) => room ? {
        ...room,
        status: action === "STOP" ? "OPEN" : "PLAYING",
        currentSong: action === "STOP" ? undefined : snapshot.song,
        currentPlayback: action === "STOP" ? undefined : snapshot,
      } : room);
      if (action === "STOP") setPlaybackCommand(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "播放控制失败");
    } finally {
      setControlBusy(false);
    }
  };

  const reportPlaybackPosition = useCallback((snapshot: PlaybackSnapshot, positionMs: number) => {
    socketRef.current?.emit("playback:position", {
      sessionId: snapshot.sessionId,
      sequence: snapshot.sequence,
      positionMs,
      observedAtClientMs: Date.now(),
    });
  }, []);

  const currentMembership = currentRoom?.members.find((member) => member.userId === user.id);
  const canControlPlayback = Boolean(
    currentRoom && (
      currentRoom.ownerId === user.id
      || currentMembership?.role === "MODERATOR"
      || user.role === "ADMIN"
      || user.role === "SUPER_ADMIN"
    )
  );

  const title = activeId === "rooms" ? "我的房间" : activeId === "hall" ? "房间大厅" : navigation.find((item) => item.id === activeId)?.label ?? "线上 KTV";

  return (
    <DesktopShell
      brand="线上 KTV"
      subtitle="唱在一起"
      navigation={navigation}
      activeId={activeId}
      onNavigate={setActiveId}
      header={
        <div className="header-row">
          <div>
            <h1 className="header-title">{title}</h1>
            <p className="header-subtitle">{currentRoom ? `当前在「${currentRoom.name}」` : "找到朋友，准备好歌曲后一起开唱"}</p>
          </div>
          <button className="user-chip user-button" onClick={() => void onLogout()} type="button" title="退出登录"><span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span><span>{user.username}</span></button>
        </div>
      }
    >
      {error && <div className="workspace-error"><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      {activeId === "hall" || activeId === "rooms" ? (
        <div className="client-layout">
          <div className="room-column">
            <section className="hero-card">
              <div>
                <StatusBadge tone={socketState === "online" || !currentRoom ? "success" : "warning"}>
                  {currentRoom ? (socketState === "online" ? "实时连接正常" : "正在连接房间") : "大厅已连接"}
                </StatusBadge>
                <h2>{currentRoom ? currentRoom.name : "今晚，唱点喜欢的"}</h2>
                <p>{currentRoom?.announcement || "资源准备完成后，服务器会为所有成员安排同一开始时间。"}</p>
              </div>
              {currentRoom
                ? <button className="ghost-button" disabled={workingRoomId === currentRoom.id} onClick={() => void leaveRoom()} type="button">{currentRoom.ownerId === user.id ? "关闭并退出房间" : "退出房间"}</button>
                : <button className="primary-button" onClick={() => setShowCreate(true)} type="button">＋ 创建房间</button>}
            </section>

            {activeId === "rooms" && currentRoom ? (
              <RoomMembers room={currentRoom} user={user} clockOffsetMs={clockOffsetMs} clockRttMs={clockRttMs} />
            ) : (
              <Panel
                title="在线房间"
                action={<button className="panel-action" disabled={loadingRooms} onClick={() => void loadRooms()} type="button">{loadingRooms ? "读取中…" : "刷新"}</button>}
              >
                {rooms.length > 0 ? (
                  <div className="room-grid">
                    {rooms.map((room) => (
                      <button className="room-card" disabled={Boolean(workingRoomId)} key={room.id} onClick={() => void joinRoom(room.id)} type="button">
                        <div className="room-cover"><span>♫</span></div>
                        <div className="room-meta">
                          <div className="room-title-row">
                            <h3>{room.name}</h3>
                            <StatusBadge tone={room.status === "PLAYING" ? "success" : "neutral"}>{room.status === "PLAYING" ? "演唱中" : "等待中"}</StatusBadge>
                          </div>
                          <p>{room.currentSong ? `${room.currentSong.title} · ${room.currentSong.artist}` : room.announcement || "等待点歌"}</p>
                          <footer><span>房主 {room.ownerName}</span><span>{room.memberCount}/{room.capacity} 人</span></footer>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state"><span>♫</span><strong>还没有开放的房间</strong><p>创建第一个房间，邀请朋友加入吧。</p></div>
                )}
              </Panel>
            )}
          </div>

          <SynchronizedPlayer
            room={currentRoom}
            assets={currentRoom?.currentPlayback ? cachedPlaybackAssets[currentRoom.currentPlayback.sessionId] : undefined}
            command={playbackCommand}
            clockOffsetMs={clockOffsetMs}
            canControl={canControlPlayback}
            controlBusy={controlBusy}
            onControl={controlPlayback}
            onReport={reportPlaybackPosition}
            onEnded={(snapshot) => {
              if (canControlPlayback && currentRoom?.currentPlayback?.sessionId === snapshot.sessionId) {
                void controlPlayback("STOP");
              }
            }}
          />
        </div>
      ) : activeId === "songs" ? (
        <SongLibrary
          songs={songs}
          loading={loadingSongs}
          currentRoom={currentRoom}
          currentUser={user}
          preparingSongId={preparingSongId}
          onSearch={loadSongs}
          onPrepare={prepareSong}
        />
      ) : activeId === "downloads" ? (
        <DownloadManager downloads={downloads} />
      ) : activeId === "settings" ? (
        <ServerSettings serverOrigin={serverOrigin} onSave={onServerChange} />
      ) : (
        <Panel title={title}>
          <div className="empty-state feature-placeholder"><span>⌁</span><strong>这一模块将在下一阶段接入</strong><p>房间与实时连接已经使用真实服务端数据。</p></div>
        </Panel>
      )}

      {showCreate && (
        <CreateRoomDialog
          api={api}
          onCancel={() => setShowCreate(false)}
          onCreated={(room) => {
            setCurrentRoom(room);
            setPlaybackCommand(null);
            setShowCreate(false);
            setActiveId("rooms");
            void loadRooms();
          }}
        />
      )}
    </DesktopShell>
  );
}

function ServerSettings({ serverOrigin, onSave }: { serverOrigin: string; onSave: (value: string) => void }) {
  return (
    <Panel title="服务器连接">
      <div className="server-settings-page">
        <div><strong>API 与房间服务</strong><p>填写服务端所在电脑的 EasyTier 虚拟 IP 与端口。保存后会退出当前账号并连接新服务器。</p></div>
        <ServerAddressEditor serverOrigin={serverOrigin} onSave={onSave} />
      </div>
    </Panel>
  );
}

function ServerAddressEditor({
  serverOrigin,
  onSave,
  compact = false,
}: {
  serverOrigin: string;
  onSave: (value: string) => void;
  compact?: boolean;
}) {
  const [value, setValue] = useState(serverOrigin);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => setValue(serverOrigin), [serverOrigin]);

  const save = () => {
    setError("");
    setSaved(false);
    try {
      const normalized = resolveKtvServerEndpoints(value).origin;
      onSave(normalized);
      setValue(normalized);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "服务器地址无效");
    }
  };

  return (
    <div className={`server-address-editor${compact ? " compact" : ""}`}>
      {compact && <span className="server-address-label">服务器连接</span>}
      <div className="server-address-row">
        <input aria-label="服务器地址" value={value} onChange={(event) => { setValue(event.target.value); setSaved(false); }} placeholder="http://10.126.126.1:3000" />
        <button type="button" onClick={save}>保存</button>
      </div>
      <small>{error || (saved ? "服务器地址已保存" : `当前：${serverOrigin}`)}</small>
    </div>
  );
}

interface CachedAsset {
  path: string;
  sha256: string;
  sizeBytes: number;
  cacheHit: boolean;
}

interface DownloadState {
  sessionId: string;
  songTitle: string;
  status: "downloading" | "ready" | "error";
  detail: string;
  path?: string;
}

function DownloadManager({ downloads }: { downloads: DownloadState[] }) {
  return (
    <Panel title="歌曲资源缓存">
      {downloads.length > 0 ? <div className="download-list">
        {downloads.map((download) => <div className="download-row" key={download.sessionId}>
          <span className={`download-icon ${download.status}`}>{download.status === "ready" ? "✓" : download.status === "error" ? "!" : "⇩"}</span>
          <div><strong>{download.songTitle}</strong><small>{download.detail}</small>{download.path && <code title={download.path}>{download.path}</code>}</div>
          <StatusBadge tone={download.status === "ready" ? "success" : download.status === "error" ? "danger" : "warning"}>{download.status === "ready" ? "已就绪" : download.status === "error" ? "失败" : "下载中"}</StatusBadge>
        </div>)}
      </div> : <div className="empty-state feature-placeholder"><span>⇩</span><strong>还没有资源下载记录</strong><p>房主发起播放后，桌面端会自动下载、校验并上报就绪。</p></div>}
    </Panel>
  );
}

function SongLibrary({
  songs,
  loading,
  currentRoom,
  currentUser,
  preparingSongId,
  onSearch,
  onPrepare,
}: {
  songs: SongSummary[];
  loading: boolean;
  currentRoom: RoomDetails | null;
  currentUser: CurrentUser;
  preparingSongId: string | null;
  onSearch: (query?: string) => Promise<void>;
  onPrepare: (song: SongSummary) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const membership = currentRoom?.members.find((member) => member.userId === currentUser.id);
  const canPrepare = Boolean(currentRoom && (currentRoom.ownerId === currentUser.id || membership?.role === "MODERATOR"));

  return (
    <Panel
      title="服务器曲库"
      action={
        <form className="song-search" onSubmit={(event) => { event.preventDefault(); void onSearch(query); }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="搜索歌名或歌手" />
          <button className="panel-action" disabled={loading} type="submit">{loading ? "搜索中…" : "搜索"}</button>
        </form>
      }
    >
      {!currentRoom && <div className="library-notice">先创建或加入房间，房主才能发起歌曲资源准备。</div>}
      {currentRoom && !canPrepare && <div className="library-notice">你可以浏览曲库；只有房主或房间管理员可以发起播放。</div>}
      {songs.length > 0 ? (
        <div className="song-list">
          {songs.map((song, index) => (
            <div className="song-row" key={song.id}>
              <span className="song-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="song-main"><strong>{song.title}</strong><small>{song.artist}</small></div>
              <span className="song-duration">{formatDuration(song.durationMs)}</span>
              <StatusBadge tone="success">资源 v{song.assetVersion}</StatusBadge>
              <button
                className="primary-button"
                disabled={!canPrepare || Boolean(currentRoom?.currentPlayback) || Boolean(preparingSongId)}
                onClick={() => void onPrepare(song)}
                type="button"
              >
                {preparingSongId === song.id ? "准备中…" : currentRoom?.currentPlayback ? "播放会话进行中" : "在房间播放"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state feature-placeholder"><span>♫</span><strong>{loading ? "正在读取曲库" : "曲库中还没有已发布歌曲"}</strong><p>歌曲导入完成并发布后会显示在这里。</p></div>
      )}
    </Panel>
  );
}

function RoomMembers({
  room,
  user,
  clockOffsetMs,
  clockRttMs,
}: {
  room: RoomDetails;
  user: CurrentUser;
  clockOffsetMs: number | null;
  clockRttMs: number | null;
}) {
  return (
    <Panel
      title={`房间成员 · ${room.memberCount}/${room.capacity}`}
      action={<span className="clock-state">时钟偏移 {clockOffsetMs === null ? "测量中" : `${clockOffsetMs >= 0 ? "+" : ""}${clockOffsetMs} ms`}{clockRttMs === null ? "" : ` · RTT ${clockRttMs} ms`}</span>}
    >
      <div className="member-list">
        {room.members.map((member) => (
          <div className="member-row" key={member.userId}>
            <span className="member-avatar">{member.username.slice(0, 1).toUpperCase()}</span>
            <div><strong>{member.username}{member.userId === user.id ? "（我）" : ""}</strong><small>{member.role === "OWNER" ? "房主" : member.role === "MODERATOR" ? "管理员" : "成员"}</small></div>
            <StatusBadge tone={member.online ? "success" : "neutral"}>{member.online ? "在线" : "离线"}</StatusBadge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CreateRoomDialog({
  api,
  onCancel,
  onCreated,
}: {
  api: KtvApiClient;
  onCancel: () => void;
  onCreated: (room: RoomDetails) => void;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(10);
  const [announcement, setAnnouncement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      onCreated(await api.createRoom({ name, capacity, announcement: announcement || undefined }));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "创建房间失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="room-dialog" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
        <div className="dialog-heading"><div><h2 id="create-room-title">创建 KTV 房间</h2><p>创建后你将成为房主</p></div><button onClick={onCancel} type="button">×</button></div>
        <form onSubmit={submit}>
          <label>房间名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} minLength={1} maxLength={64} required placeholder="例如：周末练歌房" /></label>
          <label>容纳人数<input type="number" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} min={2} max={50} required /></label>
          <label>房间公告<textarea value={announcement} onChange={(event) => setAnnouncement(event.target.value)} maxLength={500} placeholder="可选，告诉大家今晚唱什么" /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions"><button className="ghost-button" onClick={onCancel} type="button">取消</button><button className="primary-button" disabled={submitting} type="submit">{submitting ? "正在创建…" : "创建并进入"}</button></div>
        </form>
      </section>
    </div>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
