const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const PgStoreFactory = require("connect-pg-simple");
const { SqliteSessionStore } = require("./sqlite-session-store");
const { createRegistrationPolicy } = require("./registration-access");
const { createDataStore } = require("./data");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
require("dotenv").config();
const { generateReport } = require("./report");
const { buildDemoSnapshot } = require("./demo");
const googleService = require("./google");
const { auditSitePages, discoverSitemapUrls, inspectPage } = require("./audit");
const { optimizePage } = require("./page-optimizer");
const {
  analyzeCannibalization,
  buildDocument,
  detectMainLanguage,
  translationUrlReason,
  urlHash,
} = require("./cannibalization");
const {
  embedDocuments,
  embeddingConfig,
  probeMultilingualEmbeddings,
} = require("./multilingual-embeddings");
const {
  enhancePageOptimization,
  getAiConnectionStatus,
  probeAiGeneration,
  safeAiError,
} = require("./ai-page-optimizer");

const ROOT = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const databasePath =
  process.env.DATABASE_PATH || path.join(ROOT, "data", "searchops-hub.sqlite");
const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3210),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3210",
  databaseUrl: process.env.DATABASE_URL || "",
  databasePath,
  sessionDatabasePath:
    process.env.SESSION_DATABASE_PATH ||
    (databasePath.endsWith(".sqlite")
      ? databasePath.replace(/\.sqlite$/, ".sessions.sqlite")
      : `${databasePath}.sessions`),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isProduction ? "" : "development-session-secret-change-me"),
  tokenEncryptionKey:
    process.env.TOKEN_ENCRYPTION_KEY ||
    (isProduction
      ? ""
      : crypto
          .createHash("sha256")
          .update("development-token-key")
          .digest("hex")),
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  enableDemo: !isProduction && process.env.ENABLE_DEMO_ACCOUNT !== "false",
  skipDatabaseInit: process.env.SKIP_DATABASE_INIT === "true",
  registrationAccessCode: process.env.REGISTRATION_ACCESS_CODE || "",
  registrationAllowedDomains:
    process.env.REGISTRATION_ALLOWED_DOMAINS || "",
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : isProduction,
};
if (!config.sessionSecret)
  throw new Error("SESSION_SECRET is required in production");
const encryptionKey = Buffer.from(config.tokenEncryptionKey, "hex");
if (encryptionKey.length !== 32)
  throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters");
const registrationPolicy = createRegistrationPolicy({
  accessCode: config.registrationAccessCode,
  allowedDomains: config.registrationAllowedDomains,
  closedByDefault: isProduction,
});

const data = createDataStore({
  databaseUrl: config.databaseUrl,
  databasePath: config.databasePath,
});

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((p) => p.toString("base64url"))
    .join(".");
}
function decrypt(value) {
  const [iv, tag, body] = String(value)
    .split(".")
    .map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"),
  );
}
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function n(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}
function p(value, digits = 1) {
  return (Number(value || 0) * 100).toFixed(digits) + "%";
}
function delta(value) {
  return value === null || value === undefined
    ? "暂无对比"
    : (value >= 0 ? "+" : "") + (value * 100).toFixed(1) + "%";
}
async function createTenant({ organization, name, email, password }) {
  return data.createTenantAndOwner({
    organization,
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 12),
  });
}
async function saveReport(tenantId, site, snapshot) {
  if (snapshot.source === "google-api" && !snapshot.audit) {
    try {
      snapshot.audit = await auditSitePages(site, snapshot);
    } catch (error) {
      snapshot.audit = {
        generatedAt: new Date().toISOString(),
        requested: 0,
        successful: 0,
        failed: 0,
        pages: [],
        error: error.message,
      };
    }
  }
  const report = generateReport(snapshot, {
    name: site.name,
    websiteUrl: site.website_url,
    targetMarkets: site.target_markets || "",
    brandTerms: site.brand_terms || "",
  });
  return data.saveSnapshotAndReport({ tenantId, site, snapshot, report });
}
async function seedDemo() {
  if (!config.enableDemo || (await data.emailExists("demo@example.com")))
    return;
  const ids = await createTenant({
    organization: "演示增长团队",
    name: "演示管理员",
    email: "demo@example.com",
    password: "demo12345",
  });
  const siteId = await data.insertSite({
    tenant_id: ids.tenantId,
    name: "Example Outdoor 演示站",
    website_url: "https://shop.example.com/",
    ga4_property_id: "279099870",
    ga4_property_name: "Example Outdoor - GA4",
    gsc_site_url: "https://shop.example.com/",
    status: "connected",
  });
  await saveReport(
    ids.tenantId,
    {
      id: siteId,
      name: "Example Outdoor 演示站",
      website_url: "https://shop.example.com/",
    },
    buildDemoSnapshot(),
  );
}

let initialization = null;
function ensureInitialized() {
  if (config.skipDatabaseInit) return Promise.resolve();
  if (!initialization) {
    initialization = data.init().then(seedDemo).catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: config.sessionCookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.sessionCookieSecure,
  }),
);
app.use(express.urlencoded({ extended: false, limit: "200kb" }));
app.use(express.json({ limit: "200kb" }));
const publicDir = path.join(ROOT, "public");
const staticOptions = { maxAge: isProduction ? "1d" : 0 };
app.use(express.static(publicDir, staticOptions));
app.use("/assets", express.static(publicDir, staticOptions));
const sessionStore = config.databaseUrl
  ? new (PgStoreFactory(session))({
      conObject: {
        connectionString: config.databaseUrl.replace(
          "sslmode=require",
          "sslmode=verify-full",
        ),
        ssl: { rejectUnauthorized: false },
      },
      createTableIfMissing: true,
    })
  : isProduction
    ? new SqliteSessionStore({ filename: config.sessionDatabasePath })
    : undefined;
