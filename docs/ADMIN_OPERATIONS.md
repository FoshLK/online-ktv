# 后台监管与审计（0.6.0）

`KTV Admin` 是独立的 Windows Tauri 桌面软件，不提供浏览器管理页。所有管理请求都通过 NestJS 服务端再次鉴权；在界面中隐藏按钮不构成权限控制。

## 已接入页面

- **运行概览：**注册用户、WebSocket 在线用户、活跃房间、待处理导入任务和最近三条导入记录。
- **服务健康：**展示 Redis 连接、在线状态存储与 Socket.IO 广播当前处于分布式模式还是本机回退模式。
- **用户管理：**检索账号、查看邮箱验证与活跃会话、停用/恢复账号；超级管理员可调整角色。
- **房间监管：**查看房主、在线成员、公告、当前歌曲、播放阶段、资源就绪人数和等待人数。
- **曲库管理：**导入拥有处理与分发权限的 MP3/WAV + LRC，发布或下架资源。
- **导入任务：**分页查询任务来源、进度、结果、失败原因、创建人与关联歌曲。
- **播放记录：**按房间、歌曲或歌手查询播放会话、参与人数、就绪人数、版本和结束时间。
- **审计日志：**查询操作者、动作、目标、原因以及操作前后 JSON 快照。

## 房间强制操作

关闭房间或移出成员时，管理端要求填写 3–500 字的原因并再次确认。

- 强制关闭会把房间标记为 `CLOSED`，结束活动播放会话，跳过剩余队列项，并让房内实时连接退出该频道。
- 移出成员会结束其活动成员关系并让该用户退出实时频道；若正在等待全员资源就绪，会从本次屏障移除该成员并重新判断剩余参与者是否已经全部就绪。
- 两类操作分别写入 `ROOM_FORCE_CLOSE` 和 `ROOM_MEMBER_REMOVE` 审计记录。

## 管理 API

以下接口要求 `ADMIN` 或 `SUPER_ADMIN` 访问令牌：

```text
GET  /api/admin/overview
GET  /api/admin/rooms
POST /api/admin/rooms/:roomId/close
POST /api/admin/rooms/:roomId/members/:userId/remove
GET  /api/admin/import-jobs?q=&page=1&pageSize=50
GET  /api/admin/playback-history?q=&page=1&pageSize=50
GET  /api/admin/audit-logs?q=&page=1&pageSize=50
```

强制操作请求体为 `{ "reason": "..." }`。分页接口单页最多 100 条。

## 当前边界

- 审计记录目前依赖 PostgreSQL 权限与备份策略，尚未增加追加式签名或外部归档。
- 任务页面展示现有的授权手动上传任务；外部音乐客户端、转换工具和失败重试工作进程尚未接入。
- 播放记录暂不导出 CSV，也没有按时间范围筛选。
- Redis 单节点接入已经完成；生产横向扩展仍需补充 Sentinel/Cluster、高可用告警和反向代理压力验收。
