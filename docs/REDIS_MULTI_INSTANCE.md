# Redis 多实例在线状态与实时广播（0.6.0）

## 运行模式

服务端启动时读取 `REDIS_URL`：

- 地址可连接：在线用户与房间成员状态写入 Redis，Socket.IO 使用 Redis Adapter 跨 API 进程广播。
- 留空或设为 `memory://`：使用单进程内存状态，适合 PGlite 本机开发。
- 已配置但连接失败：默认记录告警并回退到单进程模式，`GET /api/health` 返回 `degraded`。
- `REDIS_REQUIRED=true`：Redis 或跨进程广播初始化失败时拒绝启动，适合不能接受静默降级的生产环境。

相关配置：

```dotenv
REDIS_URL=redis://localhost:6379
REDIS_REQUIRED=false
REDIS_KEY_PREFIX=online-ktv
REDIS_CONNECT_TIMEOUT_MS=1500
PRESENCE_TTL_SECONDS=60
```

Redis 地址可能包含密码，必须只保存在服务端 `.env`，不要写入桌面端或提交 Git。生产环境应限制 Redis 只允许服务器网段访问，并配置 ACL、TLS 或受保护的内网隧道。

## 在线状态模型

每个已认证的 Socket.IO 连接具有一个随机进程实例前缀和 socket ID。Redis 保存：

- 有 TTL 的 socket → 用户 ID 记录；
- 全局在线连接的有序集合；
- 每个房间在线连接的有序集合。

有序集合分数是按 Redis 服务器时钟计算的连接过期时间，避免多个 API 主机时钟偏差造成误清理。服务端按 TTL 的三分之一发送心跳；正常退出会立即删除记录，进程崩溃后记录会在读取时按过期分数清理。一个用户打开多个连接时，后台在线人数仍按用户 ID 去重。

管理员跨实例移出成员或关闭房间时，Socket.IO Redis Adapter 会让远端 socket 离开频道，同时通过 server-side 事件清理持有该连接的 API 实例本地状态，防止下一次心跳重新加入。

## 健康状态

`GET /api/health` 和后台桌面端概览会返回相同的运行信息：

```json
{
  "mode": "distributed",
  "redis": "ready",
  "presenceStore": "redis",
  "socketAdapter": "redis"
}
```

`mode=distributed` 只在 Redis 在线状态和跨进程广播都成功启用时出现。已完成 Redis 初始化的实例会在运行中断线后自动重连，并由心跳重建本机 socket 状态；如果实例在启动阶段就因 Redis 不可用而降级，则不会热切换，请在 Redis 恢复后重启该 API 实例。

## 本地与生产部署

本地 Docker 环境可运行：

```powershell
npm run infra:up
npm run db:deploy
npm run dev
```

生产多实例必须共享 PostgreSQL、Redis 和歌曲对象存储，并由支持 WebSocket 的反向代理提供一个稳定入口。Redis 单节点故障仍会令跨实例功能降级；正式上线前还需完成 Sentinel/Cluster 方案、告警、备份以及至少两台 API 实例的断线和进程崩溃演练。