app.use(
  session({
    store: sessionStore,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "growth.sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.sessionCookieSecure,
      maxAge: 604800000,
    },
  }),
);
app.use((req, res, next) => {
  if (!req.session.csrf)
    req.session.csrf = crypto.randomBytes(24).toString("base64url");
  next();
});
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const submitted = String(req.body?._csrf || req.get("x-csrf-token") || ""),
    expected = String(req.session.csrf || "");
  if (
    !submitted ||
    submitted.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected))
  )
    return res.status(403).send("请求已失效，请刷新后重试。");
  next();
});
app.use(async (req, res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    next(error);
  }
});
app.use(async (req, res, next) => {
  try {
    req.user = req.session.userId
      ? await data.getUserById(req.session.userId)
      : null;
    next();
  } catch (error) {
    next(error);
  }
});
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}
function flash(req, type, message) {
  req.session.flash = { type, message };
}
function takeFlash(req) {
  if (!req.session) return null;
  const value = req.session.flash;
  delete req.session.flash;
  return value;
}
function layout(req, title, content, active = "") {
  const user = req.user,
    msg = takeFlash(req);
  const nav = user
    ? `<aside class="sidebar"><a class="brand" href="/dashboard"><span class="brand-mark">S</span><span>SearchOps Hub</span></a><nav><a class="${active === "dashboard" ? "active" : ""}" href="/dashboard"><i data-lucide="layout-dashboard"></i>总览</a><a class="${active === "sites" ? "active" : ""}" href="/sites/new"><i data-lucide="circle-plus"></i>接入网站</a><a class="${active === "tasks" ? "active" : ""}" href="/tasks"><i data-lucide="list-checks"></i>SEO 任务</a><a class="${active === "team" ? "active" : ""}" href="/team"><i data-lucide="users"></i>成员</a></nav><div class="sidebar-foot"><span>${esc(user.tenant_name)}</span><small>${esc(user.name)}</small><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="icon-text"><i data-lucide="log-out"></i>退出</button></form></div></aside>`
    : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · SearchOps Hub</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/ops.css"></head><body class="${user ? "app-shell" : "auth-shell"}">${nav}<main class="${user ? "main" : ""}">${msg ? `<div class="flash ${esc(msg.type)}">${esc(msg.message)}</div>` : ""}${content}</main><script src="https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"></script><script src="/app.js"></script></body></html>`;
}
function head(title, subtitle, actions = "") {
  return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></header>`;
}
function empty(icon, title, text, action = "") {
  return `<section class="empty"><i data-lucide="${icon}"></i><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</section>`;
}
function errorPage(req, status, title, message) {
  return req.res
    .status(status)
    .send(layout(req, title, empty("circle-alert", title, message)));
}
function table(headers, rows, options = {}) {
  const minWidth = headers.length >= 6 ? 760 : headers.length === 5 ? 640 : 0;
  const id = options.id ? ` id="${esc(options.id)}"` : "";
  const filter = options.filter ? " data-filter-table" : "";
  return `<div class="table-wrap"><table${id}${filter}${minWidth ? ` style="min-width:${minWidth}px"` : ""}><thead><tr>${headers.map((h) => "<th>" + esc(h) + "</th>").join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function stepList(items, fallback = "") {
  const values = Array.isArray(items) && items.length ? items : fallback ? [fallback] : [];
  return values.length ? `<ol>${values.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>` : "-";
}
function hidden(name, value) {
  return `<input type="hidden" name="${esc(name)}" value="${esc(value || "")}">`;
}
function taskForm(req, values) {
  return `<form method="post" action="/tasks" class="create-task-form">${hidden("_csrf", req.session.csrf)}${hidden("site_id", values.siteId)}${hidden("report_id", values.reportId)}${hidden("priority", values.priority)}${hidden("title", values.title)}${hidden("target_url", values.targetUrl)}${hidden("query", values.query)}${hidden("country", values.country)}${hidden("evidence", values.evidence)}${hidden("action", values.action)}${hidden("target", values.target)}${hidden("baseline_json", values.baseline)}<button class="secondary compact" title="创建 SEO 任务"><i data-lucide="list-plus"></i>创建任务</button></form>`;
}
function filterBar(tableId, options = {}) {
  const priority = options.priority === false ? "" : `<label>优先级<select data-filter-field="priority"><option value="">全部</option><option>P1</option><option>P2</option><option>P3</option></select></label>`;
  const country = options.country ? `<label>国家<select data-filter-field="country"><option value="">全部国家</option>${options.country.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select></label>` : "";
  const intent = options.intent ? `<label>意图<select data-filter-field="intent"><option value="">全部意图</option>${options.intent.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select></label>` : "";
  return `<div class="report-filter" data-filter-controls="${esc(tableId)}"><label class="filter-search">搜索<input type="search" data-filter-search placeholder="输入页面、关键词或诊断"></label>${priority}${country}${intent}<span data-filter-count></span><button type="button" class="secondary" data-export-table="${esc(tableId)}"><i data-lucide="download"></i>导出 CSV</button></div>`;
}
function pageLibrary(req, reportId, summary = {}) {
  const total = Number(summary.total || 0);
  const truncationMessages = [];
  if (summary.ga4PossiblyTruncated) truncationMessages.push('GA4 落地页达到分页保护上限，可能还有长尾 URL 未返回');
  if (summary.gscPossiblyTruncated) truncationMessages.push('GSC 页面达到分页保护上限，且 Search Console API 本身可能隐藏长尾数据');
  const truncation = truncationMessages.length ? `<span class="library-warning">${esc(truncationMessages.join('；'))}。</span>` : '';
  return `<div class="page-library-summary"><div><span>全部页面</span><strong>${n(total)}</strong></div><div><span>GA4 + GSC</span><strong>${n(summary.both || 0)}</strong></div><div><span>仅 GA4</span><strong>${n(summary.ga4 || 0)}</strong></div><div><span>仅 GSC</span><strong>${n(summary.gsc || 0)}</strong></div><div><span>P1 页面</span><strong>${n(summary.p1 || 0)}</strong></div></div>${truncation}<div class="page-library" data-page-library data-endpoint="/reports/${esc(reportId)}/pages" data-csrf="${esc(req.session.csrf)}"><div class="report-filter page-library-controls"><label class="filter-search">搜索全部页面<input type="search" data-page-search placeholder="输入 URL、诊断或动作"></label><label>数据来源<select data-page-source><option value="">全部来源</option><option value="both">GA4 + GSC</option><option value="ga4">仅 GA4</option><option value="gsc">仅 GSC</option></select></label><label>优先级<select data-page-priority><option value="">全部</option><option>P1</option><option>P2</option><option>P3</option></select></label><label>每页<select data-page-size><option value="50">50</option><option value="100" selected>100</option><option value="200">200</option></select></label><span data-page-count>${total ? `共 ${n(total)} 个页面` : '重新同步后生成全量页面库'}</span><button type="button" class="secondary" data-page-export><i data-lucide="download"></i>导出全部 CSV</button></div><div class="table-wrap"><table class="page-library-table" style="min-width:1240px"><thead><tr><th>优先级</th><th>页面与来源</th><th>GA4 行为</th><th>GSC 搜索</th><th>运营诊断</th><th>建议动作</th><th>页面智能体</th></tr></thead><tbody data-page-rows><tr><td colspan="7">正在读取全量页面数据…</td></tr></tbody></table></div><div class="page-pagination"><button type="button" class="secondary" data-page-prev><i data-lucide="chevron-left"></i>上一页</button><span data-page-status>第 1 页</span><button type="button" class="secondary" data-page-next>下一页<i data-lucide="chevron-right"></i></button></div><div class="optimizer-modal" data-optimizer-modal hidden><div class="optimizer-backdrop" data-optimizer-close></div><section class="optimizer-dialog" role="dialog" aria-modal="true" aria-labelledby="optimizer-title"><header><div><span>WordPress SEO 页面智能体</span><h2 id="optimizer-title" data-optimizer-title>页面深度优化</h2></div><button type="button" class="icon-button" data-optimizer-close title="关闭"><i data-lucide="x"></i></button></header><div class="optimizer-body" data-optimizer-body><div class="optimizer-loading"><i data-lucide="loader-circle"></i><strong>正在核查页面</strong><p>读取实时 HTML，并结合该页 GA4、GSC 搜索词和 WordPress 环境生成方案。</p></div></div></section></div></div>`;

}

function cannibalizationWorkbench(req, reportId) {
  return `<div class="cannibal-workbench" data-cannibal-workbench data-endpoint="/reports/${esc(reportId)}/cannibalization" data-csrf="${esc(req.session.csrf)}"><div class="cannibal-toolbar"><div><h2>全站关键词蚕食检测</h2><p>仅扫描默认主语言页面，自动排除语言目录、翻译参数和 HTML lang 不一致页面。向量、正文和结果严格保存在当前租户空间。</p></div><button type="button" class="primary" data-cannibal-start><i data-lucide="scan-search"></i>开始全站检测</button></div><div class="cannibal-status" data-cannibal-status><strong>尚未开始</strong><span>点击开始后将分批抓取，页面可保持打开并自动续跑。</span></div><div data-cannibal-results></div></div>`;
}
function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""').replace(/\s+/g, ' ').trim()}"`;
}
function externalUrl(base, value) {
  try {
    const url = new URL(String(value || ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

app.get("/health", (req, res) => res.json({ status: "ok" }));

async function sendAiConnectionStatus(req, res, options = {}) {
  try {
    const status = options.probe
      ? await probeAiGeneration()
      : await getAiConnectionStatus();
    if (options.html) {
      return res.send(
        layout(
          req,
          "AI 连接状态",
          `<section class="panel"><h1>AI 连接状态</h1><pre data-ai-connection-status>${esc(JSON.stringify(status, null, 2))}</pre></section>`,
        ),
      );
    }
    res.json(status);
  } catch (error) {
    const safeError = safeAiError(error);
    console.error("AI connection check failed", safeError);
    if (options.html) {
      return res.status(502).send(
        layout(
          req,
          "AI 连接失败",
          empty("circle-alert", "AI 连接失败", "请检查中转站密钥、余额或接口地址。"),
        ),
      );
    }
    res.status(502).json({
      configured: true,
      connected: false,
      code: safeError.code,
      status: safeError.status,
      error: "AI 中转站连接失败，请检查密钥、余额或接口地址。",
    });
  }
}

app.get("/settings/ai-connection", requireAuth, sendAiConnectionStatus);
async function sendEmbeddingConnectionStatus(req, res, options = {}) {
  const embedding = embeddingConfig();
  try {
    const probe = options.probe ? await probeMultilingualEmbeddings() : null;
    const status = {
      configured: Boolean(embedding.apiKey),
      enabled: embedding.enabled,
      connected: probe ? true : undefined,
      model: embedding.model,
      expectedDimensions: embedding.dimensions,
      vectorSearch: data.isVectorSearchAvailable(),
      probe,
    };
    if (options.html) {
      return res.send(layout(req, "多语言 Embedding 状态", `<section class="panel"><h1>多语言 Embedding 状态</h1><pre data-embedding-connection-status>${esc(JSON.stringify(status, null, 2))}</pre></section>`));
    }
    res.json(status);
  } catch (error) {
    const safeError = safeAiError(error);
    console.error("Embedding connection check failed", safeError);
    const status = {
      configured: Boolean(embedding.apiKey),
      enabled: embedding.enabled,
      connected: false,
      model: embedding.model,
      vectorSearch: data.isVectorSearchAvailable(),
      error: "多语言 Embedding 连接失败，请检查模型名称及中转站是否支持 embeddings 接口。",
    };
    if (options.html) {
      return res.status(502).send(layout(req, "多语言 Embedding 连接失败", `<section class="panel"><h1>多语言 Embedding 连接失败</h1><pre data-embedding-connection-status>${esc(JSON.stringify(status, null, 2))}</pre></section>`));
    }
    res.status(502).json(status);
  }
}
app.get("/settings/embedding-connection", requireAuth, sendEmbeddingConnectionStatus);
app.get("/", (req, res) => res.redirect(req.user ? "/dashboard" : "/login"));
app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  res.send(
    layout(
      req,
      "登录",
      `<section class="auth-panel"><div class="auth-brand"><span class="brand-mark">S</span><div><strong>SearchOps Hub</strong><small>GA4 + GSC 中文运营系统</small></div></div><h1>登录工作区</h1><p class="muted">查看网站增长诊断、SEO 机会和执行计划。</p><form method="post" action="/login" class="form-stack"><input type="hidden" name="_csrf" value="${req.session.csrf}"><label>邮箱<input name="email" type="email" required></label><label>密码<input name="password" type="password" required></label><button class="primary">登录</button></form>${config.enableDemo ? '<div class="demo-note"><strong>演示账号</strong><span>demo@example.com / demo12345</span></div>' : ""}${registrationPolicy.configured ? '<p class="auth-switch">内部员工首次使用？<a href="/register">创建工作区</a></p>' : '<p class="auth-switch">账号注册已关闭，请联系内部管理员。</p>'}</section>`,
    ),
  );
});
app.post("/login", async (req, res) => {
  const user = await data.getUserByEmail(
    String(req.body.email || "")
      .trim()
      .toLowerCase(),
  );
  if (
    !user ||
    !bcrypt.compareSync(String(req.body.password || ""), user.password_hash)
  ) {
    flash(req, "error", "邮箱或密码不正确。");
    return res.redirect("/login");
  }
  req.session.userId = user.id;
  res.redirect("/dashboard");
});
app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  if (!registrationPolicy.configured) {
    return res.status(403).send(
      layout(
        req,
        "注册已关闭",
        `<section class="auth-panel"><div class="auth-brand"><span class="brand-mark">S</span><div><strong>SearchOps Hub</strong><small>仅供内部员工使用</small></div></div><h1>注册入口已关闭</h1><p class="muted">请联系内部管理员开通账号。</p><p class="auth-switch"><a href="/login">返回登录</a></p></section>`,
      ),
    );
  }
  const accessCodeField = registrationPolicy.requiresAccessCode
    ? `<label>内部访问码<input name="access_code" type="password" autocomplete="one-time-code" required></label>`
    : "";
  const domainNote = registrationPolicy.allowedDomains.length
    ? `<p class="muted">仅允许使用公司工作邮箱注册。</p>`
    : "";
  res.send(
    layout(
      req,
      "内部员工注册",
      `<section class="auth-panel"><div class="auth-brand"><span class="brand-mark">S</span><div><strong>SearchOps Hub</strong><small>仅供内部员工使用</small></div></div><h1>创建内部工作区</h1>${domainNote}<form method="post" action="/register" class="form-stack"><input type="hidden" name="_csrf" value="${req.session.csrf}">${accessCodeField}<label>团队或公司名称<input name="organization" required></label><label>你的姓名<input name="name" required></label><label>工作邮箱<input name="email" type="email" required></label><label>密码<input name="password" type="password" minlength="8" required></label><button class="primary">验证并创建</button></form><p class="auth-switch">已有账号？<a href="/login">返回登录</a></p></section>`,
    ),
  );
});
app.post("/register", async (req, res) => {
  const organization = String(req.body.organization || "").trim(),
    name = String(req.body.name || "").trim(),
    email = String(req.body.email || "")
      .trim()
      .toLowerCase(),
    password = String(req.body.password || ""),
    submittedAccessCode = String(req.body.access_code || "");
  if (!organization || !name || !email || password.length < 8) {
    flash(req, "error", "请完整填写信息，密码至少 8 位。");
    return res.redirect("/register");
  }
  if (!registrationPolicy.allows({ email, submittedAccessCode })) {
    flash(req, "error", "内部注册校验失败，请检查访问码或工作邮箱。");
    return res.redirect("/register");
  }
  if (await data.emailExists(email)) {
    flash(req, "error", "这个邮箱已经注册。");
    return res.redirect("/register");
  }
  const ids = await createTenant({ organization, name, email, password });
  req.session.userId = ids.userId;
  res.redirect("/dashboard");
});
app.post("/logout", (req, res) =>
  req.session.destroy(() => res.redirect("/login")),
);
app.get("/dashboard", requireAuth, async (req, res) => {
  if (req.query.embedding_status === "1") {
    return sendEmbeddingConnectionStatus(req, res, {
      html: true,
      probe: req.query.embedding_probe === "1",
    });
  }
  if (req.query.ai_status === "1") {
    return sendAiConnectionStatus(req, res, {
      html: true,
      probe: req.query.ai_probe === "1",
    });
  }
  const [sites, taskSummary] = await Promise.all([
    data.listSites(req.user.tenant_id),
    data.taskSummary(req.user.tenant_id),
  ]);
  const connection = await data.getConnectionForUser(
    req.user.tenant_id,
    req.user.id,
  );
  const rows = sites.map(
    (site) =>
      `<tr><td><a class="site-name" href="/sites/${site.id}">${esc(site.name)}</a><small>${esc(site.website_url)}</small></td><td><span class="status ${site.status}">${site.status === "connected" ? "已连接" : site.status === "error" ? "异常" : "待配置"}</span></td><td>${site.last_synced_at ? esc(site.last_synced_at) : "尚未同步"}</td><td>${site.report_id ? `<a class="icon-button" href="/reports/${site.report_id}" title="查看报告"><i data-lucide="file-chart-column"></i></a>` : "-"}</td></tr>`,
  );
  const connect = config.googleClientId
    ? `<a class="button secondary" href="/auth/google"><i data-lucide="plug"></i>${connection ? "重新授权" : "连接 Google"}</a>`
    : `<a class="button secondary" href="/setup"><i data-lucide="settings"></i>配置 Google OAuth</a>`;
  res.send(
    layout(
      req,
      "总览",
      head(
        "网站增长总览",
        "每个网站独立同步 GA4 与 GSC，并生成完整中文运营方案。",
        connect +
          `<a class="button primary" href="/sites/new"><i data-lucide="circle-plus"></i>接入网站</a>`,
      ) +
        `<section class="summary-strip"><div><span>网站</span><strong>${sites.length}</strong></div><div><span>Google 授权</span><strong>${connection ? "已连接" : "未连接"}</strong></div><div><span>待推进任务</span><strong>${n((taskSummary.todo || 0) + (taskSummary.doing || 0) + (taskSummary.review || 0))}</strong></div><div><span>数据边界</span><strong>GA4 + GSC</strong></div></section>${sites.length ? `<section class="table-section"><div class="section-title"><h2>网站列表</h2><span>${sites.length} 个站点</span></div>${table(["网站", "状态", "最近同步", "报告"], rows)}</section>` : empty("globe-2", "还没有接入网站", "先授权 Google，然后选择你有权限的 GA4 属性与 GSC 站点。", `<a class="button primary" href="${config.googleClientId ? "/auth/google" : "/setup"}">开始配置</a>`)}`,
      "dashboard",
    ),
  );
});
app.get("/setup", requireAuth, (req, res) =>
  res.send(
    layout(
      req,
      "部署配置",
      head(
        "Google OAuth 配置",
        "这一步由系统管理员完成一次，其他同事只需点击 Google 授权。",
      ) +
        `<section class="content-section prose"><h2>需要配置的环境变量</h2><dl><dt>GOOGLE_CLIENT_ID</dt><dd>${config.googleClientId ? "已配置" : "尚未配置"}</dd><dt>GOOGLE_CLIENT_SECRET</dt><dd>${config.googleClientSecret ? "已配置" : "尚未配置"}</dd><dt>授权回调地址</dt><dd><code>${esc(config.appBaseUrl + "/auth/google/callback")}</code></dd></dl><p>在 Google Cloud 中启用 Google Analytics Admin API、Google Analytics Data API 和 Search Console API，创建“Web 应用”OAuth 客户端，并把上面的回调地址加入已获授权的重定向 URI。</p></section>`,
      "sites",
    ),
  ),
);
app.get("/auth/google", requireAuth, (req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    flash(req, "error", "系统尚未配置 Google OAuth。");
    return res.redirect("/setup");
  }
  const state = crypto.randomBytes(24).toString("base64url");
  req.session.googleState = state;
  res.redirect(googleService.authorizationUrl(config, state));
});
app.get("/auth/google/callback", requireAuth, async (req, res) => {
  if (!req.query.state || req.query.state !== req.session.googleState)
    return errorPage(
      req,
      400,
      "授权校验失败",
      "Google 授权状态无效，请重新发起授权。",
    );
  delete req.session.googleState;
  try {
    const result = await googleService.exchangeCode(
      config,
      String(req.query.code || ""),
    );
    const old = await data.getConnectionForUser(
      req.user.tenant_id,
      req.user.id,
    );
    const oldTokens = old ? decrypt(old.encrypted_tokens) : {};
    const tokens = {
      ...oldTokens,
      ...result.tokens,
      refresh_token: result.tokens.refresh_token || oldTokens.refresh_token,
    };
    await data.upsertConnection({
      tenant_id: req.user.tenant_id,
      user_id: req.user.id,
      google_email: result.profile.email || "",
      encrypted_tokens: encrypt(tokens),
      scopes: googleService.SCOPES.join(" "),
    });
    flash(req, "success", "Google 已授权，可以选择 GA4 属性和 GSC 站点。");
    res.redirect("/sites/new");
  } catch (error) {
    console.error(error);
    errorPage(req, 500, "Google 授权失败", error.message);
  }
});
app.get("/sites/new", requireAuth, async (req, res) => {
  const connection = await data.getConnectionForUser(
    req.user.tenant_id,
    req.user.id,
  );
  if (!connection)
    return res.send(
      layout(
        req,
        "接入网站",
        head("接入网站", "Google 授权后，系统只展示当前账号有权访问的资源。") +
          empty(
            "plug-zap",
            "先连接 Google",
            "授权只申请 GA4 与 Search Console 的只读权限。",
            `<a class="button primary" href="${config.googleClientId ? "/auth/google" : "/setup"}">${config.googleClientId ? "连接 Google" : "配置 OAuth"}</a>`,
          ),
        "sites",
      ),
    );
  try {
    const resources = await googleService.listResources(
      config,
      decrypt(connection.encrypted_tokens),
    );
    const properties = resources.properties
      .map(
        (item) =>
          `<option value="${esc(item.id)}" data-name="${esc(item.name)}">${esc(item.name)} · ${esc(item.account)}</option>`,
      )
      .join("");
    const sites = resources.sites
      .map(
        (item) =>
          `<option value="${esc(item.url)}">${esc(item.url)} · ${esc(item.permission)}</option>`,
      )
      .join("");
    res.send(
      layout(
        req,
        "接入网站",
        head(
          "接入网站",
          "选择同一网站对应的 GA4 属性和 GSC 资源。",
          `<a class="button secondary" href="/auth/google"><i data-lucide="refresh-cw"></i>重新授权</a>`,
        ) +
          `<section class="form-section"><form method="post" action="/sites" class="form-grid" data-site-form><input type="hidden" name="_csrf" value="${req.session.csrf}"><label>网站名称<input name="name" required placeholder="例如：美国官网"></label><label>网站网址<input name="website_url" type="url" required placeholder="https://www.example.com/"></label><label>GA4 属性<select name="ga4_property_id" required><option value="">请选择 GA4 属性</option>${properties}</select><small>找到 ${resources.properties.length} 个可访问属性</small></label><label>GSC 站点<select name="gsc_site_url" required><option value="">请选择 GSC 站点</option>${sites}</select><small>找到 ${resources.sites.length} 个已验证站点</small></label><div class="form-actions"><a class="button ghost" href="/dashboard">取消</a><button class="primary">保存并同步</button></div></form></section>`,
        "sites",
      ),
    );
  } catch (error) {
    console.error(error);
    res.send(
      layout(
        req,
        "接入网站",
        head("接入网站", "无法读取 Google 资源。") +
          empty(
            "circle-alert",
            "读取资源失败",
            error.message,
            '<a class="button primary" href="/auth/google">重新授权</a>',
          ),
        "sites",
      ),
    );
  }
});
app.post("/sites", requireAuth, async (req, res) => {
  const connection = await data.getConnectionForUser(
    req.user.tenant_id,
    req.user.id,
  );
  if (!connection) {
    flash(req, "error", "请先连接 Google。");
    return res.redirect("/sites/new");
  }
  try {
    const resources = await googleService.listResources(
      config,
      decrypt(connection.encrypted_tokens),
    );
    const property = resources.properties.find(
        (item) => item.id === String(req.body.ga4_property_id),
      ),
      gsc = resources.sites.find(
        (item) => item.url === String(req.body.gsc_site_url),
      );
    if (!property || !gsc)
      throw new Error("所选资源不在当前 Google 账号的授权范围内。");
    const name = String(req.body.name || "").trim(),
      websiteUrl = String(req.body.website_url || "").trim();
    new URL(websiteUrl);
    const siteId = await data.insertSite({
      tenant_id: req.user.tenant_id,
      connection_id: connection.id,
      name,
      website_url: websiteUrl,
      ga4_property_id: property.id,
      ga4_property_name: property.name,
      gsc_site_url: gsc.url,
      status: "pending",
    });
    const site = await data.getSite(req.user.tenant_id, siteId);
    const snapshot = await googleService.syncSite(
      config,
      decrypt(connection.encrypted_tokens),
      site,
    );
    const reportId = await saveReport(req.user.tenant_id, site, snapshot);
    flash(req, "success", "网站已接入并完成首次同步。");
    res.redirect("/reports/" + reportId);
  } catch (error) {
    console.error(error);
    flash(req, "error", "接入失败：" + error.message);
    res.redirect("/sites/new");
  }
});
app.get("/sites/:id", requireAuth, async (req, res) => {
  const site = await data.getSite(req.user.tenant_id, req.params.id);
  if (!site)
    return errorPage(req, 404, "网站不存在", "当前工作区没有这个网站。");
  const reports = await data.listReports(req.user.tenant_id, site.id);
  const rows = reports.map(
    (item, index) =>
      `<tr><td>${index === 0 ? "最新报告" : "历史报告"}</td><td>${esc(item.created_at)}</td><td><a class="button compact" href="/reports/${item.id}">查看</a></td></tr>`,
  );
  const canManage = ["owner", "admin"].includes(req.user.role);
  const syncForm = `<form method="post" action="/sites/${site.id}/sync" class="sync-form"><input type="hidden" name="_csrf" value="${req.session.csrf}"><label>周期<select name="days"><option value="7"${Number(site.sync_days) === 7 ? " selected" : ""}>最近 7 天</option><option value="28"${![7, 90].includes(Number(site.sync_days)) ? " selected" : ""}>最近 28 天</option><option value="90"${Number(site.sync_days) === 90 ? " selected" : ""}>最近 90 天</option></select></label><label>自定义开始<input type="date" name="start_date"></label><label>自定义结束<input type="date" name="end_date"></label><button class="primary"><i data-lucide="refresh-cw"></i>同步并生成报告</button></form>`;
  const settings = canManage
    ? `<section class="form-section"><div class="section-title"><h2>站点运营设置</h2><span>用于品牌词、目标市场和报告默认周期</span></div><form method="post" action="/sites/${site.id}/settings" class="form-grid"><input type="hidden" name="_csrf" value="${req.session.csrf}"><label>站点名称<input name="name" value="${esc(site.name)}" required></label><label>默认周期<select name="sync_days"><option value="7"${Number(site.sync_days) === 7 ? " selected" : ""}>7 天</option><option value="28"${Number(site.sync_days) === 28 ? " selected" : ""}>28 天</option><option value="90"${Number(site.sync_days) === 90 ? " selected" : ""}>90 天</option></select></label><label>目标市场<small>用逗号分隔</small><input name="target_markets" value="${esc(site.target_markets || "")}" placeholder="美国, 德国, 越南"></label><label>品牌词<small>用逗号分隔</small><input name="brand_terms" value="${esc(site.brand_terms || "")}" placeholder="品牌名, 常见拼写"></label><label>运营时区<input name="timezone" value="${esc(site.timezone || "UTC")}" placeholder="Asia/Shanghai"></label><div class="form-actions"><button class="primary">保存设置</button></div></form></section>`
    : "";
  res.send(
    layout(
      req,
      site.name,
      head(
        site.name,
        site.website_url,
        "",
      ) +
        `${syncForm}<section class="detail-grid"><div><span>GA4 属性</span><strong>${esc(site.ga4_property_name || site.ga4_property_id)}</strong></div><div><span>GSC 站点</span><strong>${esc(site.gsc_site_url)}</strong></div><div><span>最近同步</span><strong>${esc(site.last_synced_at || "尚未同步")}</strong></div><div><span>状态</span><strong>${site.status === "connected" ? "正常" : site.status === "error" ? "异常" : "待同步"}</strong></div></section>${site.last_error ? `<div class="flash error">${esc(site.last_error)}</div>` : ""}<section class="table-section"><div class="section-title"><h2>报告记录</h2></div>${reports.length ? table(["报告", "生成时间", ""], rows) : empty("file-chart-column", "还没有报告", "点击同步后生成第一份中文运营方案。")}</section>${settings}`,
      "dashboard",
    ),
  );
});
app.post("/sites/:id/settings", requireAuth, async (req, res) => {
  if (!["owner", "admin"].includes(req.user.role))
    return errorPage(req, 403, "没有权限", "只有所有者和管理员可以修改站点设置。");
  const site = await data.getSite(req.user.tenant_id, req.params.id);
  if (!site) return errorPage(req, 404, "网站不存在", "当前工作区没有这个网站。");
  const syncDays = [7, 28, 90].includes(Number(req.body.sync_days)) ? Number(req.body.sync_days) : 28;
  await data.updateSite(req.user.tenant_id, site.id, {
    name: String(req.body.name || site.name).trim(),
    sync_days: syncDays,
    target_markets: String(req.body.target_markets || "").trim(),
    brand_terms: String(req.body.brand_terms || "").trim(),
    timezone: String(req.body.timezone || "UTC").trim() || "UTC",
  });
  flash(req, "success", "站点运营设置已保存。");
  res.redirect("/sites/" + site.id);
});
app.post("/sites/:id/sync", requireAuth, async (req, res) => {
  const site = await data.getSite(req.user.tenant_id, req.params.id);
  if (!site)
    return errorPage(req, 404, "网站不存在", "当前工作区没有这个网站。");
  if (!site.connection_id && config.enableDemo) {
    const reportId = await saveReport(
      req.user.tenant_id,
      site,
      buildDemoSnapshot(),
    );
    flash(req, "success", "演示数据已重新生成。");
    return res.redirect("/reports/" + reportId);
  }
  const connection = await data.getConnectionById(
    req.user.tenant_id,
    site.connection_id,
  );
  if (!connection) {
    flash(req, "error", "原 Google 授权已失效，请重新授权。");
    return res.redirect("/sites/" + site.id);
  }
  try {
    const snapshot = await googleService.syncSite(
      config,
      decrypt(connection.encrypted_tokens),
      site,
      {
        days: Number(req.body.days || site.sync_days || 28),
        startDate: String(req.body.start_date || ""),
        endDate: String(req.body.end_date || ""),
      },
    );
    const reportId = await saveReport(req.user.tenant_id, site, snapshot);
    flash(req, "success", "同步完成，已生成新的中文运营方案。");
    res.redirect("/reports/" + reportId);
  } catch (error) {
    console.error(error);
    await data.setSiteError(req.user.tenant_id, site.id, error.message);
    flash(req, "error", "同步失败：" + error.message);
    res.redirect("/sites/" + site.id);
  }
});

