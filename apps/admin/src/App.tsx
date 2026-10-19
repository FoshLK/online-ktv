import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, createBrowserTokenStore, KtvApiClient } from "@ktv/api-client";
import type { AdminOverview, AdminUserSummary, CurrentUser, UserRole, UserStatus } from "@ktv/contracts";
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

export function App() {
  const api = useMemo(
    () => new KtvApiClient(import.meta.env.VITE_API_URL ?? "http://localhost:3000/api", createBrowserTokenStore(sessionStorage, "ktv-admin")),
    [],
  );
  const [admin, setAdmin] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then((user) => {
      if (user.role === "USER") throw new Error("Not an administrator");
      setAdmin(user);
    }).catch(() => api.clearSession()).finally(() => setLoading(false));
  }, [api]);

  if (loading) return <div className="admin-login-screen"><span>正在验证管理会话…</span></div>;
  if (!admin) return <AdminLogin api={api} onAuthenticated={setAdmin} />;
  return <AdminDashboard api={api} admin={admin} onLogout={async () => { await api.logout(); setAdmin(null); }} />;
}

function AdminLogin({ api, onAuthenticated }: { api: KtvApiClient; onAuthenticated: (user: CurrentUser) => void }) {
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
        <small>所有管理操作都会记录到审计日志</small>
      </section>
    </div>
  );
}

function AdminDashboard({ api, admin, onLogout }: { api: KtvApiClient; admin: CurrentUser; onLogout: () => Promise<void> }) {
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
            <li><span><i className="health-dot warn" />MinIO 资源存储</span><StatusBadge tone="warning">待接入</StatusBadge></li>
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
            <button type="button"><span>接入 MinIO 测试资源</span><small>资源阶段 →</small></button>
            <button type="button"><span>接入 Redis 在线状态</span><small>扩展阶段 →</small></button>
          </div>
        </Panel>
      </div>
      </>}
    </DesktopShell>
  );
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
