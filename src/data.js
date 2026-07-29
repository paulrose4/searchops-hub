const fs = require("node:fs");
const path = require("node:path");
const knexFactory = require("knex");

function createDataStore({ databaseUrl, databasePath }) {
  const isPostgres = Boolean(databaseUrl);
  if (!isPostgres)
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = knexFactory(
    isPostgres
      ? {
          client: "pg",
          connection: {
            connectionString: databaseUrl.replace(
              "sslmode=require",
              "sslmode=verify-full",
            ),
            ssl: { rejectUnauthorized: false },
          },
          pool: { min: 0, max: 5 },
        }
      : {
          client: "better-sqlite3",
          connection: { filename: databasePath },
          useNullAsDefault: true,
        },
  );
  let vectorSearchAvailable = false;

  async function init() {
    if (!(await db.schema.hasTable("tenants"))) {
      await db.schema.createTable("tenants", (t) => {
        t.increments("id").primary();
        t.string("name").notNullable();
        t.string("slug").notNullable().unique();
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      });
    }
    if (!(await db.schema.hasTable("users"))) {
      await db.schema.createTable("users", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id")
          .notNullable()
          .references("id")
          .inTable("tenants")
          .onDelete("CASCADE");
        t.string("name").notNullable();
        t.string("email").notNullable().unique();
        t.text("password_hash").notNullable();
        t.string("role").notNullable().defaultTo("member");
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.index(["tenant_id"]);
      });
    }
    if (!(await db.schema.hasTable("google_connections"))) {
      await db.schema.createTable("google_connections", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id")
          .notNullable()
          .references("id")
          .inTable("tenants")
          .onDelete("CASCADE");
        t.integer("user_id")
          .notNullable()
          .references("id")
          .inTable("users")
          .onDelete("CASCADE");
        t.string("google_email");
        t.text("encrypted_tokens").notNullable();
        t.text("scopes").notNullable();
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
        t.unique(["tenant_id", "user_id"]);
      });
    }
    if (!(await db.schema.hasTable("sites"))) {
      await db.schema.createTable("sites", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id")
          .notNullable()
          .references("id")
          .inTable("tenants")
          .onDelete("CASCADE");
        t.integer("connection_id")
          .references("id")
          .inTable("google_connections")
          .onDelete("SET NULL");
        t.string("name").notNullable();
        t.text("website_url").notNullable();
        t.string("ga4_property_id");
        t.string("ga4_property_name");
        t.text("gsc_site_url");
        t.string("status").notNullable().defaultTo("pending");
        t.text("last_error");
        t.timestamp("last_synced_at");
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
        t.index(["tenant_id"]);
      });
    }
    const siteColumns = [
      ["timezone", (t) => t.string("timezone").notNullable().defaultTo("UTC")],
      ["target_markets", (t) => t.text("target_markets").notNullable().defaultTo("")],
      ["brand_terms", (t) => t.text("brand_terms").notNullable().defaultTo("")],
      ["sync_days", (t) => t.integer("sync_days").notNullable().defaultTo(28)],
      ["archived", (t) => t.boolean("archived").notNullable().defaultTo(false)],
    ];
    for (const [column, add] of siteColumns) {
      if (!(await db.schema.hasColumn("sites", column))) {
        await db.schema.alterTable("sites", add);
      }
    }
    if (!(await db.schema.hasTable("snapshots"))) {
      await db.schema.createTable("snapshots", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id")
          .notNullable()
          .references("id")
          .inTable("tenants")
          .onDelete("CASCADE");
        t.integer("site_id")
          .notNullable()
          .references("id")
          .inTable("sites")
          .onDelete("CASCADE");
        t.string("period_start").notNullable();
        t.string("period_end").notNullable();
        t.string("previous_start").notNullable();
        t.string("previous_end").notNullable();
        t.text("data_json").notNullable();
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
      });
    }
    if (!(await db.schema.hasTable("reports"))) {
      await db.schema.createTable("reports", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id")
          .notNullable()
          .references("id")
          .inTable("tenants")
          .onDelete("CASCADE");
        t.integer("site_id")
          .notNullable()
          .references("id")
          .inTable("sites")
          .onDelete("CASCADE");
        t.integer("snapshot_id")
          .notNullable()
          .references("id")
          .inTable("snapshots")
          .onDelete("CASCADE");
        t.text("report_json").notNullable();
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.index(["tenant_id", "site_id", "created_at"]);
      });
    }
    if (!(await db.schema.hasTable("seo_tasks"))) {
      await db.schema.createTable("seo_tasks", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id").notNullable().references("id").inTable("tenants").onDelete("CASCADE");
        t.integer("site_id").notNullable().references("id").inTable("sites").onDelete("CASCADE");
        t.integer("report_id").references("id").inTable("reports").onDelete("SET NULL");
        t.integer("created_by_user_id").references("id").inTable("users").onDelete("SET NULL");
        t.integer("assignee_user_id").references("id").inTable("users").onDelete("SET NULL");
        t.string("priority").notNullable().defaultTo("P2");
        t.string("status").notNullable().defaultTo("todo");
        t.text("title").notNullable();
        t.text("target_url");
        t.text("query");
        t.string("country");
        t.text("evidence");
        t.text("action");
        t.text("target");
        t.string("due_date");
        t.string("launched_at");
        t.timestamp("completed_at");
        t.text("result_note");
        t.text("baseline_json");
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
        t.index(["tenant_id", "status", "priority"]);
        t.index(["tenant_id", "site_id"]);
      });
    }
    if (!(await db.schema.hasTable("report_pages"))) {
      await db.schema.createTable("report_pages", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id").notNullable().references("id").inTable("tenants").onDelete("CASCADE");
        t.integer("site_id").notNullable().references("id").inTable("sites").onDelete("CASCADE");
        t.integer("report_id").notNullable().references("id").inTable("reports").onDelete("CASCADE");
        t.text("page").notNullable();
        t.text("url").notNullable();
        t.string("source").notNullable();
        t.string("priority").notNullable();
        t.integer("sessions").notNullable().defaultTo(0);
        t.integer("users").notNullable().defaultTo(0);
        t.integer("engaged_sessions").notNullable().defaultTo(0);
        t.integer("add_to_carts").notNullable().defaultTo(0);
        t.float("add_to_cart_density").notNullable().defaultTo(0);
        t.integer("gsc_clicks").notNullable().defaultTo(0);
        t.integer("gsc_impressions").notNullable().defaultTo(0);
        t.float("gsc_ctr").notNullable().defaultTo(0);
        t.float("gsc_position").notNullable().defaultTo(0);
        t.boolean("audited").notNullable().defaultTo(false);
        t.integer("audit_status").notNullable().defaultTo(0);
        t.text("audit_issues");
        t.text("diagnosis");
        t.text("action");
        t.text("evidence");
        t.index(["tenant_id", "report_id", "priority"]);
        t.index(["tenant_id", "site_id"]);
      });
    }
    if (!(await db.schema.hasTable("page_optimizations"))) {
      await db.schema.createTable("page_optimizations", (t) => {
        t.increments("id").primary();
        t.integer("tenant_id").notNullable().references("id").inTable("tenants").onDelete("CASCADE");
        t.integer("site_id").notNullable().references("id").inTable("sites").onDelete("CASCADE");
        t.integer("report_id").notNullable().references("id").inTable("reports").onDelete("CASCADE");
        t.integer("report_page_id").notNullable().references("id").inTable("report_pages").onDelete("CASCADE");
        t.integer("created_by_user_id").references("id").inTable("users").onDelete("SET NULL");
        t.string("status").notNullable().defaultTo("completed");
        t.text("result_json");
        t.text("error");
        t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
        t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
        t.unique(["tenant_id", "report_page_id"]);
        t.index(["tenant_id", "report_id"]);
      });
    }
    await db.raw("CREATE UNIQUE INDEX IF NOT EXISTS page_optimizations_tenant_page_unique ON page_optimizations (tenant_id, report_page_id)");
    if (isPostgres) {
      await db.raw(`
        CREATE TABLE IF NOT EXISTS cannibalization_documents (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          report_page_id INTEGER REFERENCES report_pages(id) ON DELETE SET NULL,
          url_hash VARCHAR(64) NOT NULL,
          url TEXT NOT NULL,
          language VARCHAR(20), intent VARCHAR(40), status VARCHAR(30) NOT NULL DEFAULT 'included',
          excluded_reason TEXT, vector_json TEXT, embedding_json TEXT, embedding_model VARCHAR(200), tokens_json TEXT, entities_json TEXT, document_json TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, report_id, url_hash)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS cannibalization_documents_tenant_report_url_hash_unique
          ON cannibalization_documents (tenant_id, report_id, url_hash);
        CREATE INDEX IF NOT EXISTS cannibalization_documents_tenant_report_status_index
          ON cannibalization_documents (tenant_id, report_id, status);
        CREATE TABLE IF NOT EXISTS cannibalization_runs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          status VARCHAR(30) NOT NULL DEFAULT 'pending', main_language VARCHAR(20),
          total_candidates INTEGER NOT NULL DEFAULT 0, processed_pages INTEGER NOT NULL DEFAULT 0,
          included_pages INTEGER NOT NULL DEFAULT 0, excluded_pages INTEGER NOT NULL DEFAULT 0,
          candidate_json TEXT, discovery_json TEXT, result_json TEXT, error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, report_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS cannibalization_runs_tenant_report_unique
          ON cannibalization_runs (tenant_id, report_id);
        ALTER TABLE cannibalization_documents ADD COLUMN IF NOT EXISTS embedding_json TEXT;
        ALTER TABLE cannibalization_documents ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(200);
        ALTER TABLE cannibalization_runs ADD COLUMN IF NOT EXISTS candidate_json TEXT;
        ALTER TABLE cannibalization_runs ADD COLUMN IF NOT EXISTS discovery_json TEXT;
      `);
      try {
        await db.raw(`
          CREATE EXTENSION IF NOT EXISTS vector;
          ALTER TABLE cannibalization_documents ADD COLUMN IF NOT EXISTS embedding_vector vector(1024);
          CREATE INDEX IF NOT EXISTS cannibalization_documents_embedding_hnsw
            ON cannibalization_documents USING hnsw (embedding_vector vector_cosine_ops);
        `);
        vectorSearchAvailable = true;
      } catch (error) {
        vectorSearchAvailable = false;
        console.warn("Multilingual vector search unavailable", { code: error.code || "VECTOR_INIT_FAILED" });
      }
    } else {
      if (!(await db.schema.hasTable("cannibalization_documents"))) {
        await db.schema.createTable("cannibalization_documents", (t) => {
          t.increments("id").primary();
          t.integer("tenant_id").notNullable().references("id").inTable("tenants").onDelete("CASCADE");
          t.integer("site_id").notNullable().references("id").inTable("sites").onDelete("CASCADE");
          t.integer("report_id").notNullable().references("id").inTable("reports").onDelete("CASCADE");
          t.integer("report_page_id").references("id").inTable("report_pages").onDelete("SET NULL");
          t.string("url_hash", 64).notNullable();
          t.text("url").notNullable();
          t.string("language", 20); t.string("intent", 40); t.string("status", 30).notNullable().defaultTo("included");
          t.text("excluded_reason"); t.text("vector_json"); t.text("embedding_json"); t.string("embedding_model", 200); t.text("tokens_json"); t.text("entities_json"); t.text("document_json");
          t.timestamp("created_at").notNullable().defaultTo(db.fn.now());
          t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
          t.unique(["tenant_id", "report_id", "url_hash"]);
          t.index(["tenant_id", "report_id", "status"]);
        });
      }
      if (!(await db.schema.hasTable("cannibalization_runs"))) {
        await db.schema.createTable("cannibalization_runs", (t) => {
          t.increments("id").primary();
          t.integer("tenant_id").notNullable().references("id").inTable("tenants").onDelete("CASCADE");
          t.integer("site_id").notNullable().references("id").inTable("sites").onDelete("CASCADE");
          t.integer("report_id").notNullable().references("id").inTable("reports").onDelete("CASCADE");
          t.string("status", 30).notNullable().defaultTo("pending"); t.string("main_language", 20);
          t.integer("total_candidates").notNullable().defaultTo(0); t.integer("processed_pages").notNullable().defaultTo(0);
          t.integer("included_pages").notNullable().defaultTo(0); t.integer("excluded_pages").notNullable().defaultTo(0);
          t.text("candidate_json"); t.text("discovery_json"); t.text("result_json"); t.text("error");
          t.timestamp("created_at").notNullable().defaultTo(db.fn.now()); t.timestamp("updated_at").notNullable().defaultTo(db.fn.now());
          t.unique(["tenant_id", "report_id"]);
        });
      }
      for (const [column, type] of [["embedding_json", "text"], ["embedding_model", "string"]]) {
        if (!(await db.schema.hasColumn("cannibalization_documents", column))) {
          await db.schema.alterTable("cannibalization_documents", (t) => type === "string" ? t.string(column, 200) : t.text(column));
        }
      }
      for (const column of ["candidate_json", "discovery_json"]) {
        if (!(await db.schema.hasColumn("cannibalization_runs", column))) await db.schema.alterTable("cannibalization_runs", (t) => t.text(column));
      }
    }
  }

  const idOf = (rows) => Number(rows[0]?.id ?? rows[0]);
  async function uniqueSlug(name, conn = db) {
    const base =
      String(name || "workspace")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "") || "workspace";
    let slug = base,
      suffix = 1;
    while (await conn("tenants").where({ slug }).first("id"))
      slug = base + "-" + suffix++;
    return slug;
  }
  async function createTenantAndOwner({
    organization,
    name,
    email,
    passwordHash,
  }) {
    return db.transaction(async (trx) => {
      const tenantId = idOf(
        await trx("tenants")
          .insert({
            name: organization,
            slug: await uniqueSlug(organization, trx),
          })
          .returning("id"),
      );
      const userId = idOf(
        await trx("users")
          .insert({
            tenant_id: tenantId,
            name,
            email: email.toLowerCase(),
            password_hash: passwordHash,
            role: "owner",
          })
          .returning("id"),
      );
      return { tenantId, userId };
    });
  }
  async function saveSnapshotAndReport({ tenantId, site, snapshot, report }) {
    const pageInventory = Array.isArray(report.pageInventory) ? report.pageInventory : [];
    const storedReport = { ...report };
    delete storedReport.pageInventory;
    return db.transaction(async (trx) => {
      const snapshotId = idOf(
        await trx("snapshots")
          .insert({
            tenant_id: tenantId,
            site_id: site.id,
            period_start: snapshot.period.start,
            period_end: snapshot.period.end,
            previous_start: snapshot.previousPeriod.start,
            previous_end: snapshot.previousPeriod.end,
            data_json: JSON.stringify(snapshot),
          })
          .returning("id"),
      );
      const reportId = idOf(
        await trx("reports")
          .insert({
            tenant_id: tenantId,
            site_id: site.id,
            snapshot_id: snapshotId,
            report_json: JSON.stringify(storedReport),
          })
          .returning("id"),
      );
      for (let index = 0; index < pageInventory.length; index += 250) {
        const chunk = pageInventory.slice(index, index + 250).map((page) => ({
          tenant_id: tenantId,
          site_id: site.id,
          report_id: reportId,
          page: String(page.page || page.url || ""),
          url: String(page.url || ""),
          source: String(page.source || ""),
          priority: String(page.priority || "P3"),
          sessions: Math.round(Number(page.sessions || 0)),
          users: Math.round(Number(page.users || 0)),
          engaged_sessions: Math.round(Number(page.engagedSessions || 0)),
          add_to_carts: Math.round(Number(page.addToCarts || 0)),
          add_to_cart_density: Number(page.addToCartDensity || 0),
          gsc_clicks: Math.round(Number(page.gscClicks || 0)),
          gsc_impressions: Math.round(Number(page.gscImpressions || 0)),
          gsc_ctr: Number(page.gscCtr || 0),
          gsc_position: Number(page.gscPosition || 0),
          audited: Boolean(page.audited),
          audit_status: Math.round(Number(page.auditStatus || 0)),
          audit_issues: JSON.stringify(page.auditIssues || []),
          diagnosis: String(page.diagnosis || ""),
          action: String(page.action || ""),
          evidence: String(page.evidence || "")
        }));
        if (chunk.length) await trx("report_pages").insert(chunk);
      }
      await trx("sites").where({ id: site.id, tenant_id: tenantId }).update({
        status: "connected",
        last_error: null,
        last_synced_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return reportId;
    });
  }
  async function listSites(tenantId) {
    const sites = await db("sites")
      .where({ tenant_id: tenantId })
      .orderBy("id", "desc");
    for (const site of sites)
      site.report_id =
        (
          await db("reports")
            .where({ tenant_id: tenantId, site_id: site.id })
            .orderBy("id", "desc")
            .first("id")
        )?.id || null;
    return sites;
  }
  async function listReportPages(tenantId, reportId, filters = {}) {
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(200, Math.max(10, Number(filters.pageSize || 100)));
    const search = String(filters.search || "").trim().toLowerCase().slice(0, 200);
    const query = db("report_pages").where({ tenant_id: tenantId, report_id: reportId });
    if (["both", "ga4", "gsc"].includes(filters.source)) query.andWhere("source", filters.source);
    if (["P1", "P2", "P3"].includes(filters.priority)) query.andWhere("priority", filters.priority);
    if (search) {
      query.andWhere(function () {
        this.whereRaw("LOWER(page) LIKE ?", [`%${search}%`])
          .orWhereRaw("LOWER(diagnosis) LIKE ?", [`%${search}%`])
          .orWhereRaw("LOWER(action) LIKE ?", [`%${search}%`]);
      });
    }
    const countRow = await query.clone().clearSelect().clearOrder().count({ count: "id" }).first();
    const total = Number(countRow?.count || 0);
    const rows = await query
      .clone()
      .select("*")
      .orderByRaw("CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END")
      .orderByRaw("(sessions * 10 + gsc_clicks * 20 + gsc_impressions) DESC")
      .modify((builder) => {
        if (!filters.all) builder.limit(pageSize).offset((page - 1) * pageSize);
      });
    return {
      rows: rows.map((row) => ({
        ...row,
        auditIssues: (() => {
          try { return JSON.parse(row.audit_issues || "[]"); } catch { return []; }
        })()
      })),
      total,
      page,
      pageSize,
      totalPages: filters.all ? 1 : Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async function getReportPage(tenantId, reportId, pageId) {
    return db("report_pages")
      .where({ tenant_id: tenantId, report_id: reportId, id: pageId })
      .first();
  }

  async function getReportContext(tenantId, reportId) {
    return db("reports")
      .join("snapshots", "snapshots.id", "reports.snapshot_id")
      .join("sites", "sites.id", "reports.site_id")
      .where({ "reports.tenant_id": tenantId, "reports.id": reportId })
      .first(
        "reports.id as report_id",
        "reports.site_id",
        "snapshots.data_json",
        "sites.name as site_name",
        "sites.website_url",
        "sites.target_markets",
        "sites.brand_terms",
        "sites.timezone",
      );
  }

  async function savePageOptimization({ tenantId, siteId, reportId, reportPageId, userId, status, result, error }) {
    const payload = {
      tenant_id: tenantId,
      site_id: siteId,
      report_id: reportId,
      report_page_id: reportPageId,
      created_by_user_id: userId || null,
      status: status || "completed",
      result_json: result ? JSON.stringify(result) : null,
      error: error || null,
      updated_at: db.fn.now(),
    };
    await db("page_optimizations")
      .insert(payload)
      .onConflict(["tenant_id", "report_page_id"])
      .merge(payload);
    return getPageOptimization(tenantId, reportId, reportPageId);
  }

  async function getPageOptimization(tenantId, reportId, reportPageId) {
    const row = await db("page_optimizations")
      .where({ tenant_id: tenantId, report_id: reportId, report_page_id: reportPageId })
      .first();
    if (!row) return null;
    let result = null;
    try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch {}
    return { ...row, result };
  }

  async function resetCannibalizationRun({ tenantId, siteId, reportId, mainLanguage, candidates = [], discovery = {} }) {
    await db.transaction(async (trx) => {
      await trx("cannibalization_documents").where({ tenant_id: tenantId, report_id: reportId }).del();
      const payload = {
        tenant_id: tenantId,
        site_id: siteId,
        report_id: reportId,
        status: "scanning",
        main_language: mainLanguage,
        total_candidates: candidates.length,
        processed_pages: 0,
        included_pages: 0,
        excluded_pages: 0,
        result_json: null,
        candidate_json: JSON.stringify(candidates),
        discovery_json: JSON.stringify(discovery),
        error: null,
        updated_at: trx.fn.now(),
      };
      await trx("cannibalization_runs").insert(payload).onConflict(["tenant_id", "report_id"]).merge(payload);
    });
    return getCannibalizationRun(tenantId, reportId, { includeCandidates: false });
  }

  async function getCannibalizationRun(tenantId, reportId, { includeCandidates = true } = {}) {
    const query = db("cannibalization_runs").where({ tenant_id: tenantId, report_id: reportId });
    const row = includeCandidates
      ? await query.first()
      : await query.first(
        "id", "tenant_id", "site_id", "report_id", "status", "main_language",
        "total_candidates", "processed_pages", "included_pages", "excluded_pages",
        "discovery_json", "result_json", "error", "created_at", "updated_at",
      );
    if (!row) return null;
    let result = null;
    let candidates = [];
    let discovery = {};
    try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch {}
    if (includeCandidates) {
      try { candidates = row.candidate_json ? JSON.parse(row.candidate_json) : []; } catch {}
    }
    try { discovery = row.discovery_json ? JSON.parse(row.discovery_json) : {}; } catch {}
    return { ...row, result, candidates, discovery };
  }

  async function getCannibalizationCandidateBatch(tenantId, reportId, offset, limit = 12) {
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 12));
    if (!isPostgres) {
      const run = await getCannibalizationRun(tenantId, reportId);
      return run?.candidates?.slice(safeOffset, safeOffset + safeLimit) || [];
    }
    const result = await db.raw(`
      SELECT candidate.value AS candidate
      FROM cannibalization_runs AS run
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.candidate_json, '[]')::jsonb)
        WITH ORDINALITY AS candidate(value, ordinal)
      WHERE run.tenant_id = ?
        AND run.report_id = ?
        AND candidate.ordinal > ?
      ORDER BY candidate.ordinal
      LIMIT ?
    `, [tenantId, reportId, safeOffset, safeLimit]);
    return (result.rows || []).map((row) => row.candidate).filter(Boolean);
  }
  async function upsertCannibalizationDocument({ tenantId, siteId, reportId, document }) {
    const payload = {
      tenant_id: tenantId,
      site_id: siteId,
      report_id: reportId,
      report_page_id: document.reportPageId || null,
      url_hash: document.urlHash,
      url: document.url,
      language: document.language || null,
      intent: document.intent || null,
      status: document.excludedReason ? "excluded" : "included",
      excluded_reason: document.excludedReason || null,
      vector_json: JSON.stringify(document.vector || []),
      embedding_json: JSON.stringify(document.embedding || []),
      embedding_model: document.embeddingModel || null,
      tokens_json: JSON.stringify(document.tokens || []),
      entities_json: JSON.stringify(document.entities || []),
      document_json: JSON.stringify(document),
      updated_at: db.fn.now(),
    };
    await db("cannibalization_documents").insert(payload).onConflict(["tenant_id", "report_id", "url_hash"]).merge(payload);
    if (vectorSearchAvailable) {
      const embedding = Array.isArray(document.embedding) && document.embedding.length === 1024
        ? `[${document.embedding.join(",")}]`
        : null;
      await db.raw(
        "UPDATE cannibalization_documents SET embedding_vector = ?::vector WHERE tenant_id = ? AND report_id = ? AND url_hash = ?",
        [embedding, tenantId, reportId, document.urlHash],
      );
    }
  }

  async function listCannibalizationDocuments(tenantId, reportId) {
    const rows = await db("cannibalization_documents").where({ tenant_id: tenantId, report_id: reportId }).orderBy("id");
    return rows.map((row) => {
      let document = {};
      let embedding = [];
      try { document = JSON.parse(row.document_json || "{}"); } catch {}
      try { embedding = row.embedding_json ? JSON.parse(row.embedding_json) : []; } catch {}
      return {
        ...document,
        embedding: document.embedding || embedding,
        embeddingModel: document.embeddingModel || row.embedding_model || "",
        excludedReason: row.excluded_reason || document.excludedReason || "",
      };
    });
  }

  async function listCannibalizationSemanticPairs(tenantId, reportId, { limit = 8, minSimilarity = 0.55 } = {}) {
    if (!vectorSearchAvailable) return [];
    const result = await db.raw(`
      WITH nearest AS (
        SELECT
          CASE WHEN source.id < target.id THEN source.url_hash ELSE target.url_hash END AS left_hash,
          CASE WHEN source.id < target.id THEN target.url_hash ELSE source.url_hash END AS right_hash,
          1 - (source.embedding_vector <=> target.embedding_vector) AS similarity
        FROM cannibalization_documents AS source
        CROSS JOIN LATERAL (
          SELECT candidate.id, candidate.url_hash, candidate.embedding_vector
          FROM cannibalization_documents AS candidate
          WHERE candidate.tenant_id = source.tenant_id
            AND candidate.report_id = source.report_id
            AND candidate.status = 'included'
            AND candidate.embedding_vector IS NOT NULL
            AND candidate.id <> source.id
          ORDER BY candidate.embedding_vector <=> source.embedding_vector
          LIMIT ?
        ) AS target
        WHERE source.tenant_id = ?
          AND source.report_id = ?
          AND source.status = 'included'
          AND source.embedding_vector IS NOT NULL
      )
      SELECT left_hash, right_hash, MAX(similarity) AS similarity
      FROM nearest
      WHERE similarity >= ?
      GROUP BY left_hash, right_hash
      ORDER BY similarity DESC
    `, [Math.max(1, Math.min(30, Number(limit) || 8)), tenantId, reportId, Number(minSimilarity) || 0.55]);
    return (result.rows || []).map((row) => ({
      leftHash: row.left_hash,
      rightHash: row.right_hash,
      similarity: Number(row.similarity || 0),
    }));
  }
  async function updateCannibalizationRun({ tenantId, reportId, status, result, error }) {
    const counts = await db("cannibalization_documents")
      .where({ tenant_id: tenantId, report_id: reportId })
      .select("status")
      .count({ count: "id" })
      .groupBy("status");
    const included = Number(counts.find((row) => row.status === "included")?.count || 0);
    const excluded = Number(counts.find((row) => row.status === "excluded")?.count || 0);
    const payload = {
      status: status || "scanning",
      processed_pages: included + excluded,
      included_pages: included,
      excluded_pages: excluded,
      result_json: result ? JSON.stringify(result) : undefined,
      error: error || null,
      updated_at: db.fn.now(),
    };
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
    await db("cannibalization_runs").where({ tenant_id: tenantId, report_id: reportId }).update(payload);
    return getCannibalizationRun(tenantId, reportId, { includeCandidates: false });
  }

  return {
    db,
    isPostgres,
    init,
    destroy: () => db.destroy(),
    createTenantAndOwner,
    saveSnapshotAndReport,
    listReportPages,
    getReportPage,
    getReportContext,
    savePageOptimization,
    getPageOptimization,
    resetCannibalizationRun,
    getCannibalizationRun,
    getCannibalizationCandidateBatch,
    upsertCannibalizationDocument,
    listCannibalizationDocuments,
    listCannibalizationSemanticPairs,
    isVectorSearchAvailable: () => vectorSearchAvailable,
    updateCannibalizationRun,
    listSites,
    getUserById: (id) =>
      db("users")
        .join("tenants", "tenants.id", "users.tenant_id")
        .where("users.id", id)
        .first("users.*", "tenants.name as tenant_name"),
    getUserByEmail: (email) =>
      db("users").whereRaw("LOWER(email) = LOWER(?)", [email]).first(),
    emailExists: async (email) =>
      Boolean(
        await db("users")
          .whereRaw("LOWER(email) = LOWER(?)", [email])
          .first("id"),
      ),
    getConnectionForUser: (tenantId, userId) =>
      db("google_connections")
        .where({ tenant_id: tenantId, user_id: userId })
        .first(),
    getConnectionById: (tenantId, id) =>
      db("google_connections").where({ tenant_id: tenantId, id }).first(),
    upsertConnection: async (data) => {
      const existing = await db("google_connections")
        .where({ tenant_id: data.tenant_id, user_id: data.user_id })
        .first("id");
      if (existing) {
        await db("google_connections")
          .where({ id: existing.id })
          .update({ ...data, updated_at: db.fn.now() });
        return existing.id;
      }
      return idOf(await db("google_connections").insert(data).returning("id"));
    },
    insertSite: async (data) =>
      idOf(await db("sites").insert(data).returning("id")),
    getSite: (tenantId, id) =>
      db("sites").where({ tenant_id: tenantId, id }).first(),
    updateSite: (tenantId, id, values) =>
      db("sites").where({ tenant_id: tenantId, id }).update({ ...values, updated_at: db.fn.now() }),
    setSiteError: (tenantId, id, message) =>
      db("sites").where({ tenant_id: tenantId, id }).update({
        status: "error",
        last_error: message,
        updated_at: db.fn.now(),
      }),
    listReports: (tenantId, siteId) =>
      db("reports")
        .where({ tenant_id: tenantId, site_id: siteId })
        .select("id", "created_at")
        .orderBy("id", "desc")
        .limit(20),
    getReport: async (tenantId, id) =>
      db("reports")
        .join("sites", "sites.id", "reports.site_id")
        .where({ "reports.tenant_id": tenantId, "reports.id": id })
        .first("reports.*", "sites.name as site_name", "sites.website_url"),
    createTask: async (task) =>
      idOf(await db("seo_tasks").insert(task).returning("id")),
    getTask: (tenantId, id) =>
      db("seo_tasks")
        .leftJoin("users as assignee", "assignee.id", "seo_tasks.assignee_user_id")
        .join("sites", "sites.id", "seo_tasks.site_id")
        .where({ "seo_tasks.tenant_id": tenantId, "seo_tasks.id": id })
        .first("seo_tasks.*", "assignee.name as assignee_name", "sites.name as site_name"),
    listTasks: (tenantId, filters = {}) => {
      const query = db("seo_tasks")
        .leftJoin("users as assignee", "assignee.id", "seo_tasks.assignee_user_id")
        .join("sites", "sites.id", "seo_tasks.site_id")
        .where({ "seo_tasks.tenant_id": tenantId })
        .select("seo_tasks.*", "assignee.name as assignee_name", "sites.name as site_name")
        .orderByRaw("CASE seo_tasks.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END")
        .orderBy("seo_tasks.id", "desc");
      if (filters.status) query.andWhere("seo_tasks.status", filters.status);
      if (filters.siteId) query.andWhere("seo_tasks.site_id", filters.siteId);
      if (filters.assigneeId) query.andWhere("seo_tasks.assignee_user_id", filters.assigneeId);
      return query;
    },
    updateTask: (tenantId, id, values) =>
      db("seo_tasks").where({ tenant_id: tenantId, id }).update({ ...values, updated_at: db.fn.now() }),
    taskSummary: async (tenantId) => {
      const rows = await db("seo_tasks")
        .where({ tenant_id: tenantId })
        .groupBy("status")
        .select("status")
        .count({ count: "id" });
      return Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)]));
    },
    listMembers: (tenantId) =>
      db("users")
        .where({ tenant_id: tenantId })
        .select("id", "name", "email", "role", "created_at")
        .orderBy("id"),
    addMember: (data) => db("users").insert(data),
    countUsers: async () =>
      Number((await db("users").count({ count: "id" }).first()).count || 0),
  };
}
module.exports = { createDataStore };