app.get("/reports/:id", requireAuth, async (req, res) => {
  const row = await data.getReport(req.user.tenant_id, req.params.id);
  if (!row) return errorPage(req, 404, "报告不存在", "当前工作区没有这份报告。");
  const report = JSON.parse(row.report_json);
  if (Number(report.version || 1) < 4) return res.redirect(`/reports/${row.id}/legacy`);
  const k = report.kpis;
  const siteBase = row.website_url;
  const cards = [
    ["会话", n(k.sessions), delta(k.sessionsChange)],
    ["自然搜索占比", p(k.organicShare), "会话 " + n(k.organicSessions)],
    ["加购事件密度", (Number(k.addToCartDensity || k.addToCartRate || 0) * 100).toFixed(2), "次 / 百次会话"],
    ["GSC 点击", n(k.gscClicks), delta(k.gscClicksChange)],
    ["GSC CTR", p(k.gscCtr, 2), "曝光 " + n(k.gscImpressions)],
    ["数据可信度", report.dataHealth?.level || "未知", `${report.dataHealth?.warningCount || 0} 个警告`],
  ].map((item) => `<div class="kpi"><span>${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></div>`).join("");

  const healthRows = (report.dataHealth?.checks || []).map((item) => `<div class="health-item ${esc(item.status)}"><i data-lucide="${item.status === "pass" ? "circle-check" : item.status === "fail" ? "circle-x" : "triangle-alert"}"></i><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></div>`).join("");
  const channelRows = report.channels.map((item) => `<tr><td>${esc(item.name)}</td><td>${n(item.sessions)}</td><td>${p(item.share)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td></tr>`);

  const pageRows = report.pagePriorities.map((item) => {
    const url = externalUrl(siteBase, item.page);
    const audit = item.audit;
    const form = taskForm(req, {
      siteId: row.site_id, reportId: row.id, priority: item.priority,
      title: `页面优化：${item.page}`, targetUrl: url, evidence: item.evidence,
      action: (item.steps || []).join("\n"), target: item.target,
      baseline: JSON.stringify({ sessions: item.sessions, addToCartDensity: item.atcRate }),
    });
    return `<tr data-priority="${esc(item.priority)}" data-search="${esc(`${item.page} ${item.diagnosis} ${item.evidence}`)}"><td><span class="priority ${item.priority.toLowerCase()}">${item.priority}</span></td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><code>${esc(item.page)}</code></a>` : `<code>${esc(item.page)}</code>`}<small>${esc(item.evidence)}</small></td><td>${n(item.sessions)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td><td>${esc(item.diagnosis)}${audit?.issues?.length ? `<small class="issue-text">页面实测：${esc(audit.issues.join("；"))}</small>` : ""}</td><td>${stepList(item.steps, item.action)}<small><strong>验收：</strong>${esc(item.target)}</small>${form}</td></tr>`;
  });

  const queryRows = report.queryOpportunities.map((item) => `<tr data-priority="${item.confidence === "高" ? "P1" : "P2"}" data-intent="${esc(item.type)}" data-search="${esc(`${item.query} ${item.targetPage} ${item.action}`)}"><td><strong>${esc(item.query)}</strong><small>${esc(item.type)} · 置信度 ${esc(item.confidence)}</small></td><td>${n(item.impressions)}</td><td>${n(item.clicks)}</td><td>${p(item.ctr, 2)}</td><td>${Number(item.position).toFixed(1)}</td><td>${n(item.potentialClicks)}</td><td>${item.targetPage ? `<code>${esc(item.targetPage)}</code>` : "待识别"}</td><td>${esc(item.action)}</td></tr>`);

  const countryQueryRows = (report.countryQueries || []).map((item) => {
    const url = externalUrl(siteBase, item.targetPage);
    const form = taskForm(req, {
      siteId: row.site_id, reportId: row.id, priority: item.priority || "P2",
      title: `${item.countryLabel}：${item.query}`, targetUrl: url, query: item.query,
      country: item.countryLabel, evidence: item.evidence, action: (item.steps || []).join("\n"), target: item.target,
      baseline: JSON.stringify({ clicks: item.clicks, impressions: item.impressions, ctr: item.ctr, position: item.position }),
    });
    return `<tr data-priority="${esc(item.priority || "P2")}" data-country="${esc(item.countryLabel)}" data-intent="${esc(item.intent)}" data-search="${esc(`${item.countryLabel} ${item.query} ${item.targetPage} ${item.diagnosis}`)}"><td><strong>${esc(item.countryLabel)}</strong><small>${esc(item.intent)}</small></td><td><strong>${esc(item.query)}</strong><small>${esc(item.evidence)}</small></td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><code>${esc(item.targetPage)}</code></a>` : `<code>${esc(item.targetPage)}</code>`}</td><td>${esc(item.diagnosis)}</td><td>${stepList(item.steps, item.action)}<small><strong>验收：</strong>${esc(item.target)}</small>${form}</td></tr>`;
  });

  const seoRoadmapRows = (report.seoRoadmap || []).map((item) => {
    const url = externalUrl(siteBase, item.page);
    const form = taskForm(req, {
      siteId: row.site_id, reportId: row.id, priority: item.priority,
      title: item.title, targetUrl: url, evidence: item.evidence,
      action: (item.steps || []).join("\n"), target: item.target,
    });
    return `<tr data-priority="${esc(item.priority)}" data-search="${esc(`${item.title} ${item.page} ${item.diagnosis}`)}"><td><span class="priority ${item.priority.toLowerCase()}">${esc(item.priority)}</span></td><td><strong>${esc(item.title)}</strong><small>${esc(item.evidence)}</small></td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><code>${esc(item.page)}</code></a>` : `<code>${esc(item.page)}</code>`}</td><td>${esc(item.diagnosis)}</td><td>${stepList(item.steps)}<small><strong>验收：</strong>${esc(item.target)}</small>${form}</td></tr>`;
  });

  const auditRows = (report.pageAudits || []).map((item) => `<tr data-search="${esc(`${item.path} ${item.title} ${(item.issues || []).join(" ")}`)}"><td>${item.finalUrl ? `<a href="${esc(item.finalUrl)}" target="_blank" rel="noopener"><code>${esc(item.path)}</code></a>` : `<code>${esc(item.path)}</code>`}</td><td><span class="status ${item.status >= 200 && item.status < 400 ? "connected" : "error"}">${item.status || "失败"}</span></td><td><strong>${esc(item.title || "未取得")}</strong><small>Title ${n(item.titleLength)} 字 · H1 ${(item.h1s || []).length} 个 · ${item.canonical ? "有 canonical" : "无 canonical"}</small></td><td>${item.signals?.product ? "商品 " : ""}${item.signals?.faq ? "FAQ " : ""}${item.signals?.shipping ? "配送 " : ""}${item.signals?.payment ? "支付 " : ""}${item.signals?.cta ? "CTA" : ""}</td><td>${item.issues?.length ? `<ul class="compact-list">${item.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : "未发现规则问题"}</td></tr>`);

  const cannibalRows = (report.cannibalization || []).map((item) => `<tr data-search="${esc(`${item.query} ${item.pages.map((page) => page.page).join(" ")}`)}"><td><strong>${esc(item.query)}</strong></td><td><span class="priority ${item.risk === "高" ? "p1" : "p2"}">${esc(item.risk)}</span></td><td>${n(item.impressions)}</td><td>${item.pages.map((page) => `<code>${esc(new URL(page.page).pathname)}</code><small>${n(page.impressions)} 曝光，${n(page.clicks)} 点击</small>`).join("")}</td><td>确定一个唯一主页面；其余页面合并、重定向或调整意图，并把内部链接集中到主页面。</td></tr>`);

  const briefCards = (report.contentBriefs || []).map((brief) => `<details class="brief"><summary><strong>${esc(brief.title)}</strong><span>${esc(brief.intent)}</span></summary><div class="brief-grid"><div><span>目标页面</span><code>${esc(brief.targetPage)}</code></div><div><span>推荐 Title</span><p>${esc(brief.titleSuggestion)}</p></div><div><span>Meta Description</span><p>${esc(brief.metaSuggestion)}</p></div><div><span>H1</span><p>${esc(brief.h1Suggestion)}</p></div></div><h3>页面结构</h3><ol>${brief.sections.map((section) => `<li>${esc(section)}</li>`).join("")}</ol><p class="insight">${esc(brief.evidence)} 验收：${esc(brief.target)}</p></details>`).join("");

  const marketCountryRows = (report.marketCountries || []).map((item) => `<tr><td><strong>${esc(item.country)}</strong><small>${esc(item.strategy)}</small></td><td>${n(item.sessions)}</td><td>${p(item.share)}</td><td>${p(item.engagementRate, 2)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td><td><span class="status connected">${esc(item.priority)}</span></td></tr>`);
  const languageRows = (report.languages || []).map((item) => `<tr><td><strong>${esc(item.label)}</strong><small>${esc(item.strategy)}</small></td><td>${n(item.sessions)}</td><td>${p(item.share)}</td><td>${p(item.engagementRate, 2)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td><td><span class="status connected">${esc(item.priority)}</span></td></tr>`);
  const countryLanguageRows = (report.countryLanguages || []).map((item) => `<tr><td>${esc(item.country)}</td><td>${esc(item.languageLabel)}</td><td>${n(item.sessions)}</td><td>${p(item.countryShare)}</td><td>${p(item.engagementRate, 2)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td><td>${esc(item.insight)}</td></tr>`);
  const countryChannelRows = (report.countryChannels || []).map((item) => `<tr><td>${esc(item.country)}</td><td>${esc(item.sessionDefaultChannelGroup)}</td><td>${n(item.sessions)}</td><td>${p(item.countryShare)}</td><td>${p(item.engagementRate, 2)}</td><td>${(Number(item.atcRate || 0) * 100).toFixed(2)}</td><td>${esc(item.strategy)}</td></tr>`);
  const countryRows = (report.countries || []).map((item) => `<tr><td>${esc(String(item.country).toUpperCase())}</td><td>${n(item.clicks)}</td><td>${n(item.impressions)}</td><td>${p(item.ctr, 2)}</td><td>${Number(item.position).toFixed(1)}</td><td>${esc(item.strategy)}</td></tr>`);
  const countryDeviceRows = (report.countryDevices || []).map((item) => `<tr><td>${esc(String(item.country).toUpperCase())}</td><td>${esc(item.device)}</td><td>${n(item.clicks)}</td><td>${n(item.impressions)}</td><td>${p(item.ctr, 2)}</td><td>${Number(item.position).toFixed(1)}</td><td>${esc(item.strategy)}</td></tr>`);
  const actionRows = report.actions.map((item) => `<tr><td>${esc(item.phase)}</td><td><span class="priority ${item.priority.toLowerCase()}">${item.priority}</span></td><td>${esc(item.action)}</td><td>${esc(item.owner)}</td><td>${esc(item.outcome)}</td></tr>`);
  const appearanceRows = (report.searchAppearances || []).map((item) => `<tr><td>${esc(item.searchAppearance)}</td><td>${n(item.clicks)}</td><td>${n(item.impressions)}</td><td>${p(item.ctr, 2)}</td><td>${Number(item.position).toFixed(1)}</td></tr>`);
  const countryOptions = [...new Set((report.countryQueries || []).map((item) => item.countryLabel))];
  const intentOptions = [...new Set((report.countryQueries || []).map((item) => item.intent))];
  const tabs = `<div class="tabs" data-tabs><button class="active" data-tab="overview">运营总览</button><button data-tab="pages">页面优化</button><button data-tab="cannibalization">关键词蚕食</button><button data-tab="seo">SEO 机会</button><button data-tab="technical">内容与技术</button><button data-tab="markets">国家与语言</button><button data-tab="tracking">追踪与计划</button></div>`;
  const trendJson = JSON.stringify(report.trend || []).replace(/</g, "\\u003c");
  const content = head(report.site.name, `数据周期 ${report.period.start} 至 ${report.period.end} · ${report.period.days || ""} 天`, `<a class="button secondary" href="/sites/${row.site_id}"><i data-lucide="history"></i>历史报告</a><a class="button secondary" href="/tasks"><i data-lucide="list-checks"></i>任务中心</a><button class="button primary" onclick="window.print()"><i data-lucide="printer"></i>打印 / PDF</button>`) +
    `<div class="boundary"><i data-lucide="info"></i>${esc(report.boundary)}</div>${tabs}` +
    `<section data-panel="overview"><div class="kpi-grid">${cards}</div><section class="report-section"><div class="section-title"><h2>数据健康中心</h2><span class="health-level level-${esc(report.dataHealth?.level || "未知")}">可信度 ${esc(report.dataHealth?.level || "未知")}</span></div><div class="health-grid">${healthRows}</div></section><section class="report-section"><h2>28/90 天趋势基础</h2><p>趋势来自同一报告周期的每日 GA4 与 GSC 数据，可用于识别异常日期；后续优化任务会以此作为前后基线。</p><div class="chart-grid"><div><h3>会话与 GSC 点击</h3><canvas data-trend-chart="traffic" height="220"></canvas></div><div><h3>GSC 曝光与 CTR</h3><canvas data-trend-chart="search" height="220"></canvas></div></div><script type="application/json" data-trend-data>${trendJson}</script></section><section class="report-section"><h2>运营结论</h2><ol class="conclusions">${report.conclusions.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></section><section class="report-section"><h2>渠道诊断</h2>${table(["渠道", "会话", "流量占比", "每百次会话加购事件"], channelRows)}</section></section>` +
    `<section data-panel="pages" hidden><section class="report-section"><h2>GA4 + GSC 全量页面库</h2><p>汇总本周期 GA4 可见落地页和 GSC 可见页面，按 URL 去重。全量数据由服务端分页、搜索和导出，不再限制为前 10 条；真实 HTML 深度抓取仍优先覆盖高价值页面。</p>${pageLibrary(req, row.id, report.pageInventorySummary)}</section><section class="report-section"><h2>优先页面执行清单</h2><p>以下是从全量页面中选出的首批高优先级任务，以事件密度而非会话转化率呈现 add_to_cart，并结合真实页面抓取证据。</p>${filterBar("page-priorities")}${pageRows.length ? table(["优先级", "页面与依据", "会话", "加购事件密度", "运营诊断", "执行与验收"], pageRows, { id: "page-priorities", filter: true }) : empty("badge-check", "当前没有高风险页面", "继续监控流量最大的落地页。")}</section></section>` +
    `<section data-panel="cannibalization" hidden><section class="report-section">${cannibalizationWorkbench(req, row.id)}</section></section>` +
    `<section data-panel="seo" hidden><section class="report-section"><h2>SEO 优先执行清单</h2>${filterBar("seo-roadmap")}${table(["优先级", "任务与依据", "目标页面", "诊断", "执行与验收"], seoRoadmapRows, { id: "seo-roadmap", filter: true })}</section><section class="report-section"><h2>全站 SEO 机会</h2><p>潜在点击以站点同排名区间的实际 CTR 为基准估算，不代表结果承诺。</p>${filterBar("query-opportunities", { priority: false })}${table(["查询", "曝光", "点击", "CTR", "排名", "潜在点击", "主页面", "优化动作"], queryRows, { id: "query-opportunities", filter: true })}</section><section class="report-section"><h2>国家 × 搜索词详细方案</h2>${filterBar("country-queries", { country: countryOptions, intent: intentOptions })}${table(["市场与意图", "关键词与证据", "当前排名页", "运营诊断", "具体执行与验收"], countryQueryRows, { id: "country-queries", filter: true })}</section></section>` +
    `<section data-panel="technical" hidden><section class="report-section"><h2>真实页面审计</h2><p>只抓取绑定域名的高优先级公开页面，页面证据与 GA4/GSC 推断分开呈现。</p>${filterBar("page-audits", { priority: false })}${auditRows.length ? table(["页面", "状态", "搜索要素", "已识别模块", "实测问题"], auditRows, { id: "page-audits", filter: true }) : empty("scan-search", "暂未取得页面审计", report.auditSummary?.error || "重新同步后生成页面证据。")}</section><section class="report-section"><h2>关键词蚕食风险</h2>${filterBar("cannibalization", { priority: false })}${cannibalRows.length ? table(["查询", "风险", "曝光", "竞争页面", "处理建议"], cannibalRows, { id: "cannibalization", filter: true }) : empty("git-merge", "没有达到阈值的蚕食风险", "继续监控同一查询出现多个排名 URL 的情况。")}</section><section class="report-section"><h2>内容简报</h2><p>可直接交给编辑作为初稿，但标题、库存、配送和品牌事实仍需人工审核。</p><div class="brief-list">${briefCards}</div></section>${appearanceRows.length ? `<section class="report-section"><h2>搜索外观</h2>${table(["搜索外观", "点击", "曝光", "CTR", "排名"], appearanceRows)}</section>` : ""}</section>` +
    `<section data-panel="markets" hidden><section class="report-section"><h2>GA4 国家运营优先级</h2>${table(["国家与建议", "会话", "占比", "互动率", "加购事件密度", "运营标签"], marketCountryRows)}</section><section class="report-section"><h2>浏览器语言表现</h2>${table(["语言与建议", "会话", "占比", "互动率", "加购事件密度", "运营标签"], languageRows)}</section><section class="report-section"><h2>国家 × 语言</h2>${table(["国家", "语言", "会话", "国家内占比", "互动率", "加购事件密度", "判断"], countryLanguageRows)}</section><section class="report-section"><h2>国家 × 渠道</h2>${table(["国家", "渠道", "会话", "国家内占比", "互动率", "加购事件密度", "动作"], countryChannelRows)}</section><section class="report-section"><h2>GSC 国家搜索需求</h2>${table(["国家", "点击", "曝光", "CTR", "排名", "策略"], countryRows)}</section><section class="report-section"><h2>国家 × 设备 SEO</h2><p class="insight">${esc(report.marketInsight)}</p>${table(["国家", "设备", "点击", "曝光", "CTR", "排名", "策略"], countryDeviceRows)}</section></section>` +
    `<section data-panel="tracking" hidden><section class="report-section"><h2>GA4 追踪优化</h2><div class="tracking-status"><span>当前状态</span><strong>${esc(report.tracking.status)}</strong><div><b>add_to_cart ${n(report.tracking.addToCarts)}</b><b>begin_checkout ${n(report.tracking.checkouts)}</b><b>purchase ${n(report.tracking.purchases)}</b></div></div><ul class="check-list">${report.tracking.recommendations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section><section class="report-section"><h2>7 / 30 / 90 天执行计划</h2>${table(["阶段", "优先级", "动作", "负责人", "预期结果"], actionRows)}</section><section class="report-section"><h2>每周复盘指标</h2><div class="metric-list">${report.weeklyKpis.map((item, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span>${esc(item)}</div>`).join("")}</div></section></section>`;
  res.send(layout(req, report.site.name + " 运营报告", content, "dashboard"));
});

app.get("/reports/:id/pages", requireAuth, async (req, res) => {
  const report = await data.getReport(req.user.tenant_id, req.params.id);
  if (!report) {
    if (req.query.format === "csv") return res.status(404).send("报告不存在");
    return res.status(404).json({ error: "报告不存在" });
  }
  const filters = {
    page: req.query.page,
    pageSize: req.query.pageSize,
    search: req.query.search,
    source: req.query.source,
    priority: req.query.priority,
    all: req.query.format === "csv",
  };
  const result = await data.listReportPages(
    req.user.tenant_id,
    report.id,
    filters,
  );
  if (req.query.format !== "csv") return res.json(result);

  const headers = [
    "优先级", "页面", "完整 URL", "数据来源", "GA4 会话", "GA4 用户",
    "GA4 互动会话", "GA4 加购事件", "每百次会话加购事件数", "GSC 点击",
    "GSC 曝光", "GSC CTR", "GSC 平均排名", "页面实测问题", "运营诊断",
    "建议动作", "数据依据",
  ];
  const lines = [headers.map(csvValue).join(",")];
  for (const row of result.rows) {
    lines.push([
      row.priority,
      row.page,
      row.url,
      row.source === "both" ? "GA4 + GSC" : row.source === "ga4" ? "仅 GA4" : "仅 GSC",
      row.sessions,
      row.users,
      row.engaged_sessions,
      row.add_to_carts,
      (Number(row.add_to_cart_density || 0) * 100).toFixed(2),
      row.gsc_clicks,
      row.gsc_impressions,
      (Number(row.gsc_ctr || 0) * 100).toFixed(2) + "%",
      Number(row.gsc_position || 0).toFixed(1),
      row.auditIssues.join("；"),
      row.diagnosis,
      row.action,
      row.evidence,
    ].map(csvValue).join(","));
  }
  const filename = `report-${report.id}-all-pages-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\ufeff" + lines.join("\r\n"));
});

