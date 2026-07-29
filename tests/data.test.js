const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDataStore } = require("../src/data");
const { buildDemoSnapshot } = require("../src/demo");
const { generateReport } = require("../src/report");

test("keeps sites and reports isolated by tenant", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-hub-test-"));
  const store = createDataStore({
    databaseUrl: "",
    databasePath: path.join(dir, "test.sqlite"),
  });
  t.after(async () => {
    await store.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await store.init();
  const a = await store.createTenantAndOwner({
    organization: "A Team",
    name: "A",
    email: "a@example.com",
    passwordHash: "hash",
  });
  const b = await store.createTenantAndOwner({
    organization: "B Team",
    name: "B",
    email: "b@example.com",
    passwordHash: "hash",
  });
  const siteId = await store.insertSite({
    tenant_id: a.tenantId,
    name: "A Site",
    website_url: "https://a.example.com",
    status: "connected",
  });
  const site = await store.getSite(a.tenantId, siteId);
  assert.equal(site.name, "A Site");
  assert.equal(await store.getSite(b.tenantId, siteId), undefined);
  const snapshot = buildDemoSnapshot();
  for (let index = 0; index < 235; index += 1) {
    snapshot.current.ga4.landingPages.push({
      path: `/catalog/page-${String(index + 1).padStart(3, "0")}`,
      sessions: 1,
      users: 1,
      engagedSessions: index % 2,
      addToCarts: 0,
    });
  }
  const report = generateReport(snapshot, {
    name: site.name,
    websiteUrl: site.website_url,
  });
  const reportId = await store.saveSnapshotAndReport({
    tenantId: a.tenantId,
    site,
    snapshot,
    report,
  });
  const storedReportRow = await store.getReport(a.tenantId, reportId);
  assert.ok(storedReportRow);
  assert.equal(await store.getReport(b.tenantId, reportId), undefined);
  assert.equal(Object.hasOwn(JSON.parse(storedReportRow.report_json), "pageInventory"), false);
  const allPages = await store.listReportPages(a.tenantId, reportId);
  assert.equal(allPages.total, report.pageInventory.length);
  assert.equal(allPages.rows.length, 100);
  assert.ok(allPages.total > 200);
  const lastPage = await store.listReportPages(a.tenantId, reportId, { page: 3, pageSize: 100 });
  assert.equal(lastPage.page, 3);
  assert.equal(lastPage.totalPages, 3);
  assert.equal(lastPage.rows.length, allPages.total - 200);
  assert.equal((await store.listReportPages(b.tenantId, reportId)).total, 0);
  const gscPages = await store.listReportPages(a.tenantId, reportId, { source: "gsc", all: true });
  assert.ok(gscPages.total > 0);
  assert.ok(gscPages.rows.every((row) => row.source === "gsc"));
  const searchPages = await store.listReportPages(a.tenantId, reportId, { search: "hiking-backpacks", all: true });
  assert.ok(searchPages.total > 0);
  assert.ok(searchPages.rows.every((row) => [row.page, row.diagnosis, row.action].join(" ").toLowerCase().includes("hiking-backpacks")));
  const reportPage = allPages.rows[0];
  assert.ok(await store.getReportPage(a.tenantId, reportId, reportPage.id));
  assert.equal(await store.getReportPage(b.tenantId, reportId, reportPage.id), undefined);
  assert.ok(await store.getReportContext(a.tenantId, reportId));
  assert.equal(await store.getReportContext(b.tenantId, reportId), undefined);
  await store.savePageOptimization({
    tenantId: a.tenantId,
    siteId,
    reportId,
    reportPageId: reportPage.id,
    userId: a.userId,
    status: "completed",
    result: { summary: "Tenant A only", scores: { overall: 80 } },
  });
  const savedOptimization = await store.getPageOptimization(a.tenantId, reportId, reportPage.id);
  assert.equal(savedOptimization.result.summary, "Tenant A only");
  assert.equal(await store.getPageOptimization(b.tenantId, reportId, reportPage.id), null);
  await store.resetCannibalizationRun({ tenantId: a.tenantId, siteId, reportId, mainLanguage: "en", candidates: [{ id: reportPage.id, url: reportPage.url }], discovery: { sitemapPages: 1 } });
  await store.upsertCannibalizationDocument({
    tenantId: a.tenantId,
    siteId,
    reportId,
    document: { reportPageId: reportPage.id, url: reportPage.url, urlHash: "a".repeat(64), language: "en", status: 200, tokens: ["example"], vector: [1], entities: ["example"] },
  });
  await store.updateCannibalizationRun({ tenantId: a.tenantId, reportId, status: "completed", result: { findings: [] } });
  assert.equal((await store.listCannibalizationDocuments(a.tenantId, reportId)).length, 1);
  assert.equal((await store.listCannibalizationDocuments(b.tenantId, reportId)).length, 0);
  const cannibalizationRun = await store.getCannibalizationRun(a.tenantId, reportId);
  assert.equal(cannibalizationRun.result.findings.length, 0);
  assert.equal(cannibalizationRun.candidates.length, 1);
  assert.equal(cannibalizationRun.discovery.sitemapPages, 1);
  const candidateBatch = await store.getCannibalizationCandidateBatch(a.tenantId, reportId, 0, 1);
  assert.equal(candidateBatch.length, 1);
  assert.equal(candidateBatch[0].url, reportPage.url);
  assert.equal(await store.getCannibalizationRun(b.tenantId, reportId), null);
  const taskId = await store.createTask({
    tenant_id: a.tenantId,
    site_id: siteId,
    report_id: reportId,
    title: "Optimize landing page",
    priority: "P1",
    status: "todo",
  });
  assert.ok(await store.getTask(a.tenantId, taskId));
  assert.equal(await store.getTask(b.tenantId, taskId), undefined);
  assert.equal((await store.listTasks(a.tenantId)).length, 1);
  assert.equal((await store.listTasks(b.tenantId)).length, 0);
  await store.updateSite(a.tenantId, siteId, { brand_terms: "A Brand", sync_days: 90 });
  const updatedSite = await store.getSite(a.tenantId, siteId);
  assert.equal(updatedSite.brand_terms, "A Brand");
  assert.equal(updatedSite.sync_days, 90);
});
