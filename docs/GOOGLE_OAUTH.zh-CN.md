# Google OAuth 与 GA4/GSC 配置

SearchOps Hub 通过 Google OAuth 让每个租户授权自己的 Google 账号。应用不会要求开发者把 GA4 或 GSC 数据导出到公共文件。

## 1. 创建 Google Cloud 项目

1. 打开 Google Cloud Console。
2. 创建一个新项目，名称可以使用 `SearchOps Hub`。
3. 在 APIs & Services 中启用：
   - Google Analytics Data API
   - Google Analytics Admin API
   - Search Console API

## 2. 配置 Google Auth Platform

1. 设置应用名称、支持邮箱和开发者联系邮箱。
2. 内部 Google Workspace 组织可以选择 Internal；其他情况选择 External。
3. 添加测试用户，完成测试后再按 Google 要求发布。
4. 为应用准备隐私政策和服务条款。

## 3. 创建 OAuth Client

创建 Web application 类型的 OAuth Client。

本地 Authorized redirect URI：

```text
http://localhost:3210/auth/google/callback
```

生产 Authorized redirect URI：

```text
https://your-domain.example/auth/google/callback
```

回调地址必须与 `APP_BASE_URL` 的协议、域名和端口完全一致。

## 4. 配置服务器环境变量

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

不要把这两个值写进 README、截图、Issue、客户端 JavaScript或 Git 提交。

## 5. 授权范围

系统申请以下只读范围：

- `analytics.readonly`
- `webmasters.readonly`

授权后，用户只能选择该 Google 账号本身有权访问的 GA4 属性和 GSC 资源。

## 6. 常见问题

### 看不到 GA4 属性

确认账号拥有目标 GA4 Property 的 Viewer 或更高权限，并且 Analytics Admin API 已启用。

### 看不到 GSC 站点

确认账号是对应 URL-prefix 或 Domain Property 的已验证用户。

### redirect_uri_mismatch

检查 Google Cloud 中的回调地址是否与应用实际地址逐字符一致，尤其是 `http/https`、端口和末尾路径。

### 应用未经验证

测试模式下需要把账号加入测试用户。面向更多用户发布时，需要根据 Google 的敏感权限政策完成生产发布和可能的验证流程。