function cannibalizationPayload(run, fallbackTotal = 0) {
  return {
    status: run?.status || "pending",
    mainLanguage: run?.main_language || "",
    totalCandidates: Number(run?.total_candidates || fallbackTotal),
    processedPages: Number(run?.processed_pages || 0),
    includedPages: Number(run?.included_pages || 0),
    excludedPages: Number(run?.excluded_pages || 0),
    discovery: run?.discovery || {},
    error: run?.error || "",
    result: run?.result || null,
  };
}

app.get("/reports/:id/cannibalization", requireAuth, async (req, res) => {
  const report = await data.getReport(req.user.tenant_id, req.params.id);
  if (!report) return res.status(404).json({ error: "报告不存在" });
  const run = await data.getCannibalizationRun(req.user.tenant_id, report.id, { includeCandidates: false });
  if (!run) {
    const pages = await data.listReportPages(req.user.tenant_id, report.id, { all: true });
    return res.json(cannibalizationPayload(null, pages.total));
  }
  res.json(cannibalizationPayload(run));
});

app.post("/reports/:id/cannibalization/scan", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const report = await data.getReport(tenantId, req.params.id);
  if (!report) return res.status(404).json({ error: "报告不存在" });
  const context = await data.getReportContext(tenantId, report.id);
  if (!context) return res.status(404).json({ error: "报告数据不存在" });
  try {
    const normalizeUrl = (value) => {
      try {
        const url = new URL(value, context.website_url);
        url.hash = "";
        return url.href;
      } catch {
        return "";
      }
    };
    let run = await data.getCannibalizationRun(tenantId, report.id, { includeCandidates: false });
    if (!run?.total_candidates || req.body?.reset === true || req.body?.reset === "1") {
      const hostname = new URL(context.website_url).hostname;
      const [pageResult, homepage, discovery] = await Promise.all([
        data.listReportPages(tenantId, report.id, { all: true }),
        inspectPage(context.website_url, hostname),
        discoverSitemapUrls(context.website_url),
      ]);
      const candidates = new Map();
      for (const page of pageResult.rows) {
        const url = normalizeUrl(page.url);
        if (url) candidates.set(url, { ...page, url, source: "GA4 GSC" });
      }
      for (const value of discovery.urls) {
        const url = normalizeUrl(value);
        if (!url || candidates.has(url)) continue;
        candidates.set(url, { id: null, page: new URL(url).pathname, url, source: "Sitemap", gsc_clicks: 0, gsc_impressions: 0, sessions: 0 });
      }
      run = await data.resetCannibalizationRun({
        tenantId,
        siteId: context.site_id,
        reportId: report.id,
        mainLanguage: detectMainLanguage(homepage),
        candidates: [...candidates.values()],
        discovery: {
          reportPages: pageResult.rows.length,
          sitemapPages: discovery.urls.length,
          sitemapFiles: discovery.sitemapFiles,
          truncated: discovery.truncated,
          errors: discovery.errors,
        },
      });
    }

    const batch = await data.getCannibalizationCandidateBatch(
      tenantId,
      report.id,
      run.processed_pages,
      12,
    );
    if (!batch.length && run.processed_pages < run.total_candidates) {
      throw new Error("候选页面分页读取失败");
    }
    const hostname = new URL(context.website_url).hostname;
    const documents = await Promise.all(batch.map(async (page) => {
      const translated = translationUrlReason(page.url);
      if (translated) {
        return { reportPageId: page.id, page: page.page, url: page.url, urlHash: urlHash(page.url), excludedReason: translated };
      }
      const audit = await inspectPage(page.url, hostname);
      const pageLanguage = detectMainLanguage(audit);
      if (!audit.status || audit.status >= 400) {
        return { reportPageId: page.id, page: page.page, url: page.url, urlHash: urlHash(page.url), language: pageLanguage, status: audit.status || 0, excludedReason: `页面抓取失败 HTTP ${audit.status || 0}` };
      }
      if (pageLanguage !== run.main_language) {
        return { reportPageId: page.id, page: page.page, url: page.url, urlHash: urlHash(page.url), language: pageLanguage, status: audit.status, excludedReason: `页面语种 ${pageLanguage} 与主语言 ${run.main_language} 不一致` };
      }
      return buildDocument({ page, audit });
    }));
    const includedDocuments = documents.filter((document) => !document.excludedReason);
    const embeddingBatch = await embedDocuments(includedDocuments);
    const embeddedByHash = new Map(embeddingBatch.documents.map((document) => [document.urlHash, document]));
    await Promise.all(documents.map((document) => data.upsertCannibalizationDocument({
      tenantId,
      siteId: context.site_id,
      reportId: report.id,
      document: embeddedByHash.get(document.urlHash) || document,
    })));
    run = await data.updateCannibalizationRun({ tenantId, reportId: report.id, status: "scanning" });
    if (run.processed_pages >= run.total_candidates) {
      const documents = await data.listCannibalizationDocuments(tenantId, report.id);
      const semanticPairs = await data.listCannibalizationSemanticPairs(tenantId, report.id, { limit: 10, minSimilarity: 0.55 });
      const embedding = embeddingConfig();
      const result = analyzeCannibalization(documents, 0.75, {
        semanticPairs,
        embeddingStatus: {
          enabled: embedding.enabled,
          configured: Boolean(embedding.apiKey),
          model: embedding.model,
          vectorSearch: data.isVectorSearchAvailable(),
        },
      });
      result.scope = {
        mainLanguage: run.main_language,
        totalCandidates: run.total_candidates,
        includedPages: run.included_pages,
        excludedPages: run.excluded_pages,
        discovery: run.discovery,
      };
      run = await data.updateCannibalizationRun({ tenantId, reportId: report.id, status: "completed", result });
    }
    res.json(cannibalizationPayload(run));
  } catch (error) {
    console.error("Cannibalization scan failed", error);
    await data.updateCannibalizationRun({ tenantId, reportId: report.id, status: "error", error: String(error.message || error).slice(0, 500) }).catch(() => {});
    res.status(500).json({ error: "关键词蚕食检测暂时失败，请稍后重试。" });
  }
});

