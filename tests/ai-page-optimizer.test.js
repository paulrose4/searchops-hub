const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enhancePageOptimization,
  getAiConnectionStatus,
  localizationProblem,
  probeAiGeneration,
  safeAiError,
} = require("../src/ai-page-optimizer");

function aiResult(overrides = {}) {
  return {
    language: { code: "fa", nameZh: "波斯语", nativeName: "فارسی", direction: "rtl" },
    summaryZh: "该页面应围绕真实波斯语搜索需求重构分类页内容。",
    nativeSummary: "این صفحه مجموعه عروسک‌های جنسی را با اطلاعات روشن معرفی می‌کند.",
    intent: {
      primaryKeyword: "عروسک جنسی",
      primaryIntentZh: "比较并选择相关产品",
      userStageZh: "商业调查阶段",
      secondaryKeywords: ["عروسک واقعی", "خرید عروسک جنسی"],
    },
    localizedCopy: {
      title: "عروسک جنسی واقعی | راهنمای انتخاب و مقایسه",
      metaDescription: "انواع عروسک جنسی واقعی را از نظر جنس، اندازه، امکانات و ارسال محرمانه مقایسه کنید و گزینه مناسب خود را انتخاب کنید.",
      h1: "عروسک جنسی واقعی",
      introduction: "در این راهنما می‌توانید انواع عروسک‌های جنسی را بر اساس جنس، اندازه و نیازهای نگهداری مقایسه کنید.",
    },
    outline: [
      { heading: "راهنمای انتخاب عروسک جنسی", purposeZh: "解释选择标准", keyPointsZh: ["材质", "尺寸"] },
      { heading: "مقایسه جنس و اندازه", purposeZh: "提供规格对比", keyPointsZh: ["使用表格"] },
      { heading: "ارسال محرمانه و نگهداری", purposeZh: "说明真实政策", keyPointsZh: ["隐私配送"] },
      { heading: "پرسش‌های متداول", purposeZh: "回答真实问题", keyPointsZh: ["避免虚构"] },
    ],
    faqs: [{ question: "چگونه مدل مناسب را انتخاب کنیم؟", answer: "مدل مناسب را بر اساس جنس، اندازه و نیازهای نگهداری انتخاب کنید.", answerGuidanceZh: "根据材质、尺寸和维护需求回答。" }],
    issues: [{ severity: "P1", category: "本地化", title: "现有描述不符合波斯语搜索表达", evidence: "GSC 主查询为波斯语。", impact: "摘要相关性不足。", fix: "使用建议的波斯语描述。", acceptance: "文案为自然波斯语并覆盖主查询。" }],
    internalLinks: [
      { target: "https://example.com/fa/category", anchor: "کوله پشتی کوهنوردی", reasonZh: "关联分类页" },
      { target: "https://attacker.example/fake", anchor: "لینک", reasonZh: "模型编造链接" },
    ],
    schema: ["CollectionPage", "ItemList", "BreadcrumbList"],
    wordpressSteps: ["在 WordPress 页面编辑器中替换 H1 和正文。", "在 Yoast SEO 或 Rank Math 中填写 SEO 标题和描述。"],
    actionPlan: [{ order: 1, priority: "P1", action: "替换波斯语搜索摘要。", wordpressPath: "SEO 插件的搜索外观面板", acceptance: "Title、Description 和 H1 使用自然波斯语。" }],
    validation: ["发布后在 GSC URL 检查中请求重新编入索引。"],
    terminologyNotesZh: ["统一使用 GSC 中已有的波斯语核心词。"],
    ...overrides,
  };
}

function ruleResult() {
  return {
    version: 1,
    locale: "fa",
    pageType: "category",
    scores: { overall: 80, technical: 90, content: 70, serp: 75, conversion: 65, localization: 40 },
    metrics: { sessions: 100, gscClicks: 20, gscImpressions: 500 },
    searchIntent: { primaryKeyword: "عروسک جنسی", queries: [{ query: "عروسک جنسی", impressions: 500 }] },
    currentPage: { title: "Old", description: "Old", h1s: ["Old"] },
    platform: { isWordPress: true, seoPlugins: ["Yoast SEO"], builders: ["Gutenberg"] },
    issues: [{
      severity: "P1",
      category: "搜索摘要",
      title: "Meta Description 缺失或意图承接不足",
      evidence: "当前摘要不足",
      impact: "影响点击",
      fix: "Explore products in English.",
      acceptance: "使用目标语言",
    }],
    solution: {
      targetWordCount: 800,
      internalLinks: [{ target: "https://example.com/fa/category", anchor: "old", reason: "shared query" }],
      wordpress: { plugin: "Yoast SEO", builder: "Gutenberg", steps: [] },
    },
    actionPlan: [{
      order: 1,
      priority: "P1",
      action: "建议改为：Explore products in English.",
      wordpressPath: "SEO 插件",
      acceptance: "使用目标语言",
    }],
    validation: [],
  };
}

