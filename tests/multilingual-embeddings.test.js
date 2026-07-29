const test = require("node:test");
const assert = require("node:assert/strict");
const {
  embedDocuments,
  embeddingConfig,
  embeddingText,
} = require("../src/multilingual-embeddings");

test("builds multilingual embedding input from SEO evidence", () => {
  const text = embeddingText({
    language: "de",
    url: "https://example.com/pflege",
    title: "Pflege und Reinigung",
    description: "Hinweise zur Aufbewahrung",
    headings: ["Schonende Säuberung"],
    bodyText: "Das Produkt regelmäßig reinigen und sicher lagern",
    entities: ["Pflege", "Aufbewahrung"],
  });
  assert.match(text, /language de/);
  assert.match(text, /Pflege und Reinigung/);
  assert.match(text, /Schonende Säuberung/);
});

test("embeds a German batch without exposing credentials", async () => {
  const calls = [];
  const client = {
    embeddings: {
      create: async (payload) => {
        calls.push(payload);
        return {
          data: [
            { index: 0, embedding: [3, 4, 0] },
            { index: 1, embedding: [0, 4, 3] },
          ],
        };
      },
    },
  };
  const documents = [
    { urlHash: "a", language: "de", title: "Pflegeanleitung", bodyText: "Reinigung und Aufbewahrung" },
    { urlHash: "b", language: "de", title: "Richtig säubern", bodyText: "Säuberung und Lagerung" },
  ];
  const result = await embedDocuments(documents, {
    client,
    env: { OPENAI_EMBEDDING_MODEL: "BAAI/bge-m3" },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.length, 2);
  assert.equal(result.status.embedded, 2);
  assert.equal(result.documents[0].embedding.length, 3);
  assert.equal(result.documents[0].embeddingModel, "BAAI/bge-m3");
  assert.ok(Math.abs(result.documents[0].embedding[0] - 0.6) < 0.000001);
});

test("falls back safely when embedding is not configured", async () => {
  const result = await embedDocuments([{ urlHash: "a", title: "Test" }], {
    env: { OPENAI_EMBEDDING_ENABLED: "true", OPENAI_API_KEY: "" },
  });
  assert.equal(result.status.configured, false);
  assert.equal(result.status.fallback, 1);
  assert.equal(result.documents[0].embeddingStatus, "not_configured");
});

test("uses bge m3 as the default multilingual model", () => {
  const config = embeddingConfig({ OPENAI_API_KEY: "server-only" });
  assert.equal(config.model, "BAAI/bge-m3");
  assert.equal(config.dimensions, 1024);
});
test("redacts relay credentials when embedding falls back", async () => {
  const client = { embeddings: { create: async () => { throw new Error("Bearer sk-secret-value-123456789 failed"); } } };
  const result = await embedDocuments([{ urlHash: "a", title: "Test" }], {
    client,
    env: { OPENAI_EMBEDDING_MODEL: "BAAI/bge-m3" },
  });
  assert.equal(result.status.fallback, 1);
  assert.doesNotMatch(result.status.error, /sk-secret/);
  assert.match(result.status.error, /REDACTED/);
});
test("falls back to a compatible multilingual embedding model", async () => {
  const models = [];
  const client = {
    embeddings: {
      create: async (payload) => {
        models.push({ model: payload.model, dimensions: payload.dimensions });
        if (payload.model === "BAAI/bge-m3") throw new Error("503 unavailable");
        return { data: [{ index: 0, embedding: Array(1024).fill(0).map((_, index) => index === 0 ? 1 : 0) }] };
      },
    },
  };
  const result = await embedDocuments([{ urlHash: "a", language: "de", title: "Pflege" }], {
    client,
    env: {
      OPENAI_EMBEDDING_MODEL: "BAAI/bge-m3",
      OPENAI_EMBEDDING_FALLBACK_MODELS: "text-embedding-3-large",
      OPENAI_EMBEDDING_DIMENSIONS: "1024",
    },
  });
  assert.deepEqual(models, [
    { model: "BAAI/bge-m3", dimensions: undefined },
    { model: "text-embedding-3-large", dimensions: 1024 },
  ]);
  assert.equal(result.status.model, "text-embedding-3-large");
  assert.equal(result.status.embedded, 1);
  assert.equal(result.documents[0].embedding.length, 1024);
});
