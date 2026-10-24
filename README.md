# 线上 KTV

Windows 桌面端线上 KTV 项目，采用 npm workspaces 管理用户端、管理端、服务端和共享包。

当前版本：`0.5.0`。用户桌面端已具备全员资源屏障、服务器时间轴、本地音频输出、同步 LRC、漂移校正和房主播放控制；后台桌面端已接入用户、活跃房间、成员、导入任务、播放记录、曲库和审计日志管理。

## 仓库结构

```text
apps/
  client/    用户桌面端（Tauri 2 + React）
  admin/     后台管理桌面端（Tauri 2 + React）
  server/    API 与房间实时服务（NestJS）
packages/
  contracts/ 前后端共享类型和实时事件协议
  ui/        两个桌面端共享的基础组件
```

## 无 Docker 本地启动（推荐）

项目内置 PGlite 开发数据库，可在未安装 Docker/WSL 的 Windows 电脑上运行：

1. 复制 `.env.example` 为 `.env` 并填写 JWT 密钥；QQ SMTP 授权码可以稍后配置，且不要提交 `.env`。
2. 安装依赖并生成 Prisma 客户端：`npm install`、`npm run db:generate`。
3. 在终端 A 启动数据库：`npm run db:dev`。
4. 在终端 B 应用迁移并生成本机开发管理员：`npm run db:deploy:pglite`、`npm run db:seed:pglite`。
5. 在终端 B 启动 API：`npm run dev:server:pglite`。
6. 分别运行 `npm run dev:client` 和 `npm run dev:admin`，打开两个独立桌面软件。

开发管理员的随机密码只写入被 Git 忽略的 `data/dev-admin-credentials.txt`；重新 seed 会轮换密码。可运行 `npm run smoke:resources -w @ktv/server`，生成无版权正弦波并验证登录、上传、数据库记录、完整下载、HTTP Range 和 SHA-256。

已有 Docker Desktop 的环境仍可使用 `npm run infra:up` 启动 PostgreSQL、Redis 和 MinIO，再运行标准 `npm run db:deploy` 与 `npm run dev`。

用户端和管理端只在 Tauri 桌面窗口中运行。开发时内部 Vite 服务仅绑定 `127.0.0.1`，不对局域网提供网页访问；发布安装包会直接内嵌静态资源，不运行前端网页服务器。服务端健康检查为 `http://localhost:3000/api/health`。

异地连接时可运行 `npm run easytier:start -- -Ipv4 10.126.126.1` 为服务端分配虚拟 IP。两个桌面软件的登录页和设置页都可保存服务器地址（例如 `http://10.126.126.1:3000`），无需重新构建安装包。完整节点规划与排错命令见 [docs/EASYTIER.md](./docs/EASYTIER.md)。

构建成功后，Windows 安装程序会出现在根目录 `release/`。用户端与管理端分别生成独立的 `.exe` 安装文件。

首次注册时，如果 `.env` 中尚未填写 `SMTP_AUTH_CODE`，验证码会以 `[development mailbox]` 开头输出到服务端终端。配置 QQ 邮箱 SMTP 授权码后会改为真实发信。用户完成注册和邮箱验证后，可运行 `npm run admin:promote -- <用户名或邮箱>` 授予后台管理员权限。

后台“曲库管理”接受有效的 MP3/WAV 与 UTF-8 LRC。服务端先校验格式与授权确认，再计算哈希、原子写入 `storage/objects`、提交数据库并发布。房主发起播放后，每个用户桌面端通过 Rust 原生层下载音频和歌词到应用缓存；音频哈希匹配播放会话后才自动发送 `asset:ready`。全员就绪后，客户端按服务器安排的未来时间同时开播，并通过轻微变速或定位修正播放漂移。

## 桌面端前置条件

运行桌面端需要 Rust stable-msvc、Microsoft C++ Build Tools 和 WebView2。单独运行用户端使用 `npm run dev:client`，单独运行管理端使用 `npm run dev:admin`；构建安装包使用 `npm run build:desktop:client` 和 `npm run build:desktop:admin`。

## 安全与内容边界

- QQ SMTP 使用授权码，不使用邮箱登录密码；授权码只放服务器 `.env`。
- 客户端不直接连接 PostgreSQL、Redis、MinIO 管理接口，也不持有服务端密钥。
- 歌曲和歌词文件不进入 Git；仅使用具备缓存、处理和传播权限的内容。
- 管理员的封禁、角色变更、资源上下架等危险操作必须在服务端鉴权并写入审计日志。

详细方案见 [线上KTV桌面端项目规划书.md](./线上KTV桌面端项目规划书.md)，代码边界和后续实现顺序见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

房间接口和全员资源就绪屏障见 [docs/ROOMS_AND_SYNC.md](./docs/ROOMS_AND_SYNC.md)，播放器时间轴与校正策略见 [docs/PLAYBACK_ENGINE.md](./docs/PLAYBACK_ENGINE.md)，歌曲资源链路见 [docs/ASSET_PIPELINE.md](./docs/ASSET_PIPELINE.md)。

后台房间监管、任务/播放历史和审计操作说明见 [docs/ADMIN_OPERATIONS.md](./docs/ADMIN_OPERATIONS.md)。
