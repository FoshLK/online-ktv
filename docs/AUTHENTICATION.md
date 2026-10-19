# 账号与认证模块

## 已实现接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册账号并发送 6 位邮箱验证码 |
| POST | `/api/auth/verify-email` | 验证邮箱 |
| POST | `/api/auth/resend-verification` | 重新发送验证码，响应不暴露账号是否存在 |
| POST | `/api/auth/login` | 用户名或邮箱登录 |
| POST | `/api/auth/refresh` | 轮换刷新令牌并签发新访问令牌 |
| POST | `/api/auth/logout` | 撤销刷新令牌 |
| GET | `/api/auth/me` | 获取当前登录用户 |
| GET | `/api/auth/admin-session` | 验证管理员身份与角色 |

## 安全约定

- 密码使用 Argon2id 保存，服务端不记录或返回明文密码。
- 邮箱验证码 15 分钟有效，数据库只保存与用户 ID 绑定后的 SHA-256。
- 访问令牌有效期为 15 分钟；刷新令牌有效期为 30 天，每次刷新后旧令牌立即撤销。
- 账号被停用后，即使已有访问令牌也无法通过认证守卫。
- 管理端使用会话级存储，关闭桌面窗口后需要重新登录；所有管理 API 仍需服务端角色守卫。
- 当前用户端浏览器层使用本地存储保存令牌。正式发布前应迁移到 Tauri Stronghold 或操作系统凭据库。

## QQ 邮箱配置

在根目录 `.env` 填写：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-qq-account@qq.com
SMTP_AUTH_CODE=这里填写QQ邮箱SMTP授权码
```

不要填写 QQ 登录密码。`.env` 已被 Git 忽略，授权码不得出现在提交、截图和日志中。
