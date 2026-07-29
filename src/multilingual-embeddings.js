const OpenAI = require("openai");

const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
const MAX_EMBEDDING_TEXT = 12000;
let circuitOpenUntil = 0;
let circuitError = "";
let preferredModel = "";

function compact(value, max = MAX_EMBEDDING_TEXT) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function embeddingConfig(env = process.env) {
  const enabledValue = String(env.OPENAI_EMBEDDING_ENABLED || "true").trim().toLowerCase();
  return {
    enabled: !["0", "false", "off", "no"].includes(enabledValue),
    apiKey: String(env.OPENAI_API_KEY || "").trim(),
    baseURL: String(env.OPENAI_BASE_URL || "").trim().replace(/\/+$/, ""),
    model: String(env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim(),
    fallbackModels: String(env.OPENAI_EMBEDDING_FALLBACK_MODELS || "text-embedding-3-large,multilingual-e5-large").split(",").map((item) => item.trim()).filter(Boolean),
    dimensions: Number(env.OPENAI_EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS),
    timeoutMs: Math.max(5000, Math.min(120000, Number(env.OPENAI_EMBEDDING_TIMEOUT_MS || 45000))),
  };
}

function embeddingText(document) {
  return compact([
    `language ${document.language || "unknown"}`,
    `url ${document.url || ""}`,
    `title ${document.title || ""}`,
    `description ${document.description || ""}`,
    `headings ${(document.headings || []).join(" ")}`,
    `content ${document.bodyText || ""}`,
    `entities ${(document.entities || []).join(" ")}`,
  ].join("\n"));
}

function normalizeVector(value) {
  if (!Array.isArray(value) || !value.length) return [];
  const vector = value.map(Number);
  if (vector.some((item) => !Number.isFinite(item))) return [];
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!norm) return [];
  return vector.map((item) => Number((item / norm).toFixed(8)));
}

function safeEmbeddingError(error) {
  return compact(error?.message || error || "Embedding request failed", 240)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

async function embedDocuments(documents, { client, env = process.env } = {}) {
  const config = embeddingConfig(env);
  if (!documents.length) return { documents, status: { enabled: config.enabled, configured: Boolean(config.apiKey || client), model: config.model, embedded: 0, fallback: 0 } };
  if (!config.enabled || (!config.apiKey && !client)) {
    return {
      documents: documents.map((document) => ({ ...document, embedding: [], embeddingModel: "", embeddingStatus: config.enabled ? "not_configured" : "disabled" })),
      status: { enabled: config.enabled, configured: false, model: config.model, embedded: 0, fallback: documents.length },
    };
  }

  if (!client && circuitOpenUntil > Date.now()) {
    return {
      documents: documents.map((document) => ({ ...document, embedding: [], embeddingModel: config.model, embeddingStatus: "fallback", embeddingError: circuitError })),
      status: { enabled: true, configured: true, model: config.model, embedded: 0, fallback: documents.length, error: circuitError, circuitOpen: true },
    };
  }

  const openai = client || new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || undefined,
    timeout: config.timeoutMs,
    maxRetries: 1,
  });
  const models = [...new Set([preferredModel, config.model, ...config.fallbackModels].filter(Boolean))];
  const errors = [];
  for (const model of models) {
    try {
      const request = {
        model,
        input: documents.map(embeddingText),
        encoding_format: "float",
      };
      if (/^text-embedding-3-/i.test(model)) request.dimensions = config.dimensions;
      const response = await openai.embeddings.create(request);
      const rows = [...(response.data || [])].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
      if (rows.length !== documents.length) throw new Error(`Embedding 返回数量异常 ${rows.length}/${documents.length}`);
      const enriched = documents.map((document, index) => {
        const embedding = normalizeVector(rows[index]?.embedding);
        if (!embedding.length) return { ...document, embedding: [], embeddingModel: model, embeddingStatus: "invalid" };
        return { ...document, embedding, embeddingModel: model, embeddingStatus: "completed" };
      });
      const embedded = enriched.filter((document) => document.embeddingStatus === "completed").length;
      if (!embedded) throw new Error("Embedding 返回了空向量");
      preferredModel = model;
      circuitOpenUntil = 0;
      circuitError = "";
      return {
        documents: enriched,
        status: { enabled: true, configured: true, model, dimensions: enriched.find((document) => document.embedding?.length)?.embedding.length || 0, embedded, fallback: documents.length - embedded },
      };
    } catch (error) {
      errors.push(`${model}: ${safeEmbeddingError(error)}`);
    }
  }
  const message = compact(errors.join(" | "), 500);
  if (!client) {
    circuitError = message;
    circuitOpenUntil = Date.now() + 5 * 60 * 1000;
  }
  return {
    documents: documents.map((document) => ({ ...document, embedding: [], embeddingModel: config.model, embeddingStatus: "fallback", embeddingError: message })),
    status: { enabled: true, configured: true, model: config.model, attemptedModels: models, embedded: 0, fallback: documents.length, error: message },
  };
}

async function probeMultilingualEmbeddings({ client, env = process.env } = {}) {
  const samples = [
    { language: "de", url: "https://example.com/ratgeber", title: "Pflegeanleitung", description: "Tipps zur richtigen Pflege", headings: ["Reinigung und Aufbewahrung"], bodyText: "Wie Sie das Produkt reinigen und dauerhaft schützen", entities: ["Pflege", "Reinigung"] },
    { language: "de", url: "https://example.com/pflege", title: "Produkt richtig reinigen", description: "Hinweise für Reinigung und Lagerung", headings: ["Schonende Säuberung"], bodyText: "Anleitung zur Säuberung Pflege und sicheren Aufbewahrung", entities: ["Säuberung", "Aufbewahrung"] },
  ];
  const result = await embedDocuments(samples, { client, env });
  if (result.status.embedded !== samples.length) throw new Error(result.status.error || "Embedding 探测失败");
  return result.status;
}

module.exports = {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  embedDocuments,
  embeddingConfig,
  embeddingText,
  normalizeVector,
  probeMultilingualEmbeddings,
  safeEmbeddingError,
};