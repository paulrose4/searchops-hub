const dns = require("node:dns/promises");
const net = require("node:net");
const cheerio = require("cheerio");

const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_SITEMAP_BYTES = 5_000_000;
const MAX_SITEMAP_FILES = 40;
const MAX_SITEMAP_URLS = 5000;

function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] >= 224)
    );
  }
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIp(mappedIpv4);
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff")
  );
}

async function assertPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) {
    throw new Error("目标域名不是公开网站");
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("目标域名解析到非公开网络地址");
  }
}

function normalizeCandidate(value, siteUrl) {
  try {
    const base = new URL(siteUrl);
    const url = new URL(value || "/", base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function candidateUrls(site, snapshot) {
  const gsc = snapshot.current?.gsc || {};
  const ga4 = snapshot.current?.ga4 || {};
  const scored = new Map();
  const add = (value, score) => {
    const url = normalizeCandidate(value, site.website_url);
    if (!url) return;
    scored.set(url, Math.max(scored.get(url) || 0, Number(score || 0)));
  };
  add(site.website_url, 1);
  for (const row of gsc.pages || []) add(row.page, row.clicks * 20 + row.impressions);
  for (const row of gsc.countryQueryPages || []) add(row.page, row.clicks * 15 + row.impressions);
  for (const row of ga4.landingPages || []) add(row.path, row.sessions * 10);
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PAGES)
    .map(([url]) => url);
}

async function safeFetch(url, allowedHost, accept = "text/html,application/xhtml+xml") {
  let current = new URL(url);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (current.hostname.toLowerCase() !== allowedHost.toLowerCase()) {
      throw new Error("页面重定向到了绑定域名之外");
    }
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "GA4-GSC-Growth-Hub/1.0 (+SEO page audit)",
        accept,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current.href };
      current = new URL(location, current);
      continue;
    }
    return { response, finalUrl: current.href };
  }
  throw new Error("页面重定向次数过多");
}

function jsonLdTypes($) {
  const types = new Set();
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      const walk = (value) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(walk);
        const type = value["@type"];
        if (Array.isArray(type)) type.forEach((item) => types.add(String(item)));
        else if (type) types.add(String(type));
        Object.values(value).forEach(walk);
      };
      walk(parsed);
    } catch {
      types.add("Invalid JSON-LD");
    }
  });
  return [...types].slice(0, 20);
}

function textSignal(text, pattern) {
  return pattern.test(String(text || "").replace(/\s+/g, " "));
}

