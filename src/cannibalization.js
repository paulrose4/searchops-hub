const crypto = require("node:crypto");

const VECTOR_SIZE = 384;
const LANGUAGE_QUERY_KEYS = new Set(["lang", "language", "locale", "hl"]);
const LANGUAGE_SEGMENTS = new Set([
  "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr",
  "he", "hi", "hu", "id", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt",
  "ro", "ru", "sk", "sv", "th", "tr", "uk", "ur", "vi", "zh", "zh-cn", "zh-tw",
]);
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "you", "are", "our",
  "www", "com", "html", "page", "home", "about", "more", "into", "have", "has", "was",
  "und", "der", "die", "das", "mit", "von", "pour", "les", "des", "une", "dans",
  "con", "para", "los", "las", "una", "del", "que", "como", "mais", "não", "uma",
  "的", "了", "和", "与", "及", "是", "在", "为", "或", "有", "这", "该", "我们",
]);

function compact(value, max = 12000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function urlHash(url) {
  return crypto.createHash("sha256").update(String(url || "")).digest("hex");
}

function normalizeLanguage(value) {
  return String(value || "").trim().toLowerCase().replace("_", "-").split("-")[0];
}

function detectLanguageFromText(value) {
  const text = compact(value, 5000);
  if (!text) return "en";
  const counts = {
    zh: (text.match(/[\u3400-\u9fff]/g) || []).length,
    ja: (text.match(/[\u3040-\u30ff]/g) || []).length,
    ko: (text.match(/[\uac00-\ud7af]/g) || []).length,
    ar: (text.match(/[\u0600-\u06ff]/g) || []).length,
    ru: (text.match(/[\u0400-\u04ff]/g) || []).length,
    hi: (text.match(/[\u0900-\u097f]/g) || []).length,
    th: (text.match(/[\u0e00-\u0e7f]/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best[1] >= 12) return best[0] === "ar" ? "ar" : best[0];
  const lower = ` ${text.toLowerCase()} `;
  const scores = {
    en: [" the ", " and ", " with ", " for ", " shop "],
    es: [" para ", " con ", " los ", " las ", " comprar "],
    fr: [" pour ", " avec ", " les ", " des ", " acheter "],
    de: [" und ", " mit ", " der ", " die ", " kaufen "],
    pt: [" para ", " com ", " não ", " uma ", " comprar "],
    vi: [" và ", " cho ", " với ", " của ", " mua "],
  };
  return Object.entries(scores)
    .map(([language, words]) => [language, words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0)])
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "en";
}

function detectMainLanguage(audit = {}) {
  return normalizeLanguage(audit.htmlLang) || detectLanguageFromText(
    [audit.title, audit.description, ...(audit.h1s || []), audit.mainTextExcerpt].join(" "),
  );
}

function translationUrlReason(value) {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (LANGUAGE_QUERY_KEYS.has(key.toLowerCase())) return `URL 包含翻译参数 ${key}`;
    }
    const first = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    if (LANGUAGE_SEGMENTS.has(first) || /^[a-z]{2}-[a-z]{2}$/i.test(first)) {
      return `URL 包含语言目录 /${first}/`;
    }
    return "";
  } catch {
    return "URL 无法解析";
  }
}

function tokenize(value) {
  const text = compact(value, 30000).toLowerCase();
  const words = text.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const tokens = [];
  for (const word of words) {
    if (/^[\u3400-\u9fff]+$/u.test(word)) {
      for (let index = 0; index < word.length - 1; index += 1) tokens.push(word.slice(index, index + 2));
    } else if (!STOP_WORDS.has(word) && !/^\d+$/.test(word)) tokens.push(word);
  }
  return tokens.slice(0, 12000);
}

function termCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function topTerms(tokens, limit = 20) {
  return [...termCounts(tokens).entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([term]) => term);
}

function hashIndex(token) {
  const digest = crypto.createHash("sha1").update(token).digest();
  return digest.readUInt32BE(0) % VECTOR_SIZE;
}

