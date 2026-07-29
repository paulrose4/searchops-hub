const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.lan");
const relayUrl = String(process.env.GOOGLE_RELAY_URL || "").replace(/\/$/, "");
const relaySecret = String(process.env.GOOGLE_RELAY_SECRET || "");

if (!fs.existsSync(envPath)) throw new Error(".env.lan is missing");
if (!relayUrl.startsWith("https://"))
  throw new Error("GOOGLE_RELAY_URL must use HTTPS");
if (Buffer.byteLength(relaySecret, "utf8") < 32)
  throw new Error("GOOGLE_RELAY_SECRET must contain at least 32 bytes");

const current = dotenv.parse(fs.readFileSync(envPath, "utf8"));
current.GOOGLE_RELAY_URL = relayUrl;
current.GOOGLE_RELAY_SECRET = relaySecret;

const output = Object.entries(current)
  .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, "")}`)
  .join("\n");
fs.writeFileSync(envPath, output + "\n", { mode: 0o600 });
console.log(`Google OAuth relay configured at ${relayUrl}`);
