import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, createBrowserTokenStore, KtvApiClient, resolveKtvServerEndpoints } from "@ktv/api-client";
import type {
  AdminAuditLogSummary,
  AdminImportJobSummary,
  AdminOverview,
  AdminPlaybackHistoryItem,
  AdminSongSummary,
  AdminUserSummary,
  CurrentUser,
  PlaybackStatus,
  RoomDetails,
  UserRole,
  UserStatus,
} from "@ktv/contracts";
import { DesktopShell, Panel, StatCard, StatusBadge } from "@ktv/ui";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const navigation = [
  { id: "dashboard", label: "概览仪表盘", icon: "⌁" },
  { id: "users", label: "用户管理", icon: "♙" },
  { id: "rooms", label: "房间监管", icon: "◉" },
  { id: "songs", label: "曲库管理", icon: "♫" },
  { id: "imports", label: "导入任务", icon: "⇩" },
  { id: "history", label: "播放记录", icon: "◷" },
  { id: "audit", label: "审计日志", icon: "▤" },
  { id: "settings", label: "系统设置", icon: "⚙" },
];

const serverStorageKey = "ktv-admin:server-origin";

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
  const tokenStore = useMemo(() => createBrowserTokenStore(sessionStorage, "ktv-admin"), []);
  const api = useMemo(
    () => new KtvApiClient(endpoints.apiUrl, tokenStore),
    [endpoints.apiUrl, tokenStore],
  );
  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.me().then((user) => {
      if (user.role === "USER") throw new Error("Not an administrator");
      setAdmin(user);
    }).catch(() => api.clearSession()).finally(() => setLoading(false));
  }, [api]);

  const changeServer = (value: string) => {
    const next = resolveKtvServerEndpoints(value).origin;
    if (next === serverOrigin) return;
    api.clearSession();
    localStorage.setItem(serverStorageKey, next);
    setAdmin(null);
    setServerOrigin(next);
  };

  if (loading) return <div className="admin-login-screen"><span>正在验证管理会话…</span></div>;
  if (!admin) return <AdminLogin api={api} serverOrigin={serverOrigin} onServerChange={changeServer} onAuthenticated={setAdmin} />;
  return <AdminDashboard api={api} admin={admin} serverOrigin={serverOrigin} onServerChange={changeServer} onLogout={async () => { await api.logout(); setAdmin(null); }} />;
}

function AdminLogin({
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
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const session = await api.login({ login, password });
      if (session.user.role === "USER") {
        await api.logout();
        setError("当前账号没有后台管理权限");
        return;
      }
      onAuthenticated(session.user);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法连接管理服务器");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login-screen">
      <section className="admin-login-card">
        <div className="admin-login-logo">K</div>
        <h1>KTV Admin</h1>
        <p>使用已授予管理员角色的账号登录</p>
        <form onSubmit={submit}>
          <label>用户名或邮箱<input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /></label>
          {error && <div className="admin-login-error">{error}</div>}
          <button disabled={submitting} type="submit">{submitting ? "正在验证…" : "进入管理中心"}</button>
        </form>
        <AdminServerAddressEditor serverOrigin={serverOrigin} onSave={onServerChange} compact />
        <small>所有管理操作都会记录到审计日志</small>
      </section>
    </div>
  );
}