function inspectHtml(html, requestedUrl, finalUrl, status, contentType) {
  const rawHtml = String(html || "");
  const $ = cheerio.load(rawHtml);
  const types = jsonLdTypes($);
  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim() || "";
  const robots = $('meta[name="robots"]').attr("content")?.trim() || "";
  const canonicalRaw = $('link[rel="canonical"]').attr("href") || "";
  const htmlLang = $("html").attr("lang")?.trim() || "";
  const viewport = $('meta[name="viewport"]').attr("content")?.trim() || "";
  const generator = $('meta[name="generator"]').attr("content")?.trim() || "";
  const og = {
    title: $('meta[property="og:title"]').attr("content")?.trim() || "",
    description: $('meta[property="og:description"]').attr("content")?.trim() || "",
    image: $('meta[property="og:image"]').attr("content")?.trim() || "",
    type: $('meta[property="og:type"]').attr("content")?.trim() || "",
  };
  const headings = $("h1,h2,h3,h4,h5,h6").map((_, element) => ({
    level: Number(element.tagName.slice(1)),
    text: $(element).text().replace(/\s+/g, " ").trim(),
  })).get().filter((item) => item.text);
  const h1s = headings.filter((item) => item.level === 1).map((item) => item.text);
  const hreflangs = $('link[rel="alternate"][hreflang]')
    .map((_, element) => ({
      language: $(element).attr("hreflang") || "",
      href: $(element).attr("href") || "",
    }))
    .get();
  const base = new URL(finalUrl);
  const internalLinks = new Set();
  const internalLinkDetails = [];
  const externalLinks = new Set();
  let nofollowLinks = 0;
  $("a[href]").each((_, element) => {
    try {
      const link = new URL($(element).attr("href"), base);
      if (!["http:", "https:"].includes(link.protocol)) return;
      link.hash = "";
      if (/nofollow/i.test($(element).attr("rel") || "")) nofollowLinks += 1;
      if (link.hostname === base.hostname) {
        internalLinks.add(link.href);
        if (internalLinkDetails.length < 300) {
          internalLinkDetails.push({
            href: link.href,
            anchor: $(element).text().replace(/\s+/g, " ").trim().slice(0, 200),
          });
        }
      }
      else externalLinks.add(link.href);
    } catch {}
  });
  const images = $("img");
  let missingAltImages = 0;
  let emptyAltImages = 0;
  const imageAlts = [];
  images.each((_, element) => {
    const alt = $(element).attr("alt");
    if (alt === undefined) missingAltImages += 1;
    else if (!alt.trim()) emptyAltImages += 1;
    else if (imageAlts.length < 300) imageAlts.push(alt.trim().slice(0, 200));
  });
  let canonical = canonicalRaw;
  try {
    canonical = canonicalRaw ? new URL(canonicalRaw, base).href : "";
  } catch {}
  const localized = /^\/[a-z]{2}(?:-[a-z]{2})?\//i.test(base.pathname);
  const pluginSignals = [];
  if (/yoast-schema-graph|wordpress-seo|yoast seo/i.test(rawHtml)) pluginSignals.push("Yoast SEO");
  if (/rank-math|rank_math/i.test(rawHtml)) pluginSignals.push("Rank Math");
  if (/aioseo|all in one seo/i.test(rawHtml)) pluginSignals.push("AIOSEO");
  const builderSignals = [];
  if (/elementor-/i.test(rawHtml)) builderSignals.push("Elementor");
  if (/et_pb_|divi/i.test(rawHtml)) builderSignals.push("Divi");
  if (/vc_row|wpb_/i.test(rawHtml)) builderSignals.push("WPBakery");
  if (/wp-block-/i.test(rawHtml)) builderSignals.push("Gutenberg");
  const platform = {
    isWordPress: /wordpress/i.test(generator) || /\/wp-(?:content|includes|json)\b/i.test(rawHtml),
    generator,
    seoPlugins: [...new Set(pluginSignals)],
    builders: [...new Set(builderSignals)],
    isWooCommerce: /woocommerce|wc-block|add_to_cart/i.test(rawHtml),
  };
  $("script,style,noscript,template,svg").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const mainText = $("main,article,[role=main],.entry-content,.product,.product-category").first().text().replace(/\s+/g, " ").trim() || bodyText;
  const wordCount = mainText ? mainText.split(/\s+/).filter(Boolean).length : 0;
  const signals = {
    product: types.some((type) => /product|itemlist/i.test(type)) || $("[data-product-id],.product,.product-item,.product-card,.woocommerce-product").length > 0,
    faq: types.some((type) => /faq/i.test(type)) || textSignal(bodyText, /\bFAQ\b|常见问题|häufige fragen|preguntas frecuentes|câu hỏi thường gặp|سوالات متداول/i),
    price: $("[itemprop=price],[data-price],.price").length > 0 || textSignal(bodyText, /[$€£¥]\s?\d|\d\s?(USD|EUR|GBP)/i),
    shipping: textSignal(bodyText, /shipping|delivery|dispatch|发货|配送|versand|livraison|envío|giao hàng|ارسال/i),
    payment: textSignal(bodyText, /payment|pay with|支付|zahlung|paiement|pago|thanh toán|پرداخت/i),
    returns: textSignal(bodyText, /returns?|refund|退换|退款|rückgabe|retour|devoluci[oó]n|hoàn trả|مرجوع/i),
    privacy: textSignal(bodyText, /discreet|privacy|confidential|隐私|保密|diskret|discret|riêng tư|محرمانه/i),
    cta: $("button,a").filter((_, element) => textSignal($(element).text(), /add to cart|buy now|shop now|加入购物车|立即购买|in den warenkorb|ajouter au panier|comprar|thêm vào giỏ|افزودن به سبد/i)).length > 0,
  };
  const issues = [];
  if (status >= 400) issues.push(`HTTP ${status}`);
  if (!title) issues.push("缺少 Title");
  else if (title.length < 20 || title.length > 70) issues.push(`Title 长度 ${title.length}`);
  if (!description) issues.push("缺少 Meta Description");
  else if (description.length < 70 || description.length > 170) issues.push(`Meta Description 长度 ${description.length}`);
  if (h1s.length !== 1) issues.push(`H1 数量 ${h1s.length}`);
  if (!canonical) issues.push("缺少 canonical");
  if (/noindex/i.test(robots)) issues.push("页面设置了 noindex");
  if (!viewport) issues.push("缺少 viewport");
  if (localized && !hreflangs.length) issues.push("本地化页面缺少 hreflang");
  if (!signals.product && !/\/blog|\/guide|\/news/i.test(base.pathname)) issues.push("未识别到商品模块");
  if (images.length && missingAltImages) issues.push(`有 ${missingAltImages} 张图片缺少 ALT 属性`);
  return {
    requestedUrl,
    finalUrl,
    path: base.pathname + base.search,
    status,
    contentType,
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    robots,
    canonical,
    htmlLang,
    viewport,
    og,
    h1s: h1s.slice(0, 10),
    headings: headings.slice(0, 100),
    hreflangs: hreflangs.slice(0, 60),
    structuredDataTypes: types,
    wordCount,
    characterCount: mainText.length,
    mainTextExcerpt: mainText.slice(0, 12000),
    internalLinkCount: internalLinks.size,
    internalLinks: internalLinkDetails,
    externalLinkCount: externalLinks.size,
    nofollowLinkCount: nofollowLinks,
    imageCount: images.length,
    missingAltImages,
    emptyAltImages,
    imageAlts,
    platform,
    signals,
    issues,
  };
}

