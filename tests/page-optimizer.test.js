const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectHtml } = require("../src/audit");
const { optimizePage } = require("../src/page-optimizer");
const { buildDemoSnapshot } = require("../src/demo");

test("builds a concrete WordPress SEO solution from live HTML and GSC queries", () => {
  const url = "https://shop.example.com/collections/hiking-backpacks";
  const html = `<!doctype html><html lang="en-US"><head><title>Collection</title><meta name="generator" content="WordPress 6.8"><meta name="description" content="Short description"><link rel="canonical" href="/collections/hiking-backpacks"><meta name="viewport" content="width=device-width"><script type="application/ld+json">{"@type":"ItemList"}</script></head><body class="elementor-page woocommerce"><main><h1>Hiking Backpacks</h1><h2>Products</h2><img src="one.jpg"><div class="product-card"><span class="price">$129</span><button>Add to cart</button></div><p>Shipping and payment information.</p><a href="/help">Help</a></main><div class="rank-math"></div><script src="/wp-content/plugin.js"></script></body></html>`;
  const audit = inspectHtml(html, url, url, 200, "text/html");
  const result = optimizePage({
    page: { url, sessions: 2480, users: 2100, add_to_carts: 37, add_to_cart_density: 0.0149, gsc_clicks: 1820, gsc_impressions: 118500, gsc_ctr: 0.0154, gsc_position: 10.1 },
    snapshot: buildDemoSnapshot(),
    site: { name: "Example Outdoor", brand_terms: "Example Outdoor", website_url: "https://shop.example.com/" },
    audit,
  });
  assert.equal(result.searchIntent.primaryKeyword, "lightweight hiking backpack");
  assert.ok(result.solution.proposedTitle.toLowerCase().includes("lightweight hiking backpack"));
  assert.ok(result.solution.proposedDescription.length >= 70);
  assert.equal(result.platform.isWordPress, true);
  assert.equal(result.platform.isWooCommerce, true);
  assert.ok(result.platform.seoPlugins.includes("Rank Math"));
  assert.ok(result.platform.builders.includes("Elementor"));
  assert.ok(result.issues.some((item) => item.title.includes("Title")));
  assert.ok(result.issues.some((item) => item.title.includes("ALT")));
  assert.ok(result.actionPlan.every((item) => item.wordpressPath && item.acceptance));
  assert.ok(result.searchIntent.cannibalization.some((item) => item.page === "https://shop.example.com/"));
  assert.ok(result.scores.overall >= 0 && result.scores.overall <= 100);
});