function vectorize(tokens, idf = new Map()) {
  const vector = Array(VECTOR_SIZE).fill(0);
  const counts = termCounts(tokens);
  for (const [token, count] of counts) {
    const weight = (1 + Math.log(count)) * (idf.get(token) || 1);
    vector[hashIndex(token)] += weight;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function cosine(a = [], b = []) {
  let score = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) score += Number(a[index] || 0) * Number(b[index] || 0);
  return Math.max(0, Math.min(1, score));
}

function overlap(a = [], b = []) {
  const left = new Set(a);
  const right = new Set(b);
  const shared = [...left].filter((value) => right.has(value)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

function classifyIntent(document) {
  const url = String(document.url || "").toLowerCase();
  const prominent = `${document.title} ${document.headings.slice(0, 8).join(" ")}`.toLowerCase();
  const body = String(document.bodyText || "").slice(0, 2500).toLowerCase();
  const scores = { "信息类": 0, "导航类": 0, "商业调查类": 0, "交易类": 0 };
  if (/\/(?:blog|guide|news|faq)(?:\/|$)/.test(url)) scores["信息类"] += 6;
  if (/how to|what is|why |教程|指南|怎么|如何|什么|知识|faq/.test(prominent)) scores["信息类"] += 4;
  if (/how to|what is|教程|指南|怎么|如何|知识/.test(body)) scores["信息类"] += 1;
  if (/\/(?:login|contact|about)(?:\/|$)/.test(url)) scores["导航类"] += 6;
  if (/login|contact|about us|官网|登录|联系我们|品牌故事/.test(prominent)) scores["导航类"] += 4;
  if (/\/(?:compare|comparison|reviews?)(?:\/|$)/.test(url)) scores["商业调查类"] += 6;
  if (/compare|comparison|review|best |top |对比|评测|推荐|哪种|哪个好/.test(prominent)) scores["商业调查类"] += 4;
  if (/compare|comparison|review|vergleich|test|bewertung|empfehlung|comparatif|avis|comparación|reseña|对比|评测|推荐/.test(body)) scores["商业调查类"] += 1;
  if (/\/(?:product|products|category|categories|shop|store)(?:\/|$)/.test(url)) scores["交易类"] += 7;
  if (/buy|price|sale|for sale|add to cart|kaufen|preis|angebot|warenkorb|produkt|kategorie|acheter|prix|panier|comprar|precio|carrito|产品|分类|购买|价格|报价|商城/.test(prominent)) scores["交易类"] += 4;
  if (/buy|price|sale|shop|category|add to cart|kaufen|preis|angebot|warenkorb|produkt|kategorie|acheter|prix|panier|comprar|precio|carrito|产品|分类|购买|价格|报价|商城/.test(body)) scores["交易类"] += 2;
  return Object.entries(scores).sort((a, b) => b[1] - a[1] || ["交易类", "商业调查类", "信息类", "导航类"].indexOf(a[0]) - ["交易类", "商业调查类", "信息类", "导航类"].indexOf(b[0]))[0][0];
}

function buildDocument({ page, audit }) {
  const headings = (audit.headings || []).map((item) => compact(item.text || item, 300)).filter(Boolean);
  const anchors = (audit.internalLinks || []).map((item) => compact(item.anchor, 160)).filter(Boolean);
  const alts = (audit.imageAlts || []).map((item) => compact(item, 160)).filter(Boolean);
  const combined = [page.url, audit.title, audit.description, ...(audit.h1s || []), ...headings, audit.mainTextExcerpt, ...anchors, ...alts].join(" ");
  const tokens = tokenize(combined);
  const entityTokens = tokenize([audit.title, ...(audit.h1s || []), ...headings.slice(0, 20)].join(" "));
  const document = {
    reportPageId: page.id,
    page: page.page,
    url: page.url,
    urlHash: urlHash(page.url),
    language: detectMainLanguage(audit),
    status: audit.status || 0,
    title: compact(audit.title, 500),
    description: compact(audit.description, 1000),
    headings,
    headingDetails: audit.headings || [],
    h1Count: (audit.h1s || []).length,
    canonical: audit.canonical || "",
    bodyText: compact(audit.mainTextExcerpt, 12000),
    internalLinks: audit.internalLinks || [],
    imageAlts: alts,
    missingAltImages: Number(audit.missingAltImages || 0),
    tokens,
    topKeywords: topTerms(tokens, 20),
    entities: topTerms(entityTokens, 20),
    wordCount: Number(audit.wordCount || 0),
    metrics: {
      clicks: Number(page.gsc_clicks || 0),
      impressions: Number(page.gsc_impressions || 0),
      sessions: Number(page.sessions || 0),
    },
  };
  document.intent = classifyIntent(document);
  document.vector = vectorize(tokens);
  return document;
}

function sanitizeSeoTitle(value) {
  return compact(value, 160)
    .replace(/[\p{P}\p{S}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70)
    .trim();
}

function pathParts(value) {
  try { return new URL(value).pathname.split("/").filter(Boolean); } catch { return []; }
}

function isParentChild(left, right) {
  const a = pathParts(left.url);
  const b = pathParts(right.url);
  if (!a.length || !b.length || Math.abs(a.length - b.length) !== 1) return false;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (!shorter.every((part, index) => part === longer[index])) return false;
  return true;
}

function preferredPage(left, right) {
  const score = (document) => document.metrics.clicks * 50 + document.metrics.impressions + document.metrics.sessions * 10 + document.wordCount;
  return score(left) >= score(right) ? left : right;
}

function recommendationTerms(document, peer) {
  const own = new Set(document.tokens);
  return topTerms(peer.tokens.filter((token) => !own.has(token)), 8);
}

function semanticSimilarity(left, right) {
  if (Array.isArray(left.embedding) && left.embedding.length && Array.isArray(right.embedding) && right.embedding.length) {
    return cosine(left.embedding, right.embedding);
  }
  return cosine(left.vector, right.vector);
}
function pageRecommendation(document, relatedPages, authorityPages) {
  const issues = [];
  if (!document.title) issues.push("缺少 SEO Title");
  else if (document.title.length > 70) issues.push("SEO Title 过长");
  if (!document.description) issues.push("缺少 Meta Description");
  else if (document.description.length < 60) issues.push("Meta Description 信息不足");
  if (!document.h1Count) issues.push("缺少 H1");
  if (!document.headings.length) issues.push("缺少 H2 H3 内容结构");
  if (document.wordCount < 300) issues.push(`正文偏薄 仅 ${document.wordCount} 词`);
  if (!document.canonical) issues.push("缺少 Canonical");
  if (document.missingAltImages > 0) issues.push(`有 ${document.missingAltImages} 张图片缺少 Alt`);
  const peers = relatedPages
    .filter((peer) => peer.url !== document.url && peer.intent === document.intent && !isParentChild(document, peer))
    .map((peer) => ({ peer, similarity: semanticSimilarity(document, peer), relevance: overlap(document.entities, peer.entities) }))
    .sort((a, b) => b.similarity - a.similarity || b.relevance - a.relevance);
  const peer = peers[0]?.peer;
  const semanticTerms = peer ? recommendationTerms(document, peer) : [];
  const coreTerms = [...new Set([...document.entities, ...topTerms(document.tokens, 12)])].slice(0, 6);
  const fallbackTerms = tokenize(pathParts(document.url).join(" ")).slice(0, 5);
  const title = sanitizeSeoTitle([...coreTerms.slice(0, 5), ...fallbackTerms].join(" ")) || "页面核心主题";
  const internalCandidates = [...new Map([...relatedPages, ...authorityPages].map((source) => [source.url, source])).values()];
  const internalLinks = internalCandidates
    .filter((source) => source.url !== document.url)
    .map((source) => ({
      source: source.url,
      relevance: overlap(source.topKeywords || topTerms(source.tokens, 20), document.topKeywords || topTerms(document.tokens, 20)),
      authority: source.metrics.impressions + source.metrics.sessions * 10 + source.metrics.clicks * 50,
    }))
    .filter((source) => source.relevance >= 0.2)
    .sort((a, b) => b.relevance - a.relevance || b.authority - a.authority)
    .slice(0, 3)
    .map((source) => ({ source: source.source, target: document.url, anchor: coreTerms[0] || fallbackTerms[0] || "目标关键词" }));
  return {
    url: document.url,
    priority: !document.title || !document.h1Count || document.wordCount < 150 ? "P1" : issues.length ? "P2" : "P3",
    intent: document.intent,
    issues,
    metrics: document.metrics,
    recommendations: {
      title,
      metaDescription: `围绕 ${coreTerms.slice(0, 3).join(" ") || "页面核心主题"} 说明页面独有价值 适用对象 核心内容和下一步动作 发布前由运营人员核对事实`,
      semanticTerms,
      headings: semanticTerms.slice(0, 5).map((term) => `在 H2 或 H3 中补充 ${term} 的独立段落`),
      internalLinks,
      manualActions: [
        ...issues.map((issue) => `人工修复 ${issue}`),
        "在 WordPress 编辑器中逐项修改并预览 不自动发布",
        "修改后重新提交 Sitemap 并在 GSC 检查规范网址和收录状态",
      ],
    },
  };
}

function analyzeCannibalization(documents, threshold = 0.75, options = {}) {
  const active = documents.filter((document) => !document.excludedReason && document.status >= 200 && document.status < 400);
  const documentFrequency = new Map();
  for (const document of active) {
    for (const token of new Set(document.tokens)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const idf = new Map([...documentFrequency].map(([token, count]) => [token, Math.log((active.length + 1) / (count + 1)) + 1]));
  const tfidfVectors = active.map((document) => vectorize(document.tokens, idf));

  const postings = new Map();
  active.forEach((document, index) => {
    const terms = topTerms(document.tokens, 14).filter((term) => (documentFrequency.get(term) || 0) <= Math.max(20, active.length * 0.3));
    for (const term of terms) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(index);
    }
  });
  const pairCounts = new Map();
  for (const indexes of postings.values()) {
    if (indexes.length > 80) continue;
    for (let a = 0; a < indexes.length; a += 1) {
      for (let b = a + 1; b < indexes.length; b += 1) {
        const key = `${indexes[a]}:${indexes[b]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const indexByHash = new Map(active.map((document, index) => [document.urlHash || urlHash(document.url), index]));
  const semanticScores = new Map();
  for (const pair of options.semanticPairs || []) {
    const leftIndex = indexByHash.get(pair.leftHash);
    const rightIndex = indexByHash.get(pair.rightHash);
    if (leftIndex === undefined || rightIndex === undefined || leftIndex === rightIndex) continue;
    const a = Math.min(leftIndex, rightIndex);
    const b = Math.max(leftIndex, rightIndex);
    const key = `${a}:${b}`;
    semanticScores.set(key, Math.max(semanticScores.get(key) || 0, Number(pair.similarity || 0)));
    if (!pairCounts.has(key)) pairCounts.set(key, 0);
  }

  const relatedIndexes = new Map();
  for (const [key, sharedTerms] of pairCounts) {
    if (sharedTerms < 2 && !semanticScores.has(key)) continue;
    const [leftIndex, rightIndex] = key.split(":").map(Number);
    if (!relatedIndexes.has(leftIndex)) relatedIndexes.set(leftIndex, []);
    if (!relatedIndexes.has(rightIndex)) relatedIndexes.set(rightIndex, []);
    relatedIndexes.get(leftIndex).push(rightIndex);
    relatedIndexes.get(rightIndex).push(leftIndex);
  }
  const authorityPages = [...active]
    .sort((a, b) => (b.metrics.impressions + b.metrics.sessions * 10 + b.metrics.clicks * 50) - (a.metrics.impressions + a.metrics.sessions * 10 + a.metrics.clicks * 50))
    .slice(0, 100);

  const findings = [];
  let parentChildExemptions = 0;
  let intentExemptions = 0;
  for (const [key, sharedTerms] of pairCounts) {
    if (sharedTerms < 2 && !semanticScores.has(key)) continue;
    const [leftIndex, rightIndex] = key.split(":").map(Number);
    const left = active[leftIndex];
    const right = active[rightIndex];
    const lexicalSimilarity = cosine(left.vector, right.vector);
    const semanticScore = semanticScores.get(key) || (
      left.embedding?.length && right.embedding?.length ? cosine(left.embedding, right.embedding) : 0
    );
    if (semanticScore ? semanticScore < 0.62 : lexicalSimilarity < threshold) continue;
    if (isParentChild(left, right)) {
      parentChildExemptions += 1;
      continue;
    }
    const entityOverlap = overlap(left.entities, right.entities);
    const keywordOverlap = overlap(topTerms(left.tokens, 20), topTerms(right.tokens, 20));
    const tfidfSimilarity = cosine(tfidfVectors[leftIndex], tfidfVectors[rightIndex]);
    const sameIntent = left.intent === right.intent;
    const similarity = semanticScore
      ? semanticScore * 0.82 + tfidfSimilarity * 0.08 + keywordOverlap * 0.06 + entityOverlap * 0.04
      : lexicalSimilarity;
    if (!sameIntent && (semanticScore || lexicalSimilarity) < 0.9) {
      intentExemptions += 1;
      continue;
    }
    if (sameIntent && semanticScore && similarity < 0.66) continue;
    const primary = preferredPage(left, right);
    const secondary = primary === left ? right : left;
    let strategy = "意图拆分";
    let action = `保留 ${primary.url} 作为核心页面，将 ${secondary.url} 改为更具体的长尾意图，并重写 Title H1 正文结构与内链锚文本。`;
    if ((semanticScore >= 0.88 || similarity >= 0.88) && sameIntent) {
      strategy = "合并与301重定向";
      action = `把 ${secondary.url} 的独有有效内容合并到 ${primary.url}，完成质量检查后对旧 URL 设置 301，并把站内链接统一更新到主页面。`;
    } else if (/[?&=]/.test(secondary.url) || (secondary.canonical && secondary.canonical !== secondary.url)) {
      strategy = "规范化标签";
      action = `保留两个页面，但让 ${secondary.url} 使用 rel canonical 指向 ${primary.url}，同时限制参数页进入索引和站内链接。`;
    }
    const primaryTerms = [...new Set([...primary.entities, ...topTerms(primary.tokens, 10)])].slice(0, 6);
    const secondaryTerms = recommendationTerms(secondary, primary);
    const title = sanitizeSeoTitle([...primaryTerms.slice(0, 4), ...secondaryTerms.slice(0, 2)].join(" "));
    findings.push({
      id: crypto.createHash("sha1").update(`${left.url}|${right.url}`).digest("hex").slice(0, 12),
      risk: (semanticScore >= 0.86 || similarity >= 0.82) && sameIntent ? "高" : "中",
      similarity: Number(similarity.toFixed(4)),
      semanticSimilarity: Number(semanticScore.toFixed(4)),
      lexicalSimilarity: Number(lexicalSimilarity.toFixed(4)),
      keywordOverlap: Number(keywordOverlap.toFixed(4)),
      tfidfSimilarity: Number(tfidfSimilarity.toFixed(4)),
      entityOverlap: Number(entityOverlap.toFixed(4)),
      sameIntent,
      intent: left.intent,
      pages: [left.url, right.url],
      primaryUrl: primary.url,
      secondaryUrl: secondary.url,
      reason: `${semanticScore ? `多语言语义相似度 ${(semanticScore * 100).toFixed(1)}%，` : "未取得多语言语义向量，"}词法向量相似度 ${(lexicalSimilarity * 100).toFixed(1)}%，TF IDF 相似度 ${(tfidfSimilarity * 100).toFixed(1)}%，核心实体重合度 ${(entityOverlap * 100).toFixed(1)}%，关键词重合度 ${(keywordOverlap * 100).toFixed(1)}%；两个页面搜索意图${sameIntent ? "一致" : "不同"}。`,
      strategy,
      action,
      recommendations: {
        targetUrl: secondary.url,
        title,
        metaDescription: `围绕 ${primaryTerms.slice(0, 3).join(" ")} 明确页面独有价值，说明适用对象、核心内容和下一步动作，发布前由运营人员核对事实。`,
        missingSemanticTerms: secondaryTerms,
        headings: secondaryTerms.slice(0, 4).map((term) => `在 H2 或 H3 中增加 ${term} 的独立说明`),
        internalLinks: active
          .filter((document) => document.url !== secondary.url && document.metrics.impressions > secondary.metrics.impressions)
          .sort((a, b) => b.metrics.impressions - a.metrics.impressions)
          .slice(0, 3)
          .map((document) => ({ source: document.url, target: secondary.url, anchor: primaryTerms[0] || title.split(" ")[0] || "目标关键词" })),
      },
    });
  }
  findings.sort((a, b) => b.similarity - a.similarity || b.entityOverlap - a.entityOverlap);
  const pageRecommendations = active
    .map((document, index) => pageRecommendation(document, (relatedIndexes.get(index) || []).map((peerIndex) => active[peerIndex]), authorityPages))
    .filter((item) => item.issues.length)
    .sort((a, b) => ({ P1: 1, P2: 2, P3: 3 }[a.priority] - { P1: 1, P2: 2, P3: 3 }[b.priority]) || b.issues.length - a.issues.length);
  return {
    generatedAt: new Date().toISOString(),
    threshold,
    analyzedPages: active.length,
    pairCandidates: pairCounts.size,
    parentChildExemptions,
    intentExemptions,
    findings,
    pageRecommendations,
    embedding: {
      enabled: Boolean(options.embeddingStatus?.enabled),
      configured: Boolean(options.embeddingStatus?.configured),
      model: active.find((document) => document.embedding?.length && document.embeddingModel)?.embeddingModel || options.embeddingStatus?.model || "",
      vectorSearch: Boolean(options.embeddingStatus?.vectorSearch),
      embeddedPages: active.filter((document) => document.embedding?.length).length,
      fallbackPages: active.filter((document) => !document.embedding?.length).length,
    },
  };
}

module.exports = {
  VECTOR_SIZE,
  analyzeCannibalization,
  buildDocument,
  cosine,
  detectMainLanguage,
  sanitizeSeoTitle,
  translationUrlReason,
  urlHash,
  vectorize,
};
