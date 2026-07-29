const path = require("node:path");
require("dotenv").config({
  path: process.env.ENV_FILE || path.resolve(".env.cloud"),
});
const { createDataStore } = require("../src/data");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const store = createDataStore({
    databaseUrl: process.env.DATABASE_URL,
    databasePath: "",
  });
  await store.init();
  const stamp = Date.now();
  const a = await store.createTenantAndOwner({
    organization: "Cloud Verify A " + stamp,
    name: "A",
    email: "cloud-a-" + stamp + "@example.com",
    passwordHash: "verify",
  });
  const b = await store.createTenantAndOwner({
    organization: "Cloud Verify B " + stamp,
    name: "B",
    email: "cloud-b-" + stamp + "@example.com",
    passwordHash: "verify",
  });
  const siteId = await store.insertSite({
    tenant_id: a.tenantId,
    name: "Cloud Test Site",
    website_url: "https://example.com",
    status: "pending",
  });
  if (!(await store.getSite(a.tenantId, siteId)))
    throw new Error("Owner tenant cannot read its site");
  if (await store.getSite(b.tenantId, siteId))
    throw new Error("Tenant isolation failed");
  await store.db("tenants").whereIn("id", [a.tenantId, b.tenantId]).delete();
  console.log("Neon schema and tenant isolation verified.");
  await store.destroy();
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