function AdminDashboard({
  api,
  admin,
  serverOrigin,
  onServerChange,
  onLogout,
}: {
  api: KtvApiClient;
  admin: CurrentUser;
  serverOrigin: string;
  onServerChange: (value: string) => void;
  onLogout: () => Promise<void>;
}) {
  const [activeId, setActiveId] = useState("dashboard");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = async () => {
    setError("");
    try {
      setOverview(await api.getAdminOverview());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取后台数据");
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(), 15_000);
    return () => window.clearInterval(timer);
  }, [api]);

  const pageTitle = activeId === "dashboard" ? "运行概览" : navigation.find((item) => item.id === activeId)?.label ?? "管理中心";
  const stats = overview?.stats;
  const runtime = overview?.runtime;
  const redisReady = runtime?.redis === "ready";
  const redisStatusLabel = !runtime ? "检测中" : redisReady ? "已连接" : runtime.redis === "unavailable" ? "连接失败" : "未配置";
  const runtimeDescription = runtime?.mode === "distributed"
    ? "在线状态和 Socket.IO 广播已由 Redis 共享，可运行多个 API 实例。"
    : runtime?.redis === "unavailable"
      ? "Redis 当前不可用，服务正在使用本机内存状态；启动时降级的实例需在 Redis 恢复后重启。"
      : "当前使用单进程内存状态；配置 REDIS_URL 后可启用跨实例在线状态与广播。";

  return (
    <DesktopShell
      brand="KTV Admin"
      subtitle="运营管理中心"
      navigation={navigation}
      activeId={activeId}
      onNavigate={setActiveId}
      header={
        <div className="header-row">
          <div>
            <h1 className="header-title">{pageTitle}</h1>
            <p className="header-subtitle">监控真实房间、用户与服务端运行数据</p>
          </div>
          <div className="admin-actions">
            <label className="global-search"><span>⌕</span><input aria-label="全局搜索" placeholder="搜索用户、房间或歌曲" /></label>
            <button className="user-chip admin-user-button" onClick={() => void onLogout()} type="button" title="退出管理端"><span className="avatar">{admin.username.slice(0, 1).toUpperCase()}</span><span>{admin.username}</span></button>
          </div>
        </div>
      }
    >
      {error && <div className="admin-error"><span>{error}</span><button onClick={() => void loadOverview()} type="button">重试</button></div>}
      {activeId === "users" ? (
        <UserManagement api={api} admin={admin} />
      ) : activeId === "rooms" ? (
        <RoomManagement api={api} />
      ) : activeId === "songs" ? (
        <SongManagement api={api} />
      ) : activeId === "imports" ? (
        <ImportJobManagement api={api} onOpenSongs={() => setActiveId("songs")} />
      ) : activeId === "history" ? (
        <PlaybackHistory api={api} />
      ) : activeId === "audit" ? (
        <AuditLogManagement api={api} />
      ) : activeId === "settings" ? (
        <Panel title="服务器连接">
          <div className="admin-server-settings-page">
            <div><strong>管理 API</strong><p>填写服务端所在电脑的 EasyTier 虚拟 IP 与端口。保存后会退出当前管理会话。</p></div>
            <AdminServerAddressEditor serverOrigin={serverOrigin} onSave={onServerChange} />
          </div>
        </Panel>
      ) : <>
      <div className="stats-grid">
        <StatCard label="注册用户" value={stats ? String(stats.registeredUsers) : "—"} detail="数据库实时统计" tone="violet" />
        <StatCard label="在线用户" value={stats ? String(stats.onlineUsers) : "—"} detail="当前 WebSocket 连接" tone="green" />
        <StatCard label="活跃房间" value={stats ? String(stats.activeRooms) : "—"} detail="开放及演唱中的房间" tone="cyan" />
        <StatCard label="待处理任务" value={stats ? String(stats.pendingImportJobs) : "—"} detail="包含失败和待复核任务" tone="orange" />
      </div>

      <div className="admin-grid">
        <Panel title="在线房间" action={<button className="panel-action" disabled={loadingOverview} onClick={() => void loadOverview()} type="button">{loadingOverview ? "读取中…" : "刷新"}</button>} className="rooms-panel">
          <table className="table">
            <thead><tr><th>房间</th><th>房主</th><th>成员</th><th>当前歌曲</th><th>资源就绪</th><th>状态</th></tr></thead>
            <tbody>
              {overview?.activeRooms.map((room) => {
                const ready = room.currentSong ? "同步中" : "—";
                const state = room.status === "PLAYING" ? "演唱中" : "等待中";
                return <tr key={room.id}>
                  <td><strong>{room.name}</strong></td><td>{room.ownerName}</td><td>{room.memberCount} / {room.capacity}</td><td>{room.currentSong?.title ?? "—"}</td><td>{ready}</td>
                  <td><StatusBadge tone={room.status === "PLAYING" ? "success" : "neutral"}>{state}</StatusBadge></td>
                </tr>
              })}
              {!overview?.activeRooms.length && <tr><td className="empty-table" colSpan={6}>当前没有开放房间</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="服务健康" className="health-panel">
          <ul className="health-list">
            <li><span><i className="health-dot ok" />API 服务</span><StatusBadge tone="success">已连接</StatusBadge></li>
            <li><span><i className="health-dot ok" />PostgreSQL</span><StatusBadge tone="success">查询正常</StatusBadge></li>
            <li><span><i className={`health-dot ${redisReady ? "ok" : "warn"}`} />Redis 在线状态</span><StatusBadge tone={redisReady ? "success" : "warning"}>{redisStatusLabel}</StatusBadge></li>
            <li><span><i className={`health-dot ${runtime?.socketAdapter === "redis" ? "ok" : "warn"}`} />实时广播</span><StatusBadge tone={runtime?.socketAdapter === "redis" ? "success" : "warning"}>{runtime?.socketAdapter === "redis" ? "跨实例" : "仅本机"}</StatusBadge></li>
            <li><span><i className="health-dot ok" />本地对象存储</span><StatusBadge tone="success">已接入</StatusBadge></li>
          </ul>
          <p className="muted storage-copy">{runtimeDescription}</p>
        </Panel>

        <Panel title="最近导入任务" action={<button className="primary-button" onClick={() => setActiveId("songs")} type="button">＋ 导入授权歌曲</button>}>
          <div className="job-list">
            {overview?.recentImportJobs.map((job) => <div key={job.id}>
              <span className={`job-icon ${importJobTone(job.status)}`}>{job.status === "COMPLETED" ? "✓" : job.status === "FAILED" ? "!" : "↻"}</span>
              <p><strong>{job.song ? `${job.song.title} · ${job.song.artist}` : job.sourceLabel ?? "歌曲导入任务"}</strong><small>{formatDateTime(job.createdAt)} · {job.creator.username}</small></p>
              <StatusBadge tone={importJobTone(job.status)}>{importJobLabel(job.status)}</StatusBadge>
            </div>)}
            {!overview?.recentImportJobs.length && <div className="job-list-empty">还没有歌曲导入记录</div>}
          </div>
        </Panel>

        <Panel title="待办与告警">
          <div className="alerts">
            <button type="button" onClick={() => setActiveId("rooms")}><span>检查活跃房间与资源就绪状态</span><small>房间监管 →</small></button>
            <button type="button" onClick={() => setActiveId("songs")}><span>导入第一首授权测试歌曲</span><small>曲库管理 →</small></button>
            <button type="button" onClick={() => setActiveId("audit")}><span>复核近期后台操作</span><small>审计日志 →</small></button>
          </div>
        </Panel>
      </div>
      </>}
    </DesktopShell>
  );
}