async function buildPageOptimization(req) {
  const report = await data.getReport(req.user.tenant_id, req.params.id);
  if (!report) return { error: "报告不存在", status: 404 };
  const page = await data.getReportPage(req.user.tenant_id, report.id, req.params.pageId);
  if (!page) return { error: "页面不存在", status: 404 };
  const context = await data.getReportContext(req.user.tenant_id, report.id);
  if (!context) return { error: "报告数据不存在", status: 404 };
  const snapshot = JSON.parse(context.data_json);
  const site = {
    id: context.site_id,
    name: context.site_name,
    website_url: context.website_url,
    target_markets: context.target_markets || "",
    brand_terms: context.brand_terms || "",
    timezone: context.timezone || "UTC",
  };
  const audit = await inspectPage(page.url, new URL(site.website_url).hostname);
  const ruleResult = optimizePage({ page, snapshot, site, audit });
  let result;
  try {
    result = await enhancePageOptimization({ ruleResult, page, site, audit });
  } catch (error) {
    error.optimizationContext = { report, page, context };
    throw error;
  }
  return { report, page, context, result };
}

app.get("/reports/:id/pages/:pageId/optimization-preview", requireAuth, async (req, res) => {
  try {
    const generated = await buildPageOptimization(req);
    if (generated.error) return res.status(generated.status).send(
      layout(req, "页面优化预览失败", empty("circle-alert", "页面优化预览失败", generated.error)),
    );
    res.send(
      layout(
        req,
        "页面优化预览",
        `<section class="panel"><h1>页面优化预览</h1><pre data-page-optimization-preview>${esc(JSON.stringify(generated.result, null, 2))}</pre></section>`,
      ),
    );
  } catch (error) {
    const safeError = safeAiError(error);
    console.error("Page optimizer preview failed", safeError);
    res.status(500).send(
      layout(
        req,
        "页面优化预览失败",
        empty("circle-alert", "页面优化预览失败", safeError.message || "AI 页面深度分析暂时失败。"),
      ),
    );
  }
});

