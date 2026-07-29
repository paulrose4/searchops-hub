function rows(value) { return Array.isArray(value) ? value : []; }
function ratio(part, total) { return Number(total || 0) ? Number(part || 0) / Number(total) : 0; }
function clamp(value) { return Math.max(0, Math.min(100, Math.round(Number(value || 0)))); }

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch { return String(value || ""); }
}

function samePage(a, b) {
  const left = normalizeUrl(a), right = normalizeUrl(b);
  if (left === right) return true;
  try {
    const x = new URL(left), y = new URL(right);
    return x.pathname === y.pathname && x.search === y.search;
  } catch { return false; }
}

function localeOf(audit, url) {
  const language = String(audit.htmlLang || "").toLowerCase().split("-")[0];
  if (language) return language;
  try { return new URL(url).pathname.match(/^\/([a-z]{2})(?:[-_/]|$)/i)?.[1]?.toLowerCase() || "en"; }
  catch { return "en"; }
}

function pageType(audit, url) {
  const pathname = new URL(url).pathname.toLowerCase();
  const types = rows(audit.structuredDataTypes).join(" ").toLowerCase();
  if (pathname === "/") return "homepage";
  if (/article|blogposting|newsarticle/.test(types) || /\/(blog|blogs|guide|guides|news|article)\//.test(pathname)) return "article";
  if (/product/.test(types) || (audit.platform?.isWooCommerce && /\/product\//.test(pathname))) return "product";
  if (/itemlist|collectionpage/.test(types) || /\/(category|categories|collection|collections|shop)\//.test(pathname)) return "category";
  return "page";
}

function slugKeyword(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.(?:html?|php)$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

function titleCase(value) {
  const text = String(value || "").trim();
  if (!/^[a-z0-9 '-]+$/i.test(text)) return text;
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function shorten(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sliced = text.slice(0, max - 1);
  const boundary = sliced.lastIndexOf(" ");
  return (boundary > max * 0.65 ? sliced.slice(0, boundary) : sliced).trim() + "…";
}

function brandName(site) {
  return String(site.brand_terms || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean)[0]
    || String(site.name || "Brand").replace(/正式站|官网|网站/g, "").trim();
}

function descriptionTemplate(locale, keyword, type) {
  const guide = type === "article";
  const templates = {
    en: guide ? "Learn about {keyword} with practical guidance, comparisons, key considerations and clear next steps for making an informed choice." : "Explore {keyword} with clear specifications, comparisons, delivery information and practical guidance to choose the right option.",
    es: guide ? "Descubre {keyword} con una guía práctica, comparativas, aspectos clave y pasos claros para tomar una decisión informada." : "Descubre {keyword} con especificaciones, comparativas, información de entrega y consejos prácticos para elegir la opción adecuada.",
    de: guide ? "Erfahren Sie mehr über {keyword}: praktische Hinweise, Vergleiche, wichtige Auswahlkriterien und klare nächste Schritte." : "Entdecken Sie {keyword} mit Spezifikationen, Vergleichen, Lieferinformationen und praktischen Hinweisen für die passende Auswahl.",
    fr: guide ? "Découvrez {keyword} grâce à un guide pratique, des comparatifs, les critères essentiels et des étapes claires pour bien choisir." : "Découvrez {keyword} avec caractéristiques, comparatifs, informations de livraison et conseils pratiques pour faire le bon choix.",
    it: "Scopri {keyword} con specifiche chiare, confronti, informazioni sulla consegna e consigli pratici per scegliere l'opzione più adatta.",
    pt: "Conheça {keyword} com especificações, comparações, informações de entrega e orientações práticas para escolher a opção certa.",
    ru: "Узнайте больше о {keyword}: характеристики, сравнения, информация о доставке и практические рекомендации по выбору.",
    vi: "Tìm hiểu {keyword} với thông số rõ ràng, nội dung so sánh, thông tin giao hàng và hướng dẫn thực tế để lựa chọn phù hợp.",
    th: "สำรวจ {keyword} พร้อมข้อมูลสเปก การเปรียบเทียบ การจัดส่ง และคำแนะนำที่ชัดเจนเพื่อช่วยให้เลือกได้เหมาะสม",
    ar: "تعرّف على {keyword} من خلال المواصفات والمقارنات ومعلومات الشحن والإرشادات العملية لاختيار الخيار المناسب.",
    ja: "{keyword}について、仕様、比較、配送情報、選び方のポイントを分かりやすく紹介します。",
    ko: "{keyword}의 주요 사양, 비교 정보, 배송 안내와 실용적인 선택 기준을 확인하세요.",
    zh: "了解{keyword}的核心规格、对比信息、配送说明与实用选择建议，快速找到适合自己的方案。",
  };
  return (templates[locale] || templates.en).replace("{keyword}", keyword);
}

function expectedCtr(position) {
  const rank = Number(position || 0);
  if (!rank) return 0;
  if (rank <= 3) return 0.08;
  if (rank <= 5) return 0.05;
  if (rank <= 10) return 0.03;
  if (rank <= 20) return 0.015;
  return 0.008;
}

function queryContext(snapshot, url) {
  const queryPages = rows(snapshot.current?.gsc?.queryPages);
  const matching = queryPages.filter((row) => samePage(row.page, url));
  const queryMap = new Map();
  for (const row of matching) {
    const key = String(row.query || "").trim();
    if (!key) continue;
    const current = queryMap.get(key) || { query: key, clicks: 0, impressions: 0, positionWeight: 0 };
    current.clicks += Number(row.clicks || 0);
    current.impressions += Number(row.impressions || 0);
    current.positionWeight += Number(row.position || 0) * Number(row.impressions || 0);
    queryMap.set(key, current);
  }
  const queries = [...queryMap.values()].map((item) => ({
    query: item.query,
    clicks: item.clicks,
    impressions: item.impressions,
    ctr: ratio(item.clicks, item.impressions),
    position: item.impressions ? item.positionWeight / item.impressions : 0,
  })).sort((a, b) => b.impressions - a.impressions).slice(0, 12);
  const related = new Map();
  for (const query of queries.slice(0, 5)) {
    const competitors = queryPages.filter((row) => row.query === query.query && !samePage(row.page, url))
      .sort((a, b) => Number(b.impressions || 0) - Number(a.impressions || 0)).slice(0, 3);
    for (const row of competitors) {
      const key = normalizeUrl(row.page);
      if (!related.has(key)) related.set(key, { query: query.query, page: row.page, impressions: row.impressions, clicks: row.clicks });
    }
  }
  return { queries, cannibalization: [...related.values()].slice(0, 8) };
}

function wordpressInstructions(audit, type) {
  const plugin = audit.platform?.seoPlugins?.[0];
  const builder = audit.platform?.builders?.[0];
  let editor = "进入 WordPress 后台的页面/文章编辑器，在 Gutenberg 中修改标题、正文、图片 ALT 和内链。";
  if (builder === "Elementor") editor = "进入 WordPress 后台并点击“使用 Elementor 编辑”；正文结构在 Elementor 修改，SEO 字段仍在 SEO 插件面板修改。";
  if (builder === "WPBakery") editor = "进入对应页面的 WPBakery 编辑器，按模块调整 H1、正文、图片 ALT 和内链。";
  let seo = "在页面编辑页底部或右侧的 SEO 面板填写 SEO Title、Meta Description、Canonical 和社交分享字段。";
  if (plugin === "Yoast SEO") seo = "在 Yoast SEO 的“Google 预览”填写 SEO 标题和元描述；在“高级”核对 canonical 与 robots；在“Schema”选择页面类型。";
  if (plugin === "Rank Math") seo = "在 Rank Math“常规”编辑标题和描述，在“高级”核对 Robots 与 Canonical，在“Schema”配置结构化数据。";
  if (plugin === "AIOSEO") seo = "在 AIOSEO“常规”修改搜索外观，在“高级”核对 canonical/robots，并在 Schema 设置中选择页面类型。";
  let location = editor;
  if (audit.platform?.isWooCommerce && type === "product") location = "进入“产品 → 所有产品”编辑商品，修改商品名称、简短描述、完整描述、分类、属性、图片 ALT 和 Product Schema。";
  if (audit.platform?.isWooCommerce && type === "category") location = "进入“产品 → 分类”编辑分类名称、描述和缩略图；模板内容通过主题或页面构建器修改。";
  return { plugin: plugin || "未识别", builder: builder || "WordPress 编辑器", steps: [location, seo] };
}

function issue(severity, category, title, evidence, impact, fix, acceptance) {
  return { severity, category, title, evidence, impact, fix, acceptance };
}

function optimizePage({ page, snapshot, site, audit }) {
  const type = pageType(audit, page.url);
  const locale = localeOf(audit, page.url);
  const queryData = queryContext(snapshot, page.url);
  const fallbackKeyword = slugKeyword(page.url) || audit.h1s?.[0] || audit.title || site.name;
  const primaryKeyword = queryData.queries[0]?.query || fallbackKeyword;
  const secondaryKeywords = queryData.queries.slice(1, 8).map((item) => item.query);
  const proposedH1 = titleCase(primaryKeyword);
  const proposedTitle = shorten(proposedH1 + " | " + brandName(site), 60);
  const proposedDescription = shorten(descriptionTemplate(locale, primaryKeyword, type), 160);
  const targetWords = type === "article" ? 1400 : type === "category" ? 800 : type === "product" ? 600 : 500;
  const lowerKeyword = primaryKeyword.toLowerCase();
  const queryInTitle = String(audit.title || "").toLowerCase().includes(lowerKeyword);
  const queryInH1 = rows(audit.h1s).some((value) => value.toLowerCase().includes(lowerKeyword));
  const queryInDescription = String(audit.description || "").toLowerCase().includes(lowerKeyword);
  const issues = [];

  if (!audit.status || audit.status >= 400) issues.push(issue("P1", "可访问性", "页面无法稳定抓取", "实时抓取状态：" + (audit.status || "失败"), "搜索引擎和用户可能无法访问页面。", "先修复服务器状态、重定向链或安全拦截，再进行内容优化。", "公开访问返回 HTTP 200，且最终 URL 保持在绑定域名内。"));
  if (/noindex/i.test(audit.robots || "")) issues.push(issue("P1", "索引", "页面被设置为 noindex", "robots：" + audit.robots, "页面不会进入正常自然搜索竞争。", "确认该页是否应收录；需要收录时在 SEO 插件高级设置中改为 index,follow。", "源代码不再输出 noindex，GSC URL 检查允许编入索引。"));
  if (!audit.canonical) issues.push(issue("P1", "技术 SEO", "缺少 canonical", "页面未检测到 rel=canonical。", "参数页、重复路径和语言版本可能分散信号。", "在 SEO 插件中设置自引用 canonical；若该页是重复页则指向唯一主版本。", "源代码存在唯一且可访问的 canonical。"));
  if (!audit.title || audit.titleLength < 20 || audit.titleLength > 60 || !queryInTitle) issues.push(issue("P1", "搜索摘要", "Title 与目标搜索词不够匹配", "当前 Title：" + (audit.title || "缺失") + "；长度 " + (audit.titleLength || 0) + "；主查询：" + primaryKeyword, "会影响相关性判断和搜索结果点击率。", "建议改为：" + proposedTitle, "Title 约 30–60 字符，包含主查询且每个页面保持唯一。"));
  if (!audit.description || audit.descriptionLength < 70 || audit.descriptionLength > 160 || !queryInDescription) issues.push(issue("P1", "搜索摘要", "Meta Description 缺失或意图承接不足", "当前描述：" + (audit.description || "缺失") + "；长度 " + (audit.descriptionLength || 0), "搜索摘要可能被随机截取，无法清晰传达页面价值。", "建议改为：" + proposedDescription, "描述约 110–160 字符，包含主查询、页面价值和真实可兑现的信息。"));
  if (rows(audit.h1s).length !== 1 || !queryInH1) issues.push(issue("P1", "内容结构", "H1 数量或主题不正确", "当前 H1：" + (rows(audit.h1s).join("；") || "缺失"), "主主题不明确，会削弱页面内容层级。", "页面只保留一个 H1，建议为：" + proposedH1, "源代码仅有一个 H1，并与 Title、主查询保持同一搜索意图。"));
  if (Number(audit.wordCount || 0) < targetWords * 0.6) issues.push(issue("P2", "内容深度", "正文覆盖不足", "检测到约 " + (audit.wordCount || 0) + " 词；该类型建议覆盖约 " + targetWords + " 词的有效内容。", "难以完整回答查询，也缺少容纳相关搜索词和内部链接的空间。", "补充选择标准、规格/对比、使用场景、配送与售后、FAQ，并避免堆砌关键词。", "正文达到建议规模，至少包含 4 个有明确主题的 H2。"));
  const h2Count = rows(audit.headings).filter((item) => item.level === 2).length;
  if (h2Count < 3) issues.push(issue("P2", "内容结构", "H2 主题层级不足", "当前 H2 数量：" + h2Count, "页面不利于扫描，也难以覆盖多个子意图。", "围绕高曝光次级查询建立 3–6 个 H2，每个 H2 下提供直接答案、证据和相关链接。", "H1 后按 H2/H3 顺序组织，无跳级和空标题。"));
  if (Number(audit.missingAltImages || 0) > 0) issues.push(issue("P2", "图片 SEO", "图片缺少 ALT", "共 " + (audit.imageCount || 0) + " 张图片，其中 " + audit.missingAltImages + " 张没有 ALT 属性。", "影响图片搜索、无障碍和页面语义理解。", "在 WordPress 媒体库或页面编辑器中为内容图片填写描述性 ALT；装饰图使用空 ALT。", "所有内容图片具备准确且不堆砌关键词的 ALT。"));
  if (Number(audit.internalLinkCount || 0) < 5) issues.push(issue("P2", "内部链接", "页面内部链接不足", "检测到 " + (audit.internalLinkCount || 0) + " 个站内目标。", "页面主题关系和权重传递不足，用户下一步路径不清晰。", "从正文加入 3–5 个相关分类、商品或指南链接，并从相关高权重页面反向链接到本页。", "新增链接使用描述性锚文本，目标返回 200 且与当前主题相关。"));
  const schemaTypes = rows(audit.structuredDataTypes);
  if (type === "product" && !schemaTypes.some((value) => /product/i.test(value))) issues.push(issue("P1", "Schema", "商品页缺少 Product Schema", "当前结构化数据：" + (schemaTypes.join("、") || "无"), "可能失去商品富媒体结果资格。", "使用 WooCommerce/SEO 插件输出 Product、Offer、BreadcrumbList；价格、库存和币种必须与页面可见内容一致。", "Rich Results Test 无严重错误，Schema 与页面可见信息一致。"));
  if (type === "article" && !schemaTypes.some((value) => /article|blogposting/i.test(value))) issues.push(issue("P2", "Schema", "文章页缺少 Article Schema", "当前结构化数据：" + (schemaTypes.join("、") || "无"), "文章作者、发布日期和内容类型信号不完整。", "在 SEO 插件 Schema 中选择 Article/BlogPosting，并补齐作者、发布日期、修改日期和主图。", "Schema 验证通过，作者和日期在页面中可见。"));
  if (locale !== "en" && !rows(audit.hreflangs).length) issues.push(issue("P1", "国际 SEO", "本地化页面缺少 hreflang", "页面语言：" + (audit.htmlLang || locale) + "；未检测到 hreflang。", "Google 可能无法稳定选择正确语言/国家版本。", "通过多语言插件或主题输出所有对应语言、自引用版本和 x-default，并确保互相回链。", "每个语言版本的 hreflang 成组、双向、返回 200 且 canonical 指向自身。"));
  const expected = expectedCtr(page.gsc_position);
  if (page.gsc_impressions >= 100 && expected && Number(page.gsc_ctr || 0) < expected * 0.7) issues.push(issue("P1", "CTR", "搜索曝光未有效转化为点击", "曝光 " + page.gsc_impressions + "，CTR " + (Number(page.gsc_ctr || 0) * 100).toFixed(2) + "% ，平均排名 " + Number(page.gsc_position || 0).toFixed(1) + "。", "现有标题和描述可能没有匹配搜索意图或缺少差异化价值。", "使用建议 Title/Description，并对照排名最高的主查询检查搜索结果承诺；发布后按 28 天复盘。", "同等排名区间下 CTR 提升，且点击增长不是由品牌词波动单独造成。"));

  const technicalScore = clamp(100 - issues.filter((item) => ["可访问性", "索引", "技术 SEO", "Schema", "国际 SEO"].includes(item.category)).reduce((sum, item) => sum + (item.severity === "P1" ? 18 : 9), 0));
  const contentScore = clamp(100 - issues.filter((item) => ["内容深度", "内容结构", "图片 SEO", "内部链接"].includes(item.category)).reduce((sum, item) => sum + (item.severity === "P1" ? 20 : 10), 0));
  const serpRatio = expected ? Number(page.gsc_ctr || 0) / expected : page.gsc_impressions ? 0.5 : 0.65;
  const serpScore = clamp(serpRatio * 80 + (queryInTitle ? 10 : 0) + (queryInDescription ? 10 : 0));
  const trustSignals = ["shipping", "payment", "returns", "privacy", "cta"].filter((key) => audit.signals?.[key]).length;
  const behaviorBase = page.sessions >= 20 ? Math.min(1, Number(page.add_to_cart_density || 0) / 0.02) : 0.55;
  const conversionScore = clamp(behaviorBase * 55 + trustSignals * 9);
  const localizationScore = clamp((audit.htmlLang ? 30 : 0) + (locale === "en" || rows(audit.hreflangs).length ? 45 : 0) + (audit.canonical ? 25 : 0));
  const overall = clamp(technicalScore * 0.3 + contentScore * 0.25 + serpScore * 0.2 + conversionScore * 0.15 + localizationScore * 0.1);
  const wordpress = wordpressInstructions(audit, type);
  const outlineQueries = [...secondaryKeywords, ...queryData.queries.slice(0, 4).map((item) => item.query)].filter((value, index, list) => value && list.indexOf(value) === index).slice(0, 6);
  const outline = outlineQueries.length >= 3 ? outlineQueries.map((query, index) => ({ heading: titleCase(query), purpose: index === 0 ? "直接回答核心子意图并给出选择标准" : "覆盖相关搜索需求，加入事实、对比和内部链接" })) : [
    { heading: "核心选择标准与适用场景", purpose: "说明用户如何判断是否适合，避免只写泛泛产品描述" },
    { heading: "规格、材质或方案对比", purpose: "用表格或清单呈现差异，帮助决策" },
    { heading: "配送、支付、隐私与售后", purpose: "解决购买阻力，并只写网站真实政策" },
    { heading: "常见问题", purpose: "回答 4–6 个真实搜索问题，可配置 FAQ Schema" },
  ];
  const summary = issues.length ? "该页当前综合评分 " + overall + "/100。优先修复 " + issues.filter((item) => item.severity === "P1").length + " 个 P1 问题，再补齐内容与 WordPress 技术设置。" : "该页基础 SEO 状态较完整，综合评分 " + overall + "/100；下一步重点是围绕真实查询扩展内容并持续验证 CTR 和页面行为。";
  const actionPlan = issues.slice().sort((a, b) => (a.severity === "P1" ? 0 : 1) - (b.severity === "P1" ? 0 : 1)).slice(0, 10).map((item, index) => ({ order: index + 1, priority: item.severity, action: item.fix, wordpressPath: index < 2 ? wordpress.steps[index] : wordpress.steps[0], acceptance: item.acceptance }));
  const schema = type === "product" ? ["Product", "Offer", "BreadcrumbList"] : type === "article" ? ["Article/BlogPosting", "BreadcrumbList", "FAQPage（仅当 FAQ 可见）"] : type === "category" ? ["CollectionPage", "ItemList", "BreadcrumbList"] : ["WebPage", "BreadcrumbList"];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    url: page.url,
    pageType: type,
    locale,
    summary,
    scores: { overall, technical: technicalScore, content: contentScore, serp: serpScore, conversion: conversionScore, localization: localizationScore },
    metrics: { sessions: Number(page.sessions || 0), users: Number(page.users || 0), addToCarts: Number(page.add_to_carts || 0), addToCartDensity: Number(page.add_to_cart_density || 0), gscClicks: Number(page.gsc_clicks || 0), gscImpressions: Number(page.gsc_impressions || 0), gscCtr: Number(page.gsc_ctr || 0), gscPosition: Number(page.gsc_position || 0) },
    searchIntent: { primaryKeyword, secondaryKeywords, primaryQuery: queryData.queries[0] || null, queries: queryData.queries, cannibalization: queryData.cannibalization },
    currentPage: { status: audit.status || 0, finalUrl: audit.finalUrl, title: audit.title || "", description: audit.description || "", h1s: rows(audit.h1s), wordCount: audit.wordCount || 0, headings: rows(audit.headings), canonical: audit.canonical || "", robots: audit.robots || "", htmlLang: audit.htmlLang || "", imageCount: audit.imageCount || 0, missingAltImages: audit.missingAltImages || 0, internalLinkCount: audit.internalLinkCount || 0, structuredDataTypes: schemaTypes, signals: audit.signals || {} },
    platform: audit.platform || { isWordPress: false, seoPlugins: [], builders: [], isWooCommerce: false },
    issues,
    solution: { proposedTitle, proposedDescription, proposedH1, targetWordCount: targetWords, outline, internalLinks: queryData.cannibalization.slice(0, 5).map((item) => ({ target: item.page, anchor: item.query, reason: "与本页共享搜索查询，需明确主次关系并使用相关锚文本" })), schema, wordpress },
    actionPlan,
    validation: ["发布前检查页面返回 HTTP 200，canonical、robots、hreflang 与目标版本一致。", "使用 Google Rich Results Test 检查 Schema，无严重错误且字段与页面可见内容一致。", "发布后在 GSC URL 检查中请求重新编入索引，并记录发布日期。", "14 天检查收录、抓取和排名方向；28 天复盘点击、CTR、平均排名、GA4 会话和加购事件密度。"],
    boundary: "基于该页实时公开 HTML、当前报告 GA4/GSC 汇总指标和 GSC 查询页面数据生成；不包含订单、收入或广告数据，也不会自动修改 WordPress。",
  };
}

module.exports = { optimizePage, normalizeUrl, samePage };
