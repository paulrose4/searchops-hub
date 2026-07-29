# SearchOps Hub 部署指南

本指南覆盖本地演示、Docker、PostgreSQL、Google OAuth、AI 能力和生产部署。所有示例域名均为占位符，请替换为自己的地址。

## 1. 本地演示模式

### 环境要求

- Node.js 22+
- npm 10+
- Windows、macOS 或 Linux

### 安装

```bash
git clone https://github.com/paulrose4/searchops-hub.git
cd searchops-hub
npm ci
cp .env.example .env
npm start
```

Windows PowerShell 使用：

```powershell
Copy-Item .env.example .env
npm start
```

访问 <http://localhost:3210>。本地演示账号为 `demo@example.com` / `demo12345`。

本地模式默认使用 `data/searchops-hub.sqlite`。该文件已被 `.gitignore` 排除。

## 2. Docker 部署

先准备环境文件：

```bash
cp .env.example .env
docker compose up --build
```

停止服务：

```bash
docker compose down
```

删除本地演示数据卷：

```bash
docker compose down -v
```

`-v` 会永久删除 Docker 数据卷，只应在确认不需要现有数据时使用。

## 3. 生产环境必需变量

```env
NODE_ENV=production
PORT=3210
APP_BASE_URL=https://your-domain.example
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
SESSION_SECRET=replace-with-a-long-random-value
TOKEN_ENCRYPTION_KEY=replace-with-64-hex-characters
REGISTRATION_ACCESS_CODE=replace-with-a-long-random-value
ENABLE_DEMO_ACCOUNT=false
```

生产环境会默认关闭公开注册。至少配置以下一项：

- `REGISTRATION_ACCESS_CODE`：内部员工共享的高强度访问码。
- `REGISTRATION_ALLOWED_DOMAINS`：逗号分隔的工作邮箱域名，例如 `example.com,staff.example.org`。

同时配置两项时，访问码和邮箱域名必须同时通过。

### 生成安全密钥

Node.js：

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('base64url'))"
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))"
```

第一条可用于 `SESSION_SECRET` 和 `REGISTRATION_ACCESS_CODE`，第二条用于 `TOKEN_ENCRYPTION_KEY`。

## 4. PostgreSQL

生产环境必须使用持久化 PostgreSQL。数据库用户需要建表、建索引和创建 `vector` 扩展的权限。

首次部署：

1. 配置 `DATABASE_URL`。
2. 保持 `SKIP_DATABASE_INIT=false`。
3. 启动一次应用，访问 `/health`。
4. 确认表结构和 `pgvector` 已成功建立。
5. Serverless 环境可以把 `SKIP_DATABASE_INIT=true`，避免每次冷启动重复检查 Schema。

本地验证云数据库：

```bash
ENV_FILE=.env npm run verify:cloud-db
```

该脚本会创建两个临时租户验证数据隔离，然后清理测试数据。

## 5. Google OAuth

连接真实 GA4/GSC 前，需要配置：

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

本地回调：

```text
http://localhost:3210/auth/google/callback
```

生产回调：

```text
https://your-domain.example/auth/google/callback
```

完整步骤见 [Google OAuth 配置指南](GOOGLE_OAUTH.zh-CN.md)。

## 6. AI 与多语言 Embedding

AI 功能是可选能力。未配置 Key 时，GA4/GSC 报告、页面审计和词法蚕食检测仍可使用。

```env
OPENAI_API_KEY=your-server-side-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_MODE=responses
OPENAI_EMBEDDING_ENABLED=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
OPENAI_EMBEDDING_FALLBACK_MODELS=
OPENAI_EMBEDDING_DIMENSIONS=1024
OPENAI_EMBEDDING_TIMEOUT_MS=45000
```

也可以使用兼容 OpenAI API 的服务，但模型名、协议和 Embedding 维度必须与服务商文档一致。

任何 Key 都不能使用 `NEXT_PUBLIC_`、`VITE_` 等前端公开前缀。

## 7. Vercel

1. Fork 本仓库并导入 Vercel。
2. Framework Preset 选择 Other 或 Express 自动检测。
3. 将生产变量写入 Project Settings → Environment Variables。
4. 部署后检查 `/health`、`/login` 和 `/register`。
5. 把正式域名更新到 `APP_BASE_URL` 和 Google OAuth 回调列表。

不要上传本地 SQLite。Vercel 必须连接 PostgreSQL。

## 8. Render

仓库提供 `render.yaml`。创建 Blueprint 后补齐标记为 `sync: false` 的变量即可。

建议设置：

- Build Command：`npm ci`
- Start Command：`npm start`
- Health Check：`/health`
- Node：22+

## 9. 上线验收

```bash
npm ci
npm run check
npm test
```

生产环境逐项检查：

- `/health` 返回 `{"status":"ok"}`。
- 未登录访问根路径会跳转 `/login`。
- `/register` 要求内部访问码或工作邮箱。
- 错误访问码不会创建租户。
- Google OAuth 回调与 `APP_BASE_URL` 完全一致。
- API Key、OAuth Secret、数据库密码不出现在 HTML、浏览器日志和 Git 历史中。
- 每个租户只能访问自己的站点、报告、任务和授权记录。
