# 歌曲资源管线（0.4.0）

## 已实现流程

```text
后台桌面端选择授权音频 + UTF-8 LRC
  → 管理 API 校验管理员、文件数量、大小、扩展名和文件头
  → 本地对象存储采用临时文件 + 原子重命名
  → 服务端计算音频/LRC SHA-256
  → Prisma 事务写入 Song、SongAsset、Lyric、SongImportJob、AdminAuditLog
  → 用户端读取资源清单
  → Tauri Rust 下载到应用缓存并重新计算 SHA-256
  → 音频与歌词全部就绪后，通过 WebSocket 发送 asset:ready
  → 服务端仅在房间冻结成员全部就绪后安排统一 startAt
  → 桌面播放器通过受限 asset:// 路径读取缓存，按 startAt 输出音频和 LRC
```

当前默认驱动为 `STORAGE_DRIVER=local`，根目录由 `STORAGE_LOCAL_PATH` 指定，默认是仓库下被 Git 忽略的 `storage/objects`。对象键完全由服务端生成，下载接口不接受文件系统路径，因此客户端不能进行目录穿越。

## API

- `GET /api/songs/:songId/manifest`：登录用户读取当前发布版本的音频和歌词清单。
- `GET /api/assets/:assetId`：鉴权下载；支持单段 `Range: bytes=...`、`ETag` 和长期私有缓存。
- `GET /api/admin/songs`：管理员查询全部曲库状态。
- `POST /api/admin/songs/import`：管理员 multipart 上传，字段为 `audio`、`lyric` 和歌曲元数据。
- `PATCH /api/admin/songs/:songId/status`：发布或下架并写审计日志。

上传限制为每次一份音频和一份歌词、单文件最大 100 MB。音频当前接受带有效文件头的 MP3/WAV，LRC 最大 2 MB，必须包含至少一个时间标签。界面要求操作人确认拥有处理、缓存和使用权限；第三方音乐客户端、本地解密工具或下载工具不会由 API 自动调用。

## 桌面缓存

用户端命令 `cache_song_asset` 只接受 HTTP(S) URL、安全的歌曲 ID/文件名和 64 位十六进制哈希。下载最多 100 MB，先写 `.part` 文件，校验成功后才重命名为正式缓存；已有缓存也会重新计算哈希。失败的临时文件会删除，前端最多自动重试三次。

## 本地验证

先启动 PGlite 和 API，再执行：

```powershell
npm run db:seed:pglite
npm run smoke:resources -w @ktv/server
```

测试脚本在内存中生成 2 秒、440 Hz 的 PCM WAV 和原创 LRC，不读取仓库外歌曲，也不会把媒体文件写入 Git。首次执行导入资源，后续执行复用相同哈希的测试歌曲。

## 后续替换 MinIO

`ObjectStorageService` 是文件落盘边界。后续增加 MinIO/S3 驱动时，数据库对象键和客户端 manifest 无需变化；只需替换 put/delete/open 实现，并决定由 API 代理下载还是签发短期 URL。生产切换前还需补对象存储健康检查、分片上传、垃圾对象清理和容量告警。