function sitemapPageUrl(value, siteUrl) {
  const url = normalizeCandidate(value, siteUrl);
  if (!url) return null;
  const pathname = new URL(url).pathname.toLowerCase();
  if (/\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webp|woff2?|xml)$/.test(pathname)) return null;
  return url;
}

async function discoverSitemapUrls(siteUrl) {
  const base = new URL(siteUrl);
  await assertPublicHost(base.hostname);
  const sitemapQueue = [];
  const queued = new Set();
  const visited = new Set();
  const homepage = normalizeCandidate(siteUrl, siteUrl);
  const urls = new Set(homepage ? [homepage] : []);
  const errors = [];
  const enqueue = (value) => {
    const normalized = normalizeCandidate(value, siteUrl);
    if (!normalized || queued.has(normalized) || queued.size >= MAX_SITEMAP_FILES) return;
    queued.add(normalized);
    sitemapQueue.push(normalized);
  };

  try {
    const { response } = await safeFetch(new URL("/robots.txt", base).href, base.hostname, "text/plain,*/*;q=0.1");
    if (response.ok) {
      const robots = await readLimitedText(response, 500_000);
      for (const match of robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) enqueue(match[1]);
    }
  } catch (error) {
    errors.push(`robots.txt ${error.message}`);
  }
  enqueue(new URL("/sitemap_index.xml", base).href);
  enqueue(new URL("/sitemap.xml", base).href);
  enqueue(new URL("/wp-sitemap.xml", base).href);

  while (sitemapQueue.length && visited.size < MAX_SITEMAP_FILES && urls.size < MAX_SITEMAP_URLS) {
    const batch = sitemapQueue.splice(0, 6);
    const results = await Promise.all(batch.map(async (sitemapUrl) => {
      visited.add(sitemapUrl);
      try {
        const { response } = await safeFetch(sitemapUrl, base.hostname, "application/xml,text/xml,text/plain,*/*;q=0.1");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { xml: await readLimitedText(response, MAX_SITEMAP_BYTES) };
      } catch (error) {
        errors.push(`${sitemapUrl} ${error.message}`);
        return null;
      }
    }));
    for (const result of results.filter(Boolean)) {
      const $ = cheerio.load(result.xml, { xmlMode: true });
      const sitemapLocs = $("sitemap > loc").map((_, element) => $(element).text().trim()).get();
      if (sitemapLocs.length) {
        sitemapLocs.forEach(enqueue);
        continue;
      }
      let pageLocs = $("url > loc").map((_, element) => $(element).text().trim()).get();
      if (!pageLocs.length) {
        pageLocs = result.xml.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^https?:\/\//i.test(line));
      }
      for (const loc of pageLocs) {
        const normalized = sitemapPageUrl(loc, siteUrl);
        if (normalized) urls.add(normalized);
        if (urls.size >= MAX_SITEMAP_URLS) break;
      }
        if (urls.size >= MAX_SITEMAP_URLS) break;
    }
  }
  return {
    urls: [...urls],
    sitemapFiles: visited.size,
    errors: errors.slice(0, 20),
    truncated: sitemapQueue.length > 0 || urls.size >= MAX_SITEMAP_URLS,
    limits: { sitemapFiles: MAX_SITEMAP_FILES, urls: MAX_SITEMAP_URLS },
  };
}

async function readLimitedText(response, maxBytes = MAX_HTML_BYTES) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("页面 HTML 超过 2 MB 限制");
  if (!response.body?.getReader) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("页面 HTML 超过 2 MB 限制");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function inspectPage(url, allowedHost) {
  try {
    const { response, finalUrl } = await safeFetch(url, allowedHost);
    const contentType = response.headers.get("content-type") || "";
    const html = /html|xhtml/i.test(contentType) ? await readLimitedText(response) : "";
    return inspectHtml(html, url, finalUrl, response.status, contentType);
  } catch (error) {
    return {
      requestedUrl: url,
      finalUrl: url,
      path: new URL(url).pathname,
      status: 0,
      issues: ["抓取失败：" + error.message],
      error: error.message,
      signals: {},
      h1s: [],
      hreflangs: [],
      structuredDataTypes: [],
    };
  }
}

async function auditSitePages(site, snapshot) {
  const base = new URL(site.website_url);
  await assertPublicHost(base.hostname);
  const urls = candidateUrls(site, snapshot);
  const pages = [];
  for (let index = 0; index < urls.length; index += 3) {
    const batch = urls.slice(index, index + 3);
    pages.push(...(await Promise.all(batch.map((url) => inspectPage(url, base.hostname)))));
  }
  const successful = pages.filter((page) => page.status > 0).length;
  return {
    generatedAt: new Date().toISOString(),
    requested: urls.length,
    successful,
    failed: urls.length - successful,
    pages,
  };
}

module.exports = {
  auditSitePages,
  candidateUrls,
  discoverSitemapUrls,
  inspectHtml,
  inspectPage,
  isPrivateIp,
};
