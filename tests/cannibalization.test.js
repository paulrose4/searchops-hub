const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeCannibalization,
  buildDocument,
  sanitizeSeoTitle,
  translationUrlReason,
} = require("../src/cannibalization");

function page(url, title, body, intentPath = "category") {
  return buildDocument({
    page: { id: Math.floor(Math.random() * 10000), page: new URL(url).pathname, url, gsc_clicks: 10, gsc_impressions: 500, sessions: 100 },
    audit: {
      status: 200,
      htmlLang: "zh-CN",
      title,
      description: `${title} 提供详细说明和选择建议`,
      h1s: [title],
      headings: [{ level: 2, text: `${title} 选择指南` }],
      canonical: url,
      mainTextExcerpt: `${body} ${intentPath}`,
      wordCount: 600,
      internalLinks: [],
      imageAlts: [`${title} 产品图片`],
    },
  });
}

test("strictly excludes translated URL patterns", () => {
  assert.match(translationUrlReason("https://example.com/en/product"), /语言目录/);
  assert.match(translationUrlReason("https://example.com/page?lang=fr"), /翻译参数/);
  assert.equal(translationUrlReason("https://example.com/products/hiking-backpack"), "");
});

test("SEO title contains no punctuation or symbols", () => {
  const title = sanitizeSeoTitle("核心关键词，购买指南 | 品牌-name！");
  assert.equal(title, "核心关键词 购买指南 品牌 name");
  assert.doesNotMatch(title, /[\p{P}\p{S}]/u);
});

test("detects same-intent content collisions and returns executable recommendations", () => {
  const shared = "徒步背包 产品分类 材质 容量 价格 购买 选择 配送 防水 保养 徒步背包 产品分类 材质 容量 价格 购买 选择 配送";
  const documents = [
    page("https://example.com/hiking-backpacks", "徒步背包产品分类", `${shared} 热销型号和库存`, "category shop buy price"),
    page("https://example.com/lightweight-hiking-backpacks", "轻量徒步背包产品分类", `${shared} 热销型号和库存`, "category shop buy price"),
  ];
  const result = analyzeCannibalization(documents, 0.75);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].sameIntent, true);
  assert.ok(["合并与301重定向", "意图拆分"].includes(result.findings[0].strategy));
  assert.doesNotMatch(result.findings[0].recommendations.title, /[\p{P}\p{S}]/u);
});

test("exempts normal parent-child URL relationships", () => {
  const shared = "产品 分类 材质 尺寸 价格 购买 选择 配送 产品 分类 材质 尺寸 价格";
  const documents = [
    page("https://example.com/backpacks", "背包分类", shared, "category shop buy"),
    page("https://example.com/backpacks/model-a", "背包型号", shared, "category shop buy"),
  ];
  const result = analyzeCannibalization(documents, 0.7);
  assert.equal(result.findings.length, 0);
  assert.ok(result.parentChildExemptions >= 1);
});


test("returns manual page-level recommendations with punctuation-free titles", () => {
  const document = buildDocument({
    page: { id: 99, page: "/thin-page", url: "https://example.com/thin-page", gsc_clicks: 0, gsc_impressions: 20, sessions: 2 },
    audit: {
      status: 200,
      htmlLang: "zh-CN",
      title: "薄内容页面，待优化！",
      description: "",
      h1s: [],
      headings: [],
      canonical: "",
      mainTextExcerpt: "核心产品 简短介绍",
      wordCount: 20,
      internalLinks: [],
      imageAlts: [],
      missingAltImages: 2,
    },
  });
  const result = analyzeCannibalization([document], 0.75);
  assert.equal(result.pageRecommendations.length, 1);
  assert.equal(result.pageRecommendations[0].priority, "P1");
  assert.ok(result.pageRecommendations[0].issues.includes("缺少 H1"));
  assert.doesNotMatch(result.pageRecommendations[0].recommendations.title, /[\p{P}\p{S}]/u);
  assert.ok(result.pageRecommendations[0].recommendations.manualActions.every((action) => !/自动发布/.test(action) || /不自动发布/.test(action)));
});

test("recalls German paraphrases through multilingual semantic pairs", () => {
  const left = page(
    "https://example.com/pflege-ratgeber",
    "Pflegeanleitung für Produkte",
    "Reinigung Pflege Schutz Anleitung",
    "Ratgeber Pflege Reinigung",
  );
  const right = page(
    "https://example.com/richtig-saeubern",
    "Produkte richtig säubern",
    "Säuberung Lagerung Werterhalt Hinweise",
    "Anleitung Säuberung Lagerung",
  );
  left.language = "de";
  right.language = "de";
  left.tokens = ["pflege", "reinigung", "schutz"];
  right.tokens = ["säuberung", "lagerung", "werterhalt"];
  left.entities = ["pflege"];
  right.entities = ["säuberung"];
  left.vector = [1, 0];
  right.vector = [0, 1];
  left.embedding = [1, 0, 0];
  right.embedding = [0.93, Math.sqrt(1 - 0.93 ** 2), 0];
  left.embeddingModel = "BAAI/bge-m3";
  right.embeddingModel = "BAAI/bge-m3";
  const result = analyzeCannibalization([left, right], 0.75, {
    semanticPairs: [{ leftHash: left.urlHash, rightHash: right.urlHash, similarity: 0.93 }],
    embeddingStatus: { enabled: true, configured: true, model: "BAAI/bge-m3", vectorSearch: true },
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].semanticSimilarity, 0.93);
  assert.equal(result.findings[0].lexicalSimilarity, 0);
  assert.match(result.findings[0].reason, /多语言语义相似度/);
  assert.equal(result.embedding.model, "BAAI/bge-m3");
  assert.equal(result.embedding.vectorSearch, true);
});
