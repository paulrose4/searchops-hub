# 局域网部署指南

局域网模式把应用、SQLite 数据库和 Google 令牌保存在一台 Windows 主机上。同事通过同一办公网络访问，不消耗 Vercel 计算额度或 Neon 数据库额度。

## 部署结构

- 服务地址：`http://主机局域网IP:3210`
- 监听地址：`0.0.0.0`
- 数据库：`data/searchops-hub-lan.sqlite`
- 会话库：`data/searchops-hub-lan.sessions.sqlite`
- 私密配置：`.env.lan`
- 日志：`data/lan-server.out.log` 和 `data/lan-server.err.log`
- 网络范围：Windows 防火墙仅允许 `LocalSubnet` 访问 3210 端口

不要在路由器上配置端口转发，也不要把 3210 端口暴露到公网。

## 首次配置

在项目目录运行：

```powershell
npm ci
npm run lan:setup
```

初始化程序会自动识别局域网 IP，生成随机会话密钥、令牌加密密钥和内部注册码，并写入不会提交到 Git 的 `.env.lan`。

使用管理员 PowerShell 执行一次防火墙配置：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/enable-lan-firewall.ps1
```

## 启动与停止

```powershell
npm run lan:start
npm run lan:stop
```

服务会在后台运行。启动成功后终端会显示同事需要访问的完整地址。

使用管理员 PowerShell 安装真正的开机启动任务：

```powershell
npm run lan:autostart
```

该任务使用 Windows `SYSTEM` 服务账户，在电脑开机时启动，不需要先登录桌面。安装程序会移除旧的“用户登录后启动”入口，避免重复运行。

主机必须保持开机，并关闭会让网卡或计算机自动休眠的电源策略。建议在路由器中为主机配置 DHCP 地址保留，避免局域网 IP 变化。

## 注册与权限

`.env.lan` 中的 `REGISTRATION_ACCESS_CODE` 是内部注册码。只通过公司内部渠道提供给员工，不要放进网页、文档或代码仓库。

如公司邮箱域名固定，可以设置：

```dotenv
REGISTRATION_ALLOWED_DOMAINS=example.com,example.org
```

修改 `.env.lan` 后重启服务。

## Google OAuth 限制

Google Web OAuth 通常不接受普通私网 IP 的 HTTP 回调地址。纯局域网 HTTP 模式可使用登录、租户、演示数据、已有报告和本地 SEO 功能，但“每位员工自行授权 Google 账号”需要以下方案之一：

1. 给局域网服务配置公司域名、内网 DNS 和有效 HTTPS 证书，再把 HTTPS 回调地址加入 Google Cloud OAuth 客户端。
2. 迁移现有数据库及相同的 `TOKEN_ENCRYPTION_KEY`，继续使用已经保存且仍有效的 Google 授权。

不要把同一套加密令牌与不同的 `TOKEN_ENCRYPTION_KEY` 混用，否则已有 Google 令牌将无法解密。

## AI 配置

AI 密钥只能填写在主机的 `.env.lan`：

```dotenv
OPENAI_API_KEY=服务器端密钥
OPENAI_BASE_URL=https://你的中转服务/v1
OPENAI_MODEL=中转服务支持的模型
OPENAI_EMBEDDING_ENABLED=true
```

密钥不会返回浏览器。同事共享的是服务器能力，不需要知道密钥。

## 备份与恢复

停止服务后备份以下两个文件：

- `data/searchops-hub-lan.sqlite`
- `data/searchops-hub-lan.sessions.sqlite`
- `.env.lan`

恢复时必须同时恢复二者。SQLite 文件保存租户、用户、网站和报告；`.env.lan` 保存令牌解密密钥和服务配置。

## 故障排查

1. 主机打开 `http://127.0.0.1:3210/health`，应看到 `{"status":"ok"}`。
2. 同事打开 `http://主机IP:3210/health`。
3. 若主机能开、同事不能开，检查双方是否在同一子网、是否使用访客 Wi-Fi，以及防火墙规则是否启用。
4. 查看 `data/lan-server.err.log` 获取启动错误。
