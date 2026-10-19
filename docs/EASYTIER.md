# EasyTier 本地服务网络

线上 KTV 的服务端仍运行在自己的电脑上，EasyTier 只负责让异地的桌面客户端像在同一个局域网中一样访问它。数据库、对象存储和 SMTP 密钥都留在服务端电脑，用户端与管理端只访问 KTV API。

## 推荐地址规划

| 节点 | EasyTier 虚拟 IPv4 | 作用 |
| --- | --- | --- |
| 服务端电脑 | `10.126.126.1` | 运行 NestJS、PGlite/PostgreSQL 和歌曲资源存储 |
| 管理电脑 | `10.126.126.2` | 运行 KTV Admin 桌面软件 |
| 用户电脑 | `10.126.126.10` 起 | 运行线上 KTV 桌面软件 |

所有节点必须使用相同且不容易猜到的网络名称和网络密钥，并且每台电脑的虚拟 IP 必须唯一。不要把网络密钥提交到 GitHub，也不要通过聊天发送。

## 服务端电脑

把官方 `easytier-windows-x86_64-v2.6.4.zip` 放在项目的 `工具` 目录。脚本首次启动时会自动解压到被 Git 忽略的 `data` 目录。在管理员 PowerShell 中运行：

```powershell
$env:KTV_EASYTIER_NETWORK_NAME = "你的网络名称"
npm run easytier:start -- -Ipv4 10.126.126.1
```

脚本会以隐藏输入方式询问网络密钥，只将它临时放进 EasyTier 子进程环境，不会放到进程命令行或项目文件。需要无交互启动时，可以只在当前 PowerShell 会话设置 `$env:KTV_EASYTIER_NETWORK_SECRET`。

默认监听 EasyTier 的 TCP/UDP `11010`，管理 RPC 仅绑定 `127.0.0.1:15888`。如果客户机能直接访问服务端电脑的公网或局域网地址，可让客户机通过 `-Peer tcp://服务端实际地址:11010` 加入；如果不能直连，可自行选择可信的 EasyTier 共享节点并使用 `-ExternalNode`。项目不会自动加入未知公共网络。

保持 EasyTier 终端运行，再分别启动数据库与 KTV 服务端：

```powershell
npm run db:dev
npm run dev:server:pglite
```

服务端使用 `SERVER_HOST=0.0.0.0`，因此 EasyTier 节点可访问 `http://10.126.126.1:3000/api/health`。Windows 防火墙只需允许 KTV API 的 TCP `3000` 和所选 EasyTier 监听端口；不要向公网开放 PostgreSQL 或本地 EasyTier RPC。

## 用户或管理电脑

安装同一版本 EasyTier，使用同一网络名称与密钥，并分配一个未占用的虚拟 IP：

```powershell
$env:KTV_EASYTIER_NETWORK_NAME = "与你的服务端相同"
npm run easytier:start -- -Ipv4 10.126.126.10 -Peer tcp://服务端实际地址:11010
```

如果客户机没有项目源码，也可以直接运行官方 `easytier-core.exe`；关键参数是相同的 `--network-name`、`--network-secret`、唯一的 `--ipv4` 和可到达的 `--peers`/`--external-node`。

打开“线上 KTV”或“KTV Admin”，在登录页的“服务器连接”填写：

```text
http://10.126.126.1:3000
```

桌面软件会保存此地址，并自动派生 `/api` 与 `/rooms` 实时连接。切换服务器会清除当前登录令牌，避免把一个服务器的令牌发送给另一个服务器。

## 检查与排错

EasyTier 保持运行时，在另一个终端执行：

```powershell
npm run easytier:status
Test-NetConnection 10.126.126.1 -Port 3000
Invoke-RestMethod http://10.126.126.1:3000/api/health
```

如果没有对等节点，先检查所有电脑的网络名称、网络密钥是否完全相同，再检查虚拟 IP 是否冲突、`11010` 防火墙规则以及 `-Peer` 地址是否可达。若提示无法创建 TUN 设备，应使用管理员权限运行 PowerShell。
