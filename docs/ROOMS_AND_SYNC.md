# 房间与播放同步（0.6.0）

## 房间 REST 接口

所有接口均要求 `Authorization: Bearer <access-token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rooms` | 获取开放及播放中的房间 |
| POST | `/api/rooms` | 创建房间，创建者自动成为房主 |
| GET | `/api/rooms/:roomId` | 获取当前成员、在线状态和播放快照 |
| POST | `/api/rooms/:roomId/join` | 检查封禁、容量和当前所在房间后加入 |
| POST | `/api/rooms/:roomId/leave` | 退出房间；房主退出会关闭房间 |
| PATCH | `/api/rooms/:roomId` | 房主、房间管理员或系统管理员更新房间 |
| DELETE | `/api/rooms/:roomId` | 关闭房间 |
| DELETE | `/api/rooms/:roomId/members/:userId` | 移除成员 |
| GET | `/api/songs?q=` | 查询已发布曲库 |
| POST | `/api/rooms/:roomId/playback/prepare` | 选择歌曲并创建资源准备会话 |
| POST | `/api/rooms/:roomId/playback/control` | 暂停、继续、跳转或结束 |

## 实时连接

Socket.IO 命名空间为 `/rooms`。连接时必须在 `auth.token` 中携带访问令牌。服务端从令牌和数据库读取用户身份，房间事件不接收 `userId`，从协议层避免冒充其他成员。

主要事件：

- `clock:ping`：估算客户端与服务器的时钟偏移。
- `room:join` / `room:leave`：加入或离开实时广播频道。
- `room:details` / `room:presence`：房间持久状态与在线状态；配置 Redis 时由所有 API 实例共享。
- `asset:ready`：客户端完成下载并校验后提交播放会话 ID 和 SHA-256。
- `playback:snapshot`：完整播放状态，用于进入房间和断线恢复。
- `playback:command`：带房间/会话 ID、`sequence` 和 `effectiveAtServerMs` 的播放命令。
- `playback:position`：成员上报本地位置；服务端拒绝旧序列号。

## 全员就绪屏障

1. 房主选择一首已发布且具有音频资产的歌曲。
2. 服务端创建 `PlaybackSession`，同时冻结此刻的房间成员为本次参与者。
3. 每个客户端下载同一资产版本，计算 SHA-256；只有与服务端期望值一致才标记就绪。
4. 最后一名参与者就绪后，服务端把会话变为 `SCHEDULED`，递增序列号，并安排至少 1.5 秒后的统一开始时间。
5. 服务端广播 `START`。客户端根据已测量的服务器时钟偏移在本地换算触发时刻。
6. 暂停、继续、跳转和停止均产生更大的序列号；暂停位置由服务器时间轴计算，客户端不能决定权威位置。
7. 播放期间客户端每秒按服务器时间轴检查漂移：超过 250 ms 直接定位，45–250 ms 采用 0.97–1.03 倍速柔性收敛。
8. 断线重连后客户端从完整快照恢复；若服务器仍等待当前成员，已缓存资源会重新发送幂等 `asset:ready`。

当前资源由 Tauri Rust 下载器写入应用缓存，并通过受限 `asset://` 协议只读给播放器。Redis 模式已经支持跨进程房间广播和带过期清理的在线状态；生产环境仍需完成反向代理下的多实例压力测试、Redis 高可用、设备延迟校准和真实多机验收。