test("rejects English copy for a Persian page", () => {
  const invalid = aiResult({
    localizedCopy: {
      title: "Best products and buying guide",
      metaDescription: "Explore products with specifications and delivery information.",
      h1: "Best products",
      introduction: "Compare the available options and choose the right product.",
    },
    outline: [{ heading: "Buying guide", purposeZh: "说明", keyPointsZh: [] }],
  });
  assert.match(localizationProblem(invalid), /原生字符/);
  assert.equal(localizationProblem(aiResult()), "");
});

test("retries invalid localization and only keeps approved internal links", async () => {
  const calls = [];
  const client = {
    responses: {
      parse: async (request) => {
        calls.push(request);
        if (calls.length === 1) {
          return { output_parsed: aiResult({
            localizedCopy: { title: "English title", metaDescription: "English description", h1: "English H1", introduction: "English introduction" },
            outline: [{ heading: "English heading", purposeZh: "说明", keyPointsZh: [] }],
          }) };
        }
        return { output_parsed: aiResult() };
      },
    },
  };
  const result = await enhancePageOptimization({
    ruleResult: ruleResult(),
    audit: { title: "Old", mainTextExcerpt: "公开页面正文", platform: {} },
    page: { url: "https://example.com/fa/page" },
    site: { name: "Example", website_url: "https://example.com", target_markets: "Iran", brand_terms: "Example" },
    client,
    env: { OPENAI_MODEL: "test-model" },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].input, /未通过本地语言校验/);
  assert.equal(result.ai.model, "test-model");
  assert.equal(result.ai.targetLanguageCode, "fa");
  assert.equal(result.solution.proposedTitle, aiResult().localizedCopy.title);
  assert.equal(result.issues[0].fix, `建议改为：${aiResult().localizedCopy.metaDescription}`);
  assert.doesNotMatch(result.issues[0].fix, /Explore products/);
  assert.equal(result.actionPlan[0].action, `将 Meta Description 修改为：${aiResult().localizedCopy.metaDescription}`);
  assert.doesNotMatch(result.actionPlan[0].action, /Explore products/);
  assert.deepEqual(result.solution.internalLinks, [{ target: "https://example.com/fa/category", anchor: "کوله پشتی کوهنوردی", reason: "关联分类页" }]);
  assert.doesNotMatch(JSON.stringify(result), /attacker\.example/);
});

test("requires a server-side API key when no client is injected", async () => {
  await assert.rejects(
    enhancePageOptimization({ ruleResult: ruleResult(), audit: {}, page: {}, site: {}, env: {} }),
    (error) => error.code === "AI_NOT_CONFIGURED",
  );
});
test("redacts API credentials from server error logs", () => {
  const safe = safeAiError(new Error("request failed with api_key=sk-secretvalue123456 and Bearer token.value"));
  assert.doesNotMatch(safe.message, /sk-secretvalue|token\.value/);
  assert.match(safe.message, /REDACTED/);
});
test("supports OpenAI-compatible Chat Completions relays", async () => {
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return { choices: [{ message: { content: JSON.stringify(aiResult()) } }] };
        },
      },
    },
  };
  const result = await enhancePageOptimization({
    ruleResult: ruleResult(),
    audit: { title: "Old", mainTextExcerpt: "公开页面正文", platform: {} },
    page: { url: "https://example.com/fa/page" },
    site: { name: "Example", website_url: "https://example.com" },
    client,
    env: { OPENAI_MODEL: "relay-model", OPENAI_API_MODE: "chat" },
  });
  assert.equal(request.model, "relay-model");
  assert.equal(request.response_format.type, "json_object");
  assert.match(request.messages[1].content, /output-json-schema/);
  assert.equal(result.ai.targetLanguageCode, "fa");
});
test("lists relay models without exposing the API key", async () => {
  const status = await getAiConnectionStatus({
    client: { models: { list: async () => ({ data: [{ id: "model-b" }, { id: "model-a" }] }) } },
    env: {
      OPENAI_API_KEY: "secret-not-returned",
      OPENAI_BASE_URL: "https://relay.example/v1/",
      OPENAI_MODEL: "model-a",
      OPENAI_API_MODE: "chat",
    },
  });
  assert.deepEqual(status.models, ["model-a", "model-b"]);
  assert.equal(status.baseURL, "https://relay.example/v1");
  assert.equal(status.apiMode, "chat");
  assert.doesNotMatch(JSON.stringify(status), /secret-not-returned/);
});
test("probes Chat Completions generation without exposing the API key", async () => {
  let request;
  const result = await probeAiGeneration({
    client: {
      chat: {
        completions: {
          create: async (value) => {
            request = value;
            return { choices: [{ message: { content: "连接成功" } }] };
          },
        },
      },
    },
    env: {
      OPENAI_API_KEY: "secret-not-returned",
      OPENAI_MODEL: "relay-model",
      OPENAI_API_MODE: "chat",
    },
  });
  assert.equal(request.model, "relay-model");
  assert.equal(result.generated, true);
  assert.equal(result.output, "连接成功");
  assert.doesNotMatch(JSON.stringify(result), /secret-not-returned/);
});