app.get("/reports/:id/pages/:pageId/optimization", requireAuth, async (req, res) => {
  const report = await data.getReport(req.user.tenant_id, req.params.id);
  if (!report) return res.status(404).json({ error: "报告不存在" });
  const page = await data.getReportPage(req.user.tenant_id, report.id, req.params.pageId);
  if (!page) return res.status(404).json({ error: "页面不存在" });
  const optimization = await data.getPageOptimization(req.user.tenant_id, report.id, page.id);
  if (!optimization?.result) return res.status(404).json({ error: "该页面尚未生成深度优化方案" });
  res.json({ result: optimization.result, updatedAt: optimization.updated_at });
});

app.post("/reports/:id/pages/:pageId/optimize", requireAuth, async (req, res) => {
  let generated;
  try {
    generated = await buildPageOptimization(req);
    if (generated.error) return res.status(generated.status).json({ error: generated.error });
    const { report, context, page, result } = generated;
    await data.savePageOptimization({
      tenantId: req.user.tenant_id,
      siteId: context.site_id,
      reportId: report.id,
      reportPageId: page.id,
      userId: req.user.id,
      status: "completed",
      result,
    });
    res.json({ result });
  } catch (error) {
    const safeError = safeAiError(error);
    console.error("Page optimizer failed", safeError);
    const failed = generated || error.optimizationContext;
    if (failed?.context && failed?.report && failed?.page) {
      await data.savePageOptimization({
        tenantId: req.user.tenant_id,
        siteId: failed.context.site_id,
        reportId: failed.report.id,
        reportPageId: failed.page.id,
        userId: req.user.id,
        status: "error",
        error: safeError.message,
      }).catch(() => {});
    }
    const status = error.code === "AI_NOT_CONFIGURED" ? 503 : 500;
    res.status(status).json({
      error: error.code === "AI_NOT_CONFIGURED"
        ? "AI 本地化服务尚未在服务器完成配置，请联系管理员。"
        : "AI 页面深度分析暂时失败，请稍后重试。",
    });
  }
});

