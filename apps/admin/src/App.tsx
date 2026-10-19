import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, createBrowserTokenStore, KtvApiClient, resolveKtvServerEndpoints } from "@ktv/api-client";
import type { AdminOverview, AdminSongSummary, AdminUserSummary, CurrentUser, UserRole, UserStatus } from "@ktv/contracts";
import { DesktopShell, Panel, StatCard, StatusBadge } from "@ktv/ui";

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
      ) : activeId === "songs" ? (
        <SongManagement api={api} />
      ) : activeId === "settings" ? (
        <Panel title="服务器连接">
          <div className="admin-server-settings-page">
            <div><strong>管理 API</strong><p>填写服务端所在电脑的 EasyTier 虚拟 IP 与端口。保存后会退出当前管理会话。</p></div>
            <AdminServerAddressEditor serverOrigin={serverOrigin} onSave={onServerChange} />
          </div>
        </Panel>
      ) : activeId !== "dashboard" && activeId !== "rooms" ? (
        <Panel title={pageTitle}>
          <div className="admin-empty"><span>⌁</span><strong>模块接口将在后续阶段接入</strong><p>当前已完成账号认证、房间管理和实时状态基础。</p></div>
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
            <li><span><i className="health-dot warn" />Redis 在线状态</span><StatusBadge tone="warning">待接入</StatusBadge></li>
            <li><span><i className="health-dot ok" />本地对象存储</span><StatusBadge tone="success">已接入</StatusBadge></li>
          </ul>
          <p className="muted storage-copy">当前在线状态保存在单个服务进程内，接入 Redis 后支持多实例。</p>
        </Panel>

        <Panel title="最近导入任务" action={<button className="primary-button" type="button">＋ 新建导入任务</button>}>
          <div className="job-list">
            <div><span className="job-icon warning">↻</span><p><strong>歌曲导入工作进程</strong><small>将在对象存储阶段接入受控工具链</small></p><StatusBadge tone="warning">待接入</StatusBadge></div>
          </div>
        </Panel>

        <Panel title="待办与告警">
          <div className="alerts">
            <button type="button"><span>配置 PostgreSQL 运行环境</span><small>基础设施 →</small></button>
            <button type="button" onClick={() => setActiveId("songs")}><span>导入第一首授权测试歌曲</span><small>曲库管理 →</small></button>
            <button type="button"><span>接入 Redis 在线状态</span><small>扩展阶段 →</small></button>
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
