const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, ".env.lan");

function privateIpv4() {
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses || []).map((address) => ({ name, ...address })),
    )
    .filter(
      (item) =>
        item.family === "IPv4" &&
        !item.internal &&
        (/^10\./.test(item.address) ||
          /^192\.168\./.test(item.address) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(item.address)),
    )
    .sort((a, b) => {
      const virtual = /wsl|docker|virtual|vethernet|tap|vpn/i;
      return Number(virtual.test(a.name)) - Number(virtual.test(b.name));
    });
  return candidates[0]?.address || "127.0.0.1";
}

if (fs.existsSync(outputPath) && !process.argv.includes("--force")) {
  console.log(".env.lan already exists; no changes were made.");
  process.exit(0);
}

const ip = process.env.LAN_IP || privateIpv4();
const accessCode = `staff-${crypto.randomBytes(12).toString("base64url")}`;
const values = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: process.env.PORT || "3210",
  APP_BASE_URL: `http://${ip}:${process.env.PORT || "3210"}`,
  SESSION_COOKIE_SECURE: "false",
  DATABASE_URL: "",
  DATABASE_PATH: "./data/searchops-hub-lan.sqlite",
  SESSION_DATABASE_PATH: "./data/searchops-hub-lan.sessions.sqlite",
  SKIP_DATABASE_INIT: "false",
  REGISTRATION_ACCESS_CODE: accessCode,
  REGISTRATION_ALLOWED_DOMAINS: "",
  SESSION_SECRET: crypto.randomBytes(48).toString("base64url"),
  TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_MODEL: "gpt-4.1-mini",
  OPENAI_EMBEDDING_ENABLED: "false",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
  OPENAI_EMBEDDING_FALLBACK_MODELS: "",
  OPENAI_EMBEDDING_DIMENSIONS: "1024",
  OPENAI_EMBEDDING_TIMEOUT_MS: "45000",
  OPENAI_API_MODE: "responses",
  ENABLE_DEMO_ACCOUNT: "false",
};

const content = Object.entries(values)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");
fs.writeFileSync(outputPath, content + "\n", { mode: 0o600, flag: "w" });

console.log(`LAN configuration created for http://${ip}:${values.PORT}`);
console.log(`Internal registration code: ${accessCode}`);
console.log("Keep .env.lan private and back it up with the SQLite database.");