app.get("/reports/:id/legacy", requireAuth, async (req, res) => {
  const row = await data.getReport(req.user.tenant_id, req.params.id);
  if (!row)
    return errorPage(req, 404, "报告不存在", "当前工作区没有这份报告。");
  const report = JSON.parse(row.report_json),
    k = report.kpis;
  const cards = [
    ["会话", n(k.sessions), delta(k.sessionsChange)],
    ["自然搜索占比", p(k.organicShare), "会话 " + n(k.organicSessions)],
    ["站点加购率", p(k.addToCartRate, 2), "GA4 行为信号"],
    ["GSC 点击", n(k.gscClicks), delta(k.gscClicksChange)],
    ["GSC CTR", p(k.gscCtr, 2), "曝光 " + n(k.gscImpressions)],
    ["平均排名", Number(k.averagePosition).toFixed(1), "数值越低越好"],
  ]
    .map(
      (x) =>
        `<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`,
    )
    .join("");
  const channelRows = report.channels.map(
    (r) =>
      `<tr><td>${esc(r.name)}</td><td>${n(r.sessions)}</td><td>${p(r.share)}</td><td>${p(r.atcRate, 2)}</td></tr>`,
  );
  const pageRows = report.pagePriorities.map(
    (r) =>
      `<tr><td><span class="priority ${r.priority.toLowerCase()}">${r.priority}</span></td><td><code>${esc(r.page)}</code><small>${esc(r.evidence || r.diagnosis)}</small></td><td>${n(r.sessions)}</td><td>${p(r.atcRate, 2)}</td><td>${esc(r.diagnosis)}</td><td>${stepList(r.steps, r.action)}<small><strong>验收：</strong>${esc(r.target || "观察该页自然流量与加购率变化。")}</small></td></tr>`,
  );
  const queryRows = report.queryOpportunities.map(
    (r) =>
      `<tr><td><strong>${esc(r.query)}</strong><small>${esc(r.type)}</small></td><td>${n(r.impressions)}</td><td>${n(r.clicks)}</td><td>${p(r.ctr, 2)}</td><td>${Number(r.position).toFixed(1)}</td><td>${esc(r.action)}</td></tr>`,
  );
  const marketCountryRows = (report.marketCountries || []).map(
    (r) =>
      `<tr><td><strong>${esc(r.country)}</strong><small>${esc(r.strategy)}</small></td><td>${n(r.sessions)}</td><td>${p(r.share)}</td><td>${p(r.engagementRate, 2)}</td><td>${p(r.atcRate, 2)}</td><td><span class="status connected">${esc(r.priority)}</span></td></tr>`,
  );
  const languageRows = (report.languages || []).map(
    (r) =>
      `<tr><td><strong>${esc(r.label)}</strong><small>${esc(r.strategy)}</small></td><td>${n(r.sessions)}</td><td>${p(r.share)}</td><td>${p(r.engagementRate, 2)}</td><td>${p(r.atcRate, 2)}</td><td><span class="status connected">${esc(r.priority)}</span></td></tr>`,
  );
  const countryLanguageRows = (report.countryLanguages || []).map(
    (r) =>
      `<tr><td>${esc(r.country)}</td><td>${esc(r.languageLabel)}</td><td>${n(r.sessions)}</td><td>${p(r.countryShare)}</td><td>${p(r.engagementRate, 2)}</td><td>${p(r.atcRate, 2)}</td><td>${esc(r.insight)}</td></tr>`,
  );
  const countryChannelRows = (report.countryChannels || []).map(
    (r) =>
      `<tr><td>${esc(r.country)}</td><td>${esc(r.sessionDefaultChannelGroup)}</td><td>${n(r.sessions)}</td><td>${p(r.countryShare)}</td><td>${p(r.engagementRate, 2)}</td><td>${p(r.atcRate, 2)}</td><td>${esc(r.strategy)}</td></tr>`,
  );
  const countryRows = (report.countries || []).map(
    (r) =>
      `<tr><td>${esc(String(r.country).toUpperCase())}</td><td>${n(r.clicks)}</td><td>${n(r.impressions)}</td><td>${p(r.ctr, 2)}</td><td>${Number(r.position).toFixed(1)}</td><td>${esc(r.strategy)}</td></tr>`,
  );
  const deviceRows = (report.devices || []).map(
    (r) =>
      `<tr><td>${esc(r.device)}</td><td>${n(r.clicks)}</td><td>${p(r.ctr, 2)}</td><td>${esc(r.strategy)}</td></tr>`,
  );
  const countryDeviceRows = (report.countryDevices || []).map(
    (r) =>
      `<tr><td>${esc(String(r.country).toUpperCase())}</td><td>${esc(r.device)}</td><td>${n(r.clicks)}</td><td>${n(r.impressions)}</td><td>${p(r.ctr, 2)}</td><td>${Number(r.position).toFixed(1)}</td><td>${esc(r.strategy)}</td></tr>`,
  );
  const countryQueryRows = (report.countryQueries || []).map(
    (r) =>
      `<tr><td><strong>${esc(r.countryLabel || String(r.country).toUpperCase())}</strong><small>${esc(r.intent || r.type)}</small></td><td><strong>${esc(r.query)}</strong><small>${esc(r.evidence || `${n(r.impressions)} 曝光，CTR ${p(r.ctr, 2)}，排名 ${Number(r.position).toFixed(1)}`)}</small></td><td><code>${esc(r.targetPage || "待识别")}</code></td><td>${esc(r.diagnosis || r.type)}</td><td>${stepList(r.steps, r.action)}<small><strong>验收：</strong>${esc(r.target || "观察 CTR 与排名变化。")}</small></td></tr>`,
  );
  const seoRoadmapRows = (report.seoRoadmap || []).map(
    (r) =>
      `<tr><td><span class="priority ${String(r.priority || "P2").toLowerCase()}">${esc(r.priority || "P2")}</span></td><td><strong>${esc(r.title)}</strong><small>${esc(r.evidence)}</small></td><td><code>${esc(r.page || "待识别")}</code></td><td>${esc(r.diagnosis)}</td><td>${stepList(r.steps)}<small><strong>验收：</strong>${esc(r.target)}</small></td></tr>`,
  );
  const actionRows = report.actions.map(
    (r) =>
      `<tr><td>${esc(r.phase)}</td><td><span class="priority ${r.priority.toLowerCase()}">${r.priority}</span></td><td>${esc(r.action)}</td><td>${esc(r.owner)}</td><td>${esc(r.outcome)}</td></tr>`,
  );
  const legacyNotice = Number(report.version || 1) < 4
    ? `<div class="flash success"><strong>这是一份升级前生成的历史报告。</strong><p>国家、语言和交叉维度不会自动回填。点击下面的按钮会重新读取 GA4 与 GSC，并生成一份新版报告。</p><form class="page-actions" method="post" action="/sites/${row.site_id}/sync"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="primary"><i data-lucide="refresh-cw"></i>立即同步生成新版报告</button></form></div>`
    : "";
  const tabs = `<div class="tabs" data-tabs><button class="active" data-tab="overview">运营总览</button><button data-tab="pages">页面优化</button><button data-tab="seo">SEO 机会</button><button data-tab="markets">国家与语言</button><button data-tab="tracking">追踪与计划</button></div>`;
  const content =
    head(
      report.site.name,
      "数据周期 " + report.period.start + " 至 " + report.period.end,
      `<a class="button secondary" href="/sites/${row.site_id}"><i data-lucide="history"></i>历史报告</a><button class="button primary" onclick="window.print()"><i data-lucide="printer"></i>打印 / PDF</button>`,
    ) +
    `<div class="boundary"><i data-lucide="info"></i>${esc(report.boundary)}</div>${legacyNotice}${tabs}<section data-panel="overview"><div class="kpi-grid">${cards}</div><section class="report-section"><h2>运营结论</h2><ol class="conclusions">${report.conclusions.map((c) => "<li>" + esc(c) + "</li>").join("")}</ol></section><section class="report-section"><h2>渠道诊断</h2>${table(["渠道", "会话", "流量占比", "加购率"], channelRows)}</section></section><section data-panel="pages" hidden><section class="report-section"><h2>页面优化优先级</h2><p>优先处理有规模流量但加购率低于站点平均的页面。每项均提供数据依据、执行步骤和验收目标。</p>${pageRows.length ? table(["优先级", "页面与依据", "会话", "加购率", "运营诊断", "具体执行与验收"], pageRows) : empty("badge-check", "当前没有高风险页面", "继续监控流量最大的落地页。")}</section></section><section data-panel="seo" hidden>${seoRoadmapRows.length ? `<section class="report-section"><h2>SEO 优先执行清单</h2><p>按预期影响排序，负责人应先完成 P1，再推进 P2。目标基于 GSC 排名、曝光、CTR 与 GA4 页面/市场行为，不代表订单或收入承诺。</p>${table(["优先级", "任务与依据", "目标页面", "诊断", "执行步骤与验收"], seoRoadmapRows)}</section>` : ""}<section class="report-section"><h2>全站 SEO 机会</h2>${queryRows.length ? table(["查询", "曝光", "点击", "CTR", "排名", "优化动作"], queryRows) : empty("search-check", "当前没有明显机会词", "扩大日期范围后再次分析。")}</section>${countryQueryRows.length ? `<section class="report-section"><h2>国家 × 搜索词详细方案</h2><p>每一行都根据该国家的搜索表现、实际排名页和 GA4 市场行为单独生成，不再使用统一模板。</p>${table(["市场与意图", "关键词与数据依据", "当前排名页", "运营诊断", "具体执行与验收"], countryQueryRows)}</section>` : ""}</section><section data-panel="markets" hidden><section class="report-section"><h2>GA4 国家运营优先级</h2><p>同时比较市场规模、互动率和加购率；“扩量”代表行为质量较好，不代表真实订单或利润。</p>${marketCountryRows.length ? table(["国家与建议", "会话", "占比", "互动率", "加购率", "运营标签"], marketCountryRows) : empty("globe-2", "历史报告暂无 GA4 国家细分", "重新同步网站后即可生成国家行为分析。")}</section><section class="report-section"><h2>浏览器语言表现</h2><p>浏览器语言反映用户偏好，用于判断页面翻译、语言导航和 hreflang 的优先级。</p>${languageRows.length ? table(["语言与建议", "会话", "占比", "互动率", "加购率", "运营标签"], languageRows) : empty("languages", "历史报告暂无语言细分", "重新同步网站后即可生成语言分析。")}</section><section class="report-section"><h2>国家 × 语言</h2>${countryLanguageRows.length ? table(["国家", "语言", "会话", "国家内占比", "互动率", "加购率", "判断"], countryLanguageRows) : empty("languages", "暂无国家与语言组合", "数据量增加后会自动显示主要组合。")}</section><section class="report-section"><h2>国家 × 渠道</h2>${countryChannelRows.length ? table(["国家", "渠道", "会话", "国家内占比", "互动率", "加购率", "动作"], countryChannelRows) : empty("split", "暂无国家与渠道组合", "重新同步后会分析每个市场的流量来源质量。")}</section><section class="report-section"><h2>GSC 国家搜索需求</h2>${countryRows.length ? table(["国家", "点击", "曝光", "CTR", "排名", "策略"], countryRows) : empty("search", "暂无国家搜索数据", "检查 GSC 资源权限或扩大日期范围。")}</section><section class="report-section"><h2>国家 × 设备 SEO</h2><p class="insight">${esc(report.marketInsight)}</p>${countryDeviceRows.length ? table(["国家", "设备", "点击", "曝光", "CTR", "排名", "策略"], countryDeviceRows) : table(["设备", "点击", "CTR", "策略"], deviceRows)}</section></section><section data-panel="tracking" hidden><section class="report-section"><h2>GA4 追踪优化</h2><div class="tracking-status"><span>当前状态</span><strong>${esc(report.tracking.status)}</strong><div><b>add_to_cart ${n(report.tracking.addToCarts)}</b><b>begin_checkout ${n(report.tracking.checkouts)}</b><b>purchase ${n(report.tracking.purchases)}</b></div></div><ul class="check-list">${report.tracking.recommendations.map((r) => "<li>" + esc(r) + "</li>").join("")}</ul></section><section class="report-section"><h2>7 / 30 / 90 天执行计划</h2>${table(["阶段", "优先级", "动作", "负责人", "预期结果"], actionRows)}</section><section class="report-section"><h2>每周复盘指标</h2><div class="metric-list">${report.weeklyKpis.map((r, i) => `<div><span>${String(i + 1).padStart(2, "0")}</span>${esc(r)}</div>`).join("")}</div></section></section>`;
  res.send(layout(req, report.site.name + " 运营报告", content, "dashboard"));
});