function AdminServerAddressEditor({
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
    <div className={`admin-server-address${compact ? " compact" : ""}`}>
      {compact && <span>服务器连接</span>}
      <div><input aria-label="服务器地址" value={value} onChange={(event) => { setValue(event.target.value); setSaved(false); }} placeholder="http://10.126.126.1:3000" /><button type="button" onClick={save}>保存</button></div>
      <small>{error || (saved ? "服务器地址已保存" : `当前：${serverOrigin}`)}</small>
    </div>
  );
}

function RoomManagement({ api }: { api: KtvApiClient }) {
  const [rooms, setRooms] = useState<RoomDetails[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const result = await api.listAdminRooms();
      setRooms(result.items);
      setSelectedRoomId((current) => current && result.items.some((room) => room.id === current)
        ? current
        : result.items[0]?.id ?? null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取活跃房间");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 8_000);
    return () => window.clearInterval(timer);
  }, [api]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const closeRoom = async (room: RoomDetails) => {
    const reason = moderationReason(`关闭房间“${room.name}”`);
    if (!reason || !window.confirm(`确认强制关闭“${room.name}”吗？房内播放将立即结束。`)) return;
    setWorkingKey(`room:${room.id}`);
    setError("");
    setNotice("");
    try {
      await api.closeAdminRoom(room.id, { reason });
      setRooms((items) => items.filter((item) => item.id !== room.id));
      setSelectedRoomId((current) => current === room.id ? null : current);
      setNotice(`已关闭房间“${room.name}”，操作已写入审计日志`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "关闭房间失败");
    } finally {
      setWorkingKey(null);
    }
  };

  const removeMember = async (room: RoomDetails, userId: string, username: string) => {
    const reason = moderationReason(`将“${username}”移出“${room.name}”`);
    if (!reason || !window.confirm(`确认将“${username}”移出房间吗？`)) return;
    setWorkingKey(`member:${userId}`);
    setError("");
    setNotice("");
    try {
      const updated = await api.removeAdminRoomMember(room.id, userId, { reason });
      setRooms((items) => items.map((item) => item.id === updated.id ? updated : item));
      setNotice(`已将“${username}”移出房间，播放准备状态已重新核对`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "移出成员失败");
    } finally {
      setWorkingKey(null);
    }
  };

  const playback = selectedRoom?.currentPlayback;
  const readiness = playback ? `${playback.readyUserIds.length} / ${playback.readyUserIds.length + playback.waitingUserIds.length}` : "—";

  return (
    <div className="room-admin-layout">
      <Panel
        title={`活跃房间 · ${rooms.length}`}
        className="room-list-panel"
        action={<button className="panel-action" disabled={loading} onClick={() => void load()} type="button">{loading ? "读取中…" : "刷新"}</button>}
      >
        {error && <div className="admin-error"><span>{error}</span><button onClick={() => void load()} type="button">重试</button></div>}
        {notice && <div className="song-import-notice room-notice">{notice}</div>}
        <table className="table room-monitor-table">
          <thead><tr><th>房间</th><th>成员</th><th>歌曲</th><th>状态</th></tr></thead>
          <tbody>
            {rooms.map((room) => <tr className={room.id === selectedRoomId ? "is-selected" : ""} key={room.id}>
              <td><button className="room-select-button" onClick={() => setSelectedRoomId(room.id)} type="button"><strong>{room.name}</strong><small>{room.ownerName}</small></button></td>
              <td>{room.memberCount} / {room.capacity}</td>
              <td>{room.currentSong?.title ?? "—"}</td>
              <td><StatusBadge tone={room.status === "PLAYING" ? "success" : "neutral"}>{room.status === "PLAYING" ? "演唱中" : "等待中"}</StatusBadge></td>
            </tr>)}
            {!rooms.length && !loading && <tr><td className="empty-table" colSpan={4}>当前没有开放房间</td></tr>}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={selectedRoom ? selectedRoom.name : "房间详情"}
        className="room-detail-panel"
        action={selectedRoom ? <button className="danger-action" disabled={workingKey === `room:${selectedRoom.id}`} onClick={() => void closeRoom(selectedRoom)} type="button">{workingKey === `room:${selectedRoom.id}` ? "关闭中…" : "强制关闭房间"}</button> : undefined}
      >
        {selectedRoom ? <>
          <div className="room-facts">
            <div><span>房主</span><strong>{selectedRoom.ownerName}</strong></div>
            <div><span>在线成员</span><strong>{selectedRoom.members.filter((member) => member.online).length} / {selectedRoom.memberCount}</strong></div>
            <div><span>资源就绪</span><strong>{readiness}</strong></div>
            <div><span>播放阶段</span><StatusBadge tone={playbackTone(playback?.state)}>{playback ? playbackStateLabel(playback.state) : "空闲"}</StatusBadge></div>
          </div>
          <div className="room-announcement"><span>房间公告</span><p>{selectedRoom.announcement || "未设置公告"}</p></div>
          {playback && <div className="playback-monitor">
            <div><span>当前歌曲</span><strong>{playback.song.title} · {playback.song.artist}</strong></div>
            <div className="readiness-bar"><span style={{ width: `${Math.round(playback.readyUserIds.length / Math.max(1, playback.readyUserIds.length + playback.waitingUserIds.length) * 100)}%` }} /></div>
            <small>会话 {playback.sessionId.slice(0, 8)} · 序列 {playback.sequence} · 资源 v{playback.assetVersion}</small>
          </div>}
          <div className="room-members-heading"><strong>房内成员</strong><span>{selectedRoom.members.length} 人</span></div>
          <div className="room-member-list">
            {selectedRoom.members.map((member) => <div key={member.userId}>
              <span className={`member-presence ${member.online ? "online" : ""}`} />
              <p><strong>{member.username}</strong><small>{member.role === "OWNER" ? "房主" : member.role === "MODERATOR" ? "房间管理员" : "成员"}{member.muted ? " · 已静音" : ""}</small></p>
              {member.userId === selectedRoom.ownerId ? <span className="owner-label">不可移出</span> : <button className="danger-action" disabled={workingKey === `member:${member.userId}`} onClick={() => void removeMember(selectedRoom, member.userId, member.username)} type="button">{workingKey === `member:${member.userId}` ? "处理中…" : "移出"}</button>}
            </div>)}
          </div>
        </> : <div className="admin-empty compact"><span>◉</span><strong>选择一个活跃房间</strong><p>可查看成员、资源就绪情况和播放状态</p></div>}
      </Panel>
    </div>
  );
}

function ImportJobManagement({ api, onOpenSongs }: { api: KtvApiClient; onOpenSongs: () => void }) {
  const [jobs, setJobs] = useState<AdminImportJobSummary[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = async (search = query, nextPage = page) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listAdminImportJobs(search, nextPage, pageSize);
      setJobs(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取导入任务");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load("", 1); }, [api]);

  return <Panel
    title={`导入任务 · ${total}`}
    className="data-panel"
    action={<div className="admin-list-actions"><SearchForm value={query} loading={loading} placeholder="歌曲、歌手或创建人" onChange={setQuery} onSubmit={() => void load(query, 1)} /><button className="primary-button" onClick={onOpenSongs} type="button">＋ 导入授权歌曲</button></div>}
  >
    {error && <div className="admin-error"><span>{error}</span><button onClick={() => void load()} type="button">重试</button></div>}
    <table className="table data-table import-job-table">
      <thead><tr><th>任务 / 歌曲</th><th>来源</th><th>创建人</th><th>进度</th><th>状态</th><th>创建时间</th><th>结果</th></tr></thead>
      <tbody>
        {jobs.map((job) => <tr key={job.id}>
          <td><strong>{job.song?.title ?? job.sourceLabel ?? "未命名任务"}</strong><small className="song-artist">{job.song?.artist ?? job.id.slice(0, 8)}</small></td>
          <td>{job.sourceType === "ADMIN_UPLOAD" ? "管理端上传" : job.sourceType}</td>
          <td>{job.creator.username}</td>
          <td><div className="job-progress"><span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div><small>{job.progress}%</small></td>
          <td><StatusBadge tone={importJobTone(job.status)}>{importJobLabel(job.status)}</StatusBadge></td>
          <td>{formatDateTime(job.createdAt)}</td>
          <td className={job.errorDetail ? "job-error-detail" : "muted"} title={job.errorDetail}>{job.errorDetail ? job.errorDetail.slice(0, 42) : job.finishedAt ? formatDateTime(job.finishedAt) : "—"}</td>
        </tr>)}
        {!jobs.length && !loading && <tr><td className="empty-table" colSpan={7}>没有找到导入任务</td></tr>}
      </tbody>
    </table>
    <ListFooter page={page} pageSize={pageSize} total={total} loading={loading} onPage={(nextPage) => void load(query, nextPage)} />
  </Panel>;
}

function PlaybackHistory({ api }: { api: KtvApiClient }) {
  const [items, setItems] = useState<AdminPlaybackHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = async (search = query, nextPage = page) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listAdminPlaybackHistory(search, nextPage, pageSize);
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取播放记录");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load("", 1); }, [api]);

  return <Panel
    title={`播放记录 · ${total}`}
    className="data-panel"
    action={<SearchForm value={query} loading={loading} placeholder="房间、歌曲或歌手" onChange={setQuery} onSubmit={() => void load(query, 1)} />}
  >
    {error && <div className="admin-error"><span>{error}</span><button onClick={() => void load()} type="button">重试</button></div>}
    <table className="table data-table playback-history-table">
      <thead><tr><th>歌曲</th><th>房间</th><th>参与者</th><th>资源就绪</th><th>版本</th><th>状态</th><th>创建时间</th><th>结束时间</th></tr></thead>
      <tbody>
        {items.map((item) => <tr key={item.id}>
          <td><strong>{item.song.title}</strong><small className="song-artist">{item.song.artist} · {formatAdminDuration(item.song.durationMs)}</small></td>
          <td>{item.roomName}</td>
          <td>{item.participantCount}</td>
          <td>{item.readyCount} / {item.participantCount}</td>
          <td>v{item.assetVersion}</td>
          <td><StatusBadge tone={playbackTone(item.state)}>{playbackStateLabel(item.state)}</StatusBadge></td>
          <td>{formatDateTime(item.createdAt)}</td>
          <td>{item.endedAt ? formatDateTime(item.endedAt) : "—"}</td>
        </tr>)}
        {!items.length && !loading && <tr><td className="empty-table" colSpan={8}>还没有播放记录</td></tr>}
      </tbody>
    </table>
    <ListFooter page={page} pageSize={pageSize} total={total} loading={loading} onPage={(nextPage) => void load(query, nextPage)} />
  </Panel>;
}

function AuditLogManagement({ api }: { api: KtvApiClient }) {
  const [logs, setLogs] = useState<AdminAuditLogSummary[]>([]);
  const [selected, setSelected] = useState<AdminAuditLogSummary | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = async (search = query, nextPage = page) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listAdminAuditLogs(search, nextPage, pageSize);
      setLogs(result.items);
      setTotal(result.total);
      setPage(result.page);
      setSelected((current) => current && result.items.some((log) => log.id === current.id) ? current : null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取审计日志");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load("", 1); }, [api]);

  return <div className="audit-layout">
    <Panel
      title={`审计日志 · ${total}`}
      className="data-panel audit-list-panel"
      action={<SearchForm value={query} loading={loading} placeholder="操作、目标、原因或管理员" onChange={setQuery} onSubmit={() => void load(query, 1)} />}
    >
      {error && <div className="admin-error"><span>{error}</span><button onClick={() => void load()} type="button">重试</button></div>}
      <table className="table data-table audit-table">
        <thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>目标</th><th>原因</th><th>详情</th></tr></thead>
        <tbody>
          {logs.map((log) => <tr className={selected?.id === log.id ? "is-selected" : ""} key={log.id}>
            <td>{formatDateTime(log.createdAt)}</td><td>{log.actor?.username ?? "系统"}</td><td><StatusBadge tone={auditTone(log.action)}>{auditActionLabel(log.action)}</StatusBadge></td>
            <td>{log.targetType}{log.targetId ? ` · ${log.targetId.slice(0, 8)}` : ""}</td><td className="audit-reason" title={log.reason}>{log.reason ?? "—"}</td>
            <td><button className="panel-action" onClick={() => setSelected(log)} type="button">查看</button></td>
          </tr>)}
          {!logs.length && !loading && <tr><td className="empty-table" colSpan={6}>没有找到审计记录</td></tr>}
        </tbody>
      </table>
      <ListFooter page={page} pageSize={pageSize} total={total} loading={loading} onPage={(nextPage) => void load(query, nextPage)} />
    </Panel>
    {selected && <Panel title="操作快照" action={<button className="panel-action" onClick={() => setSelected(null)} type="button">关闭</button>} className="audit-detail-panel">
      <dl><div><dt>操作</dt><dd>{auditActionLabel(selected.action)}</dd></div><div><dt>管理员</dt><dd>{selected.actor?.username ?? "系统"}</dd></div><div><dt>原因</dt><dd>{selected.reason ?? "未填写"}</dd></div><div><dt>时间</dt><dd>{formatDateTime(selected.createdAt)}</dd></div></dl>
      <div className="audit-state-grid"><section><strong>操作前</strong><pre>{formatAuditState(selected.beforeState)}</pre></section><section><strong>操作后</strong><pre>{formatAuditState(selected.afterState)}</pre></section></div>
    </Panel>}
  </div>;
}

function SearchForm({
  value,
  loading,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  loading: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return <form className="admin-user-search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><input value={value} onChange={(event) => onChange(event.target.value)} maxLength={100} placeholder={placeholder} /><button className="panel-action" disabled={loading} type="submit">{loading ? "查询中…" : "查询"}</button></form>;
}

function ListFooter({
  page,
  pageSize,
  total,
  loading,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="list-footer"><span>第 {page} / {pageCount} 页，共 {total} 条</span><div><button disabled={loading || page <= 1} onClick={() => onPage(page - 1)} type="button">上一页</button><button disabled={loading || page >= pageCount} onClick={() => onPage(page + 1)} type="button">下一页</button></div></div>;
}

function moderationReason(action: string): string | null {
  const reason = window.prompt(`${action}\n请输入操作原因（3–500 个字符），该原因会进入审计日志：`, "后台监管操作");
  if (reason === null) return null;
  const normalized = reason.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    window.alert("操作原因长度必须为 3–500 个字符");
    return null;
  }
  return normalized;
}

function SongManagement({ api }: { api: KtvApiClient }) {
  const [songs, setSongs] = useState<AdminSongSummary[]>([]);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(180);
  const [copyrightNote, setCopyrightNote] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [audio, setAudio] = useState<File | null>(null);
  const [lyric, setLyric] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [workingSongId, setWorkingSongId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async (search = query) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listAdminSongs(search);
      setSongs(result.items);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取曲库");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
  }, [api]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    setNotice("");
    setError("");
    if (!audio || !lyric) {
      setError("请选择音频文件和 LRC 歌词文件");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.importSong({
        title,
        artist,
        album: album || undefined,
        durationMs: Math.round(durationSeconds * 1_000),
        copyrightNote,
        rightsConfirmed: true,
      }, audio, lyric);
      setSongs((items) => [result.song, ...items]);
      setTitle("");
      setArtist("");
      setAlbum("");
      setCopyrightNote("");
      setRightsConfirmed(false);
      setAudio(null);
      setLyric(null);
      setNotice(`“${result.song.title}”已校验并发布到曲库`);
      form.reset();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "歌曲导入失败");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (song: AdminSongSummary) => {
    const nextStatus = song.status === "PUBLISHED" ? "DISABLED" : "PUBLISHED";
    const action = nextStatus === "DISABLED" ? "下架" : "重新发布";
    if (!window.confirm(`确认${action}“${song.title}”吗？`)) return;
    setWorkingSongId(song.id);
    setError("");
    try {
      const updated = await api.updateAdminSongStatus(song.id, nextStatus, `管理端${action}歌曲`);
      setSongs((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : `${action}失败`);
    } finally {
      setWorkingSongId(null);
    }
  };

  return (
    <div className="song-admin-layout">
      <Panel title="导入授权歌曲" className="song-import-panel">
        <form className="song-import-form" onSubmit={submit}>
          <div className="song-form-grid">
            <label>歌名<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /></label>
            <label>歌手<input value={artist} onChange={(event) => setArtist(event.target.value)} maxLength={200} required /></label>
            <label>专辑（可选）<input value={album} onChange={(event) => setAlbum(event.target.value)} maxLength={200} /></label>
            <label>时长（秒）<input type="number" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} min={1} max={7200} required /></label>
            <label>MP3 / WAV 音频<input type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" onChange={(event) => setAudio(event.target.files?.[0] ?? null)} required /></label>
            <label>LRC 歌词<input type="file" accept=".lrc,text/plain" onChange={(event) => setLyric(event.target.files?.[0] ?? null)} required /></label>
          </div>
          <label>授权或来源说明<textarea value={copyrightNote} onChange={(event) => setCopyrightNote(event.target.value)} minLength={3} maxLength={1000} required placeholder="例如：自制测试音频，仅用于开发联调" /></label>
          <label className="rights-confirm"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required /><span>我确认拥有该音频与歌词的处理、缓存及使用权限</span></label>
          {error && <div className="admin-login-error">{error}</div>}
          {notice && <div className="song-import-notice">{notice}</div>}
          <button className="primary-button" disabled={submitting || !rightsConfirmed} type="submit">{submitting ? "正在计算校验值并上传…" : "导入并发布"}</button>
        </form>
      </Panel>

      <Panel
        title={`服务器曲库 · ${songs.length}`}
        className="song-catalog-panel"
        action={<form className="admin-user-search" onSubmit={(event) => { event.preventDefault(); void load(query); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌名或歌手" /><button className="panel-action" disabled={loading} type="submit">{loading ? "查询中…" : "查询"}</button></form>}
      >
        <table className="table admin-song-table">
          <thead><tr><th>歌曲</th><th>时长</th><th>版本</th><th>音频</th><th>歌词</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {songs.map((song) => <tr key={song.id}>
              <td><strong>{song.title}</strong><small className="song-artist">{song.artist}{song.album ? ` · ${song.album}` : ""}</small></td>
              <td>{formatAdminDuration(song.durationMs)}</td>
              <td>v{song.assetVersion}</td>
              <td>{song.audio ? formatBytes(song.audio.sizeBytes) : "缺失"}</td>
              <td>{song.lyric ? "LRC" : "缺失"}</td>
              <td><StatusBadge tone={song.status === "PUBLISHED" ? "success" : song.status === "DISABLED" ? "danger" : "warning"}>{song.status === "PUBLISHED" ? "已发布" : song.status === "DISABLED" ? "已下架" : "处理中"}</StatusBadge></td>
              <td><button className={song.status === "PUBLISHED" ? "danger-action" : "restore-action"} disabled={workingSongId === song.id || !["PUBLISHED", "DISABLED"].includes(song.status)} onClick={() => void toggleStatus(song)} type="button">{workingSongId === song.id ? "处理中…" : song.status === "PUBLISHED" ? "下架" : "发布"}</button></td>
            </tr>)}
            {!songs.length && !loading && <tr><td className="empty-table" colSpan={7}>曲库中还没有歌曲，可从左侧导入授权测试资源</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function formatAdminDuration(durationMs: number): string {
  const total = Math.floor(durationMs / 1_000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function UserManagement({ api, admin }: { api: KtvApiClient; admin: CurrentUser }) {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = async (search = query) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.listAdminUsers(search);
      setUsers(result.items);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "无法读取用户列表");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
  }, [api]);

  const updateUser = async (user: AdminUserSummary, change: { status?: UserStatus; role?: UserRole }, description: string) => {
    if (!window.confirm(`确认${description}“${user.username}”吗？该操作会写入审计日志。`)) return;
    setWorkingUserId(user.id);
    setError("");
    try {
      const updated = await api.updateAdminUser(user.id, {
        ...change,
        reason: `管理端操作：${description}`,
      });
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "更新用户失败");
    } finally {
      setWorkingUserId(null);
    }
  };

  return (
    <Panel
      title="账号与权限"
      action={
        <form className="admin-user-search" onSubmit={(event) => { event.preventDefault(); void load(query); }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="用户名或邮箱" />
          <button className="panel-action" disabled={loading} type="submit">{loading ? "查询中…" : "查询"}</button>
        </form>
      }
      className="users-panel"
    >
      {error && <div className="admin-error"><span>{error}</span><button onClick={() => void load()} type="button">重试</button></div>}
      <table className="table users-table">
        <thead><tr><th>用户</th><th>邮箱认证</th><th>角色</th><th>状态</th><th>活跃会话</th><th>注册时间</th><th>操作</th></tr></thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === admin.id;
            const canManage = !isSelf && (admin.role === "SUPER_ADMIN" || user.role === "USER");
            return <tr key={user.id}>
              <td><div className="admin-user-cell"><span>{user.username.slice(0, 1).toUpperCase()}</span><p><strong>{user.username}</strong><small>{user.email}</small></p></div></td>
              <td><StatusBadge tone={user.emailVerified ? "success" : "warning"}>{user.emailVerified ? "已认证" : "未认证"}</StatusBadge></td>
              <td>
                {admin.role === "SUPER_ADMIN" && !isSelf ? (
                  <select
                    aria-label={`修改 ${user.username} 的角色`}
                    disabled={workingUserId === user.id}
                    onChange={(event) => void updateUser(user, { role: event.target.value as UserRole }, `将角色修改为 ${event.target.value}`)}
                    value={user.role}
                  >
                    <option value="USER">普通用户</option><option value="ADMIN">管理员</option><option value="SUPER_ADMIN">超级管理员</option>
                  </select>
                ) : user.role}
              </td>
              <td><StatusBadge tone={user.status === "ACTIVE" ? "success" : user.status === "SUSPENDED" ? "warning" : "danger"}>{statusLabel(user.status)}</StatusBadge></td>
              <td>{user.activeSessionCount}</td>
              <td>{new Date(user.createdAt).toLocaleDateString("zh-CN")}</td>
              <td>
                {canManage ? (
                  <button
                    className={user.status === "ACTIVE" ? "danger-action" : "restore-action"}
                    disabled={workingUserId === user.id}
                    onClick={() => void updateUser(
                      user,
                      { status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" },
                      user.status === "ACTIVE" ? "停用账号" : "恢复账号",
                    )}
                    type="button"
                  >{workingUserId === user.id ? "处理中…" : user.status === "ACTIVE" ? "停用" : "恢复"}</button>
                ) : <span className="muted">{isSelf ? "当前账号" : "权限不足"}</span>}
              </td>
            </tr>;
          })}
          {!users.length && !loading && <tr><td className="empty-table" colSpan={7}>没有找到用户</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function statusLabel(status: UserStatus): string {
  if (status === "ACTIVE") return "正常";
  if (status === "SUSPENDED") return "已停用";
  return "已禁用";
}

function importJobLabel(status: AdminImportJobSummary["status"]): string {
  if (status === "QUEUED") return "排队中";
  if (status === "RUNNING") return "处理中";
  if (status === "REVIEW_REQUIRED") return "待复核";
  if (status === "FAILED") return "失败";
  return "已完成";
}

function importJobTone(status: AdminImportJobSummary["status"]): StatusTone {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "info";
  return "warning";
}

function playbackStateLabel(status: PlaybackStatus): string {
  if (status === "PREPARING") return "等待资源";
  if (status === "SCHEDULED") return "已排定";
  if (status === "PLAYING") return "播放中";
  if (status === "PAUSED") return "已暂停";
  if (status === "ENDED") return "已结束";
  return "失败";
}

function playbackTone(status?: PlaybackStatus): StatusTone {
  if (!status || status === "ENDED") return "neutral";
  if (status === "PLAYING" || status === "SCHEDULED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "PAUSED") return "warning";
  return "info";
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    USER_UPDATE: "用户更新",
    SONG_IMPORT: "歌曲导入",
    SONG_STATUS_UPDATE: "歌曲状态",
    ROOM_FORCE_CLOSE: "强制关闭房间",
    ROOM_MEMBER_REMOVE: "移出房间成员",
  };
  return labels[action] ?? action;
}

function auditTone(action: string): StatusTone {
  if (action === "ROOM_FORCE_CLOSE" || action === "ROOM_MEMBER_REMOVE") return "danger";
  if (action === "SONG_IMPORT") return "success";
  if (action === "USER_UPDATE" || action === "SONG_STATUS_UPDATE") return "warning";
  return "neutral";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAuditState(value: unknown): string {
  if (value === undefined || value === null) return "无快照";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
