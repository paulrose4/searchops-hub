const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns/promises");
const { inspectHtml, isPrivateIp, candidateUrls, discoverSitemapUrls } = require("../src/audit");
const { buildDemoSnapshot } = require("../src/demo");

test("extracts technical SEO and commerce evidence from HTML", () => {
  const html = `<!doctype html><html><head><title>Example Product Collection for Germany</title><meta name="description" content="A complete localized collection page with detailed products, delivery information and practical guidance for customers."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/de/collection"><link rel="alternate" hreflang="de" href="/de/collection"><script type="application/ld+json">{"@type":"ItemList"}</script></head><body><h1>German Collection</h1><div class="product-card"><span class="price">€499</span><button>Add to cart</button><img src="product.jpg" alt="German product"></div><p>Discreet shipping, secure payment and returns.</p><a href="/de/help">German help guide</a></body></html>`;
  const result = inspectHtml(html, "https://example.com/de/collection", "https://example.com/de/collection", 200, "text/html");
  assert.equal(result.status, 200);
  assert.equal(result.h1s.length, 1);
  assert.equal(result.signals.product, true);
  assert.equal(result.signals.shipping, true);
  assert.equal(result.signals.payment, true);
  assert.equal(result.signals.returns, true);
  assert.ok(result.structuredDataTypes.includes("ItemList"));
  assert.deepEqual(result.issues, []);
  assert.equal(result.headings.length, 1);
  assert.equal(result.imageCount, 1);
  assert.equal(result.internalLinks[0].anchor, "German help guide");
  assert.deepEqual(result.imageAlts, ["German product"]);
  assert.equal(result.platform.isWordPress, false);
});

test("blocks private network addresses and keeps audit candidates on the site", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.2"), true);
  assert.equal(isPrivateIp("::ffff:172.16.0.1"), true);
  assert.equal(isPrivateIp("ff02::1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  const urls = candidateUrls({ website_url: "https://shop.example.com/" }, buildDemoSnapshot());
  assert.ok(urls.length > 0);
  assert.ok(urls.every((url) => new URL(url).hostname === "shop.example.com"));
});


test("discovers same-host WordPress sitemap pages and excludes asset URLs", async (t) => {
  const originalLookup = dns.lookup;
  const originalFetch = global.fetch;
  dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  global.fetch = async (value) => {
    const url = String(value);
    if (url.endsWith("/robots.txt")) return new Response("Sitemap: https://example.com/sitemap_index.xml", { status: 200 });
    if (url.endsWith("/sitemap_index.xml")) return new Response('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>', { status: 200 });
    if (url.endsWith("/post-sitemap.xml")) return new Response('<?xml version="1.0"?><urlset><url><loc>https://example.com/source-page</loc></url><url><loc>https://example.com/en/translated-page</loc></url><url><loc>https://example.com/image.jpg</loc></url></urlset>', { status: 200 });
    return new Response("not found", { status: 404 });
  };
  t.after(() => {
    dns.lookup = originalLookup;
    global.fetch = originalFetch;
  });
  const result = await discoverSitemapUrls("https://example.com/");
  assert.ok(result.urls.includes("https://example.com/source-page"));
  assert.ok(result.urls.includes("https://example.com/en/translated-page"));
  assert.ok(!result.urls.includes("https://example.com/image.jpg"));
  assert.ok(result.sitemapFiles >= 2);
});
