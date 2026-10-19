# 线上 KTV

Windows 桌面端线上 KTV 项目，采用 npm workspaces 管理用户端、管理端、服务端和共享包。

当前版本：`0.2.0`。用户桌面端已接入真实房间大厅、创建/加入/退出、房内实时在线状态和曲库入口；后台桌面端已接入实时概览及带审计的用户状态管理。

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

## 本地启动

1. 复制 `.env.example` 为 `.env`，开发环境可先保留默认数据库配置；不要提交 `.env`。
2. 启动基础设施：`npm run infra:up`。
3. 安装依赖：`npm install`。
4. 生成数据库客户端：`npm run db:generate`。
5. 创建首个迁移：`npm run db:migrate -- --name init`。
6. 同时启动 API、用户桌面端和管理桌面端：`npm run dev`。

用户端和管理端只在 Tauri 桌面窗口中运行。开发时内部 Vite 服务仅绑定 `127.0.0.1`，不对局域网提供网页访问；发布安装包会直接内嵌静态资源，不运行前端网页服务器。服务端健康检查为 `http://localhost:3000/api/health`。

构建成功后，Windows 安装程序会出现在根目录 `release/`。用户端与管理端分别生成独立的 `.exe` 安装文件。

首次注册时，如果 `.env` 中尚未填写 `SMTP_AUTH_CODE`，验证码会以 `[development mailbox]` 开头输出到服务端终端。配置 QQ 邮箱 SMTP 授权码后会改为真实发信。用户完成注册和邮箱验证后，可运行 `npm run admin:promote -- <用户名或邮箱>` 授予后台管理员权限。

## 桌面端前置条件

运行桌面端需要 Rust stable-msvc、Microsoft C++ Build Tools 和 WebView2。单独运行用户端使用 `npm run dev:client`，单独运行管理端使用 `npm run dev:admin`；构建安装包使用 `npm run build:desktop:client` 和 `npm run build:desktop:admin`。

## 安全与内容边界

- QQ SMTP 使用授权码，不使用邮箱登录密码；授权码只放服务器 `.env`。
- 客户端不直接连接 PostgreSQL、Redis、MinIO 管理接口，也不持有服务端密钥。
- 歌曲和歌词文件不进入 Git；仅使用具备缓存、处理和传播权限的内容。
- 管理员的封禁、角色变更、资源上下架等危险操作必须在服务端鉴权并写入审计日志。

详细方案见 [线上KTV桌面端项目规划书.md](./线上KTV桌面端项目规划书.md)，代码边界和后续实现顺序见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

房间接口和全员资源就绪屏障见 [docs/ROOMS_AND_SYNC.md](./docs/ROOMS_AND_SYNC.md)。