const TASK_STATUS = {
  todo: "待执行",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
  paused: "暂缓",
};

app.get("/tasks", requireAuth, async (req, res) => {
  const status = Object.hasOwn(TASK_STATUS, req.query.status) ? req.query.status : "";
  const siteId = Number(req.query.site_id || 0) || "";
  const [tasks, sites, members, summary] = await Promise.all([
    data.listTasks(req.user.tenant_id, { status, siteId }),
    data.listSites(req.user.tenant_id),
    data.listMembers(req.user.tenant_id),
    data.taskSummary(req.user.tenant_id),
  ]);
  const options = (values, selected, valueKey, labelKey) => values.map((item) => {
    const value = String(item[valueKey]);
    return `<option value="${esc(value)}"${String(selected) === value ? " selected" : ""}>${esc(item[labelKey])}</option>`;
  }).join("");
  const filters = `<form class="filter-bar" method="get" action="/tasks"><label>状态<select name="status"><option value="">全部状态</option>${Object.entries(TASK_STATUS).map(([value, label]) => `<option value="${value}"${status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>网站<select name="site_id"><option value="">全部网站</option>${options(sites, siteId, "id", "name")}</select></label><button class="secondary">筛选</button><a class="button" href="/tasks">重置</a></form>`;
  const taskRows = tasks.map((task) => {
    const assigneeOptions = `<option value="">未分配</option>${options(members, task.assignee_user_id || "", "id", "name")}`;
    const statusOptions = Object.entries(TASK_STATUS).map(([value, label]) => `<option value="${value}"${task.status === value ? " selected" : ""}>${label}</option>`).join("");
    return `<tr><td><span class="priority ${String(task.priority).toLowerCase()}">${esc(task.priority)}</span></td><td><strong>${esc(task.title)}</strong><small>${esc(task.site_name)}${task.query ? ` · ${esc(task.query)}` : ""}</small>${task.target_url ? `<a class="task-url" href="${esc(task.target_url)}" target="_blank" rel="noopener">${esc(task.target_url)}</a>` : ""}</td><td><small>${esc(task.evidence || "-")}</small></td><td><form method="post" action="/tasks/${task.id}" class="task-update"><input type="hidden" name="_csrf" value="${req.session.csrf}"><select name="assignee_user_id">${assigneeOptions}</select><select name="status">${statusOptions}</select><input type="date" name="due_date" value="${esc(task.due_date || "")}"><textarea name="result_note" placeholder="执行记录或验收结论">${esc(task.result_note || "")}</textarea><button class="primary compact">保存</button></form></td></tr>`;
  });
  const summaryCards = [["待执行", summary.todo || 0], ["进行中", summary.doing || 0], ["待验收", summary.review || 0], ["已完成", summary.done || 0]].map(([label, value]) => `<div><span>${label}</span><strong>${n(value)}</strong></div>`).join("");
  const content = head("SEO 任务中心", "把报告建议转化为可分配、可执行、可验收的团队任务。") + `<section class="summary-strip task-summary">${summaryCards}</section>${filters}<section class="table-section"><div class="section-title"><h2>任务列表</h2><span>${tasks.length} 项</span></div>${taskRows.length ? table(["优先级", "任务", "数据依据", "负责人、状态与验收"], taskRows) : empty("list-checks", "当前筛选下没有任务", "在新版报告的 SEO 优先清单中点击“创建任务”。")}</section>`;
  res.send(layout(req, "SEO 任务", content, "tasks"));
});

app.post("/tasks", requireAuth, async (req, res) => {
  const site = await data.getSite(req.user.tenant_id, req.body.site_id);
  if (!site) return errorPage(req, 404, "网站不存在", "当前工作区没有这个网站。");
  const title = String(req.body.title || "").trim();
  if (!title) return errorPage(req, 400, "任务信息不完整", "任务标题不能为空。");
  const requestedReportId = Number(req.body.report_id || 0) || null;
  if (requestedReportId) {
    const report = await data.getReport(req.user.tenant_id, requestedReportId);
    if (!report || Number(report.site_id) !== Number(site.id))
      return errorPage(req, 400, "报告关联无效", "任务只能关联当前工作区内该网站的报告。");
  }
  const targetValue = String(req.body.target_url || "").trim();
  let targetUrl = targetValue;
  try {
    targetUrl = targetValue ? new URL(targetValue, site.website_url).href : "";
  } catch {
    targetUrl = targetValue;
  }
  const taskId = await data.createTask({
    tenant_id: req.user.tenant_id,
    site_id: site.id,
    report_id: requestedReportId,
    created_by_user_id: req.user.id,
    priority: ["P1", "P2", "P3"].includes(req.body.priority) ? req.body.priority : "P2",
    status: "todo",
    title,
    target_url: targetUrl,
    query: String(req.body.query || "").trim(),
    country: String(req.body.country || "").trim(),
    evidence: String(req.body.evidence || "").trim(),
    action: String(req.body.action || "").trim(),
    target: String(req.body.target || "").trim(),
    baseline_json: String(req.body.baseline_json || "").trim(),
  });
  flash(req, "success", `SEO 任务 #${taskId} 已创建。`);
  res.redirect("/tasks");
});

app.post("/tasks/:id", requireAuth, async (req, res) => {
  const task = await data.getTask(req.user.tenant_id, req.params.id);
  if (!task) return errorPage(req, 404, "任务不存在", "当前工作区没有这个任务。");
  const status = Object.hasOwn(TASK_STATUS, req.body.status) ? req.body.status : task.status;
  const assigneeId = Number(req.body.assignee_user_id || 0) || null;
  if (assigneeId) {
    const members = await data.listMembers(req.user.tenant_id);
    if (!members.some((member) => member.id === assigneeId))
      return errorPage(req, 400, "负责人无效", "负责人不属于当前工作区。");
  }
  await data.updateTask(req.user.tenant_id, task.id, {
    status,
    assignee_user_id: assigneeId,
    due_date: String(req.body.due_date || "").trim() || null,
    result_note: String(req.body.result_note || "").trim(),
    completed_at: status === "done" ? data.db.fn.now() : null,
  });
  flash(req, "success", "任务状态已更新。");
  res.redirect("/tasks");
});

app.get("/team", requireAuth, async (req, res) => {
  const members = await data.listMembers(req.user.tenant_id);
  const rows = members.map(
    (m) =>
      `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(m.email)}</td><td>${m.role === "owner" ? "所有者" : m.role === "admin" ? "管理员" : "成员"}</td><td>${esc(m.created_at)}</td></tr>`,
  );
  const add = ["owner", "admin"].includes(req.user.role)
    ? `<section class="form-section"><div class="section-title"><h2>添加成员</h2><span>成员将进入当前工作区</span></div><form method="post" action="/team" class="inline-form"><input type="hidden" name="_csrf" value="${req.session.csrf}"><label>姓名<input name="name" required></label><label>邮箱<input type="email" name="email" required></label><label>初始密码<input type="password" name="password" minlength="8" required></label><button class="primary">添加</button></form></section>`
    : "";
  res.send(
    layout(
      req,
      "成员",
      head("团队成员", "同一工作区内共享网站和报告，其他租户无法访问。") +
        `<section class="table-section">${table(["姓名", "邮箱", "角色", "加入时间"], rows)}</section>${add}`,
      "team",
    ),
  );
});
app.post("/team", requireAuth, async (req, res) => {
  if (!["owner", "admin"].includes(req.user.role))
    return errorPage(req, 403, "没有权限", "只有所有者和管理员可以添加成员。");
  const name = String(req.body.name || "").trim(),
    email = String(req.body.email || "")
      .trim()
      .toLowerCase(),
    password = String(req.body.password || "");
  if (!name || !email || password.length < 8) {
    flash(req, "error", "信息不完整或密码少于 8 位。");
    return res.redirect("/team");
  }
  try {
    await data.addMember({
      tenant_id: req.user.tenant_id,
      name,
      email,
      password_hash: bcrypt.hashSync(password, 12),
      role: "member",
    });
    flash(req, "success", "成员已添加。");
  } catch (error) {
    flash(req, "error", "添加失败，该邮箱可能已经注册。");
  }
  res.redirect("/team");
});
app.use((req, res) =>
  errorPage(req, 404, "页面不存在", "没有找到你访问的页面。"),
);
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res
    .status(500)
    .send(
      layout(
        req,
        "系统错误",
        empty(
          "circle-alert",
          "系统暂时无法处理请求",
          isProduction ? "请稍后重试。" : error.message,
        ),
      ),
    );
});
async function start() {
  await ensureInitialized();
  app.listen(config.port, config.host, () =>
    console.log("SearchOps Hub running at " + config.appBaseUrl),
  );
}
if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = app;
