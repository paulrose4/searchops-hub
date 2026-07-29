document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();

  const tabs = document.querySelector("[data-tabs]");
  if (tabs) {
    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== button.dataset.tab;
      });
      window.dispatchEvent(new Event("resize"));
    });
  }

  const siteForm = document.querySelector("[data-site-form]");
  if (siteForm) {
    const select = siteForm.querySelector("[name=ga4_property_id]");
    select?.addEventListener("change", () => {
      const option = select.options[select.selectedIndex];
      siteForm.querySelector("[name=ga4_property_name]").value = option?.dataset.name || "";
    });
  }

  document.querySelectorAll("[data-filter-controls]").forEach((controls) => {
    const table = document.getElementById(controls.dataset.filterControls);
    if (!table) return;
    const rows = [...table.querySelectorAll("tbody tr")];
    const count = controls.querySelector("[data-filter-count]");
    const update = () => {
      const search = (controls.querySelector("[data-filter-search]")?.value || "").trim().toLocaleLowerCase();
      const filters = [...controls.querySelectorAll("[data-filter-field]")].map((input) => ({
        field: input.dataset.filterField,
        value: input.value,
      }));
      let visible = 0;
      rows.forEach((row) => {
        const searchable = (row.dataset.search || row.innerText || "").toLocaleLowerCase();
        const searchMatch = !search || searchable.includes(search);
        const fieldMatch = filters.every(({ field, value }) => !value || row.dataset[field] === value);
        row.hidden = !(searchMatch && fieldMatch);
        if (!row.hidden) visible += 1;
      });
      if (count) count.textContent = `显示 ${visible} / ${rows.length}`;
    };
    controls.addEventListener("input", update);
    controls.addEventListener("change", update);
    update();
  });

  const csvCell = (value) => `"${String(value || "").replaceAll('"', '""').replace(/\s+/g, " ").trim()}"`;
  document.querySelectorAll("[data-export-table]").forEach((button) => {
    button.addEventListener("click", () => {
      const table = document.getElementById(button.dataset.exportTable);
      if (!table) return;
      const lines = [];
      const header = [...table.querySelectorAll("thead th")].map((cell) => csvCell(cell.innerText));
      lines.push(header.join(","));
      [...table.querySelectorAll("tbody tr")].filter((row) => !row.hidden).forEach((row) => {
        lines.push([...row.children].map((cell) => csvCell(cell.innerText)).join(","));
      });
      const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${button.dataset.exportTable}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
  });

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const formatNumber = (value) => Number(value || 0).toLocaleString("zh-CN");
  const formatPercent = (value, digits = 2) => `${(Number(value || 0) * 100).toFixed(digits)}%`;

  document.querySelectorAll("[data-page-library]").forEach((library) => {
    const endpoint = library.dataset.endpoint;
    const rowsElement = library.querySelector("[data-page-rows]");
    const countElement = library.querySelector("[data-page-count]");
    const statusElement = library.querySelector("[data-page-status]");
    const searchInput = library.querySelector("[data-page-search]");
    const sourceInput = library.querySelector("[data-page-source]");
    const priorityInput = library.querySelector("[data-page-priority]");
    const pageSizeInput = library.querySelector("[data-page-size]");
    const previousButton = library.querySelector("[data-page-prev]");
    const nextButton = library.querySelector("[data-page-next]");
    const exportButton = library.querySelector("[data-page-export]");
    const modal = library.querySelector("[data-optimizer-modal]");
    const modalTitle = library.querySelector("[data-optimizer-title]");
    const modalBody = library.querySelector("[data-optimizer-body]");
    const csrf = library.dataset.csrf || "";
    let currentPage = 1;
    let requestNumber = 0;
    let searchTimer;

    const query = (includePage = true) => {
      const parameters = new URLSearchParams();
      if (includePage) parameters.set("page", currentPage);
      parameters.set("pageSize", pageSizeInput.value || "100");
      if (searchInput.value.trim()) parameters.set("search", searchInput.value.trim());
      if (sourceInput.value) parameters.set("source", sourceInput.value);
      if (priorityInput.value) parameters.set("priority", priorityInput.value);
      return parameters;
    };
    const renderRows = (rows) => {
      if (!rows.length) {
        rowsElement.innerHTML = '<tr><td colspan="7" class="page-library-empty">当前筛选条件下没有页面。新生成的报告才会写入全量页面库。</td></tr>';
        return;
      }
      rowsElement.innerHTML = rows.map((row) => {
        const sourceLabel = row.source === "both" ? "GA4 + GSC" : row.source === "ga4" ? "仅 GA4" : "仅 GSC";
        const issues = Array.isArray(row.auditIssues) && row.auditIssues.length
          ? `<small class="issue-text">页面实测：${escapeHtml(row.auditIssues.join("；"))}</small>`
          : "";
        const position = Number(row.gsc_position || 0) > 0 ? Number(row.gsc_position).toFixed(1) : "-";
        return `<tr><td><span class="priority ${escapeHtml(String(row.priority || "P3").toLowerCase())}">${escapeHtml(row.priority || "P3")}</span></td><td class="page-library-url"><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener"><code>${escapeHtml(row.page || row.url)}</code></a><small>${escapeHtml(sourceLabel)}</small></td><td><strong>${formatNumber(row.sessions)} 会话</strong><small>${formatNumber(row.users)} 用户 · ${formatNumber(row.engaged_sessions)} 互动会话</small><small>${formatNumber(row.add_to_carts)} 次加购 · 每百次会话 ${(Number(row.add_to_cart_density || 0) * 100).toFixed(2)} 次</small></td><td><strong>${formatNumber(row.gsc_clicks)} 点击 / ${formatNumber(row.gsc_impressions)} 曝光</strong><small>CTR ${formatPercent(row.gsc_ctr)} · 排名 ${position}</small></td><td>${escapeHtml(row.diagnosis || "-")}${issues}</td><td>${escapeHtml(row.action || "-")}<small>${escapeHtml(row.evidence || "")}</small></td><td class="page-agent-cell"><button type="button" class="secondary compact page-agent-button" data-page-optimize data-page-id="${escapeHtml(row.id)}" data-page-url="${escapeHtml(row.url)}"><i data-lucide="wand-sparkles"></i>深度优化</button><small>实时页面 + GA4 + GSC</small></td></tr>`;
      }).join("");
    };
    const load = async () => {
      const activeRequest = ++requestNumber;
      rowsElement.innerHTML = '<tr><td colspan="7">正在读取全量页面数据…</td></tr>';
      try {
        const response = await fetch(`${endpoint}?${query().toString()}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (activeRequest !== requestNumber) return;
        currentPage = result.page;
        renderRows(result.rows || []);
        countElement.textContent = `筛选结果 ${formatNumber(result.total)} 个页面`;
        statusElement.textContent = `第 ${formatNumber(result.page)} / ${formatNumber(result.totalPages)} 页`;
        previousButton.disabled = result.page <= 1;
        nextButton.disabled = result.page >= result.totalPages;
      } catch {
        if (activeRequest !== requestNumber) return;
        rowsElement.innerHTML = '<tr><td colspan="7" class="page-library-empty">全量页面读取失败，请刷新页面或重新同步报告。</td></tr>';
        countElement.textContent = "读取失败";
        previousButton.disabled = true;
        nextButton.disabled = true;
      }
    };
    const reloadFromFirstPage = () => {
      currentPage = 1;
      load();
    };
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(reloadFromFirstPage, 300);
    });
    sourceInput.addEventListener("change", reloadFromFirstPage);
    priorityInput.addEventListener("change", reloadFromFirstPage);
    pageSizeInput.addEventListener("change", reloadFromFirstPage);
    previousButton.addEventListener("click", () => {
      if (currentPage <= 1) return;
      currentPage -= 1;
      load();
    });
    nextButton.addEventListener("click", () => {
      currentPage += 1;
      load();
    });
    exportButton.addEventListener("click", () => {
      const parameters = query(false);
      parameters.set("format", "csv");
      window.location.assign(`${endpoint}?${parameters.toString()}`);
    });
    const list = (value) => Array.isArray(value) ? value : [];
    const scoreLabel = (key) => ({ overall: "综合", technical: "技术", content: "内容", serp: "搜索摘要", conversion: "页面承接", localization: "国际 SEO" })[key] || key;
    const renderOptimizer = (result) => {
      const scores = Object.entries(result.scores || {}).map(([key, value]) => `<div><span>${escapeHtml(scoreLabel(key))}</span><strong>${formatNumber(value)}</strong><small>/ 100</small></div>`).join("");
      const platform = result.platform || {};
      const platformText = [result.ai?.status === "completed" ? `AI 本地化 · ${result.ai.targetLanguageName || result.locale}` : "", platform.isWordPress ? "WordPress" : "未识别 WordPress", platform.isWooCommerce ? "WooCommerce" : "", ...list(platform.seoPlugins), ...list(platform.builders)].filter(Boolean).join(" · ");
      const queries = list(result.searchIntent?.queries).length ? list(result.searchIntent.queries).map((item) => `<tr><td><strong>${escapeHtml(item.query)}</strong></td><td>${formatNumber(item.impressions)}</td><td>${formatNumber(item.clicks)}</td><td>${formatPercent(item.ctr)}</td><td>${Number(item.position || 0).toFixed(1)}</td></tr>`).join("") : '<tr><td colspan="5">当前 GSC 查询 × 页面数据中没有匹配词，智能体已使用 URL 和页面主题推断。</td></tr>';
      const issues = list(result.issues).length ? list(result.issues).map((item) => `<article class="optimizer-issue"><div><span class="priority ${escapeHtml(String(item.severity || "P2").toLowerCase())}">${escapeHtml(item.severity || "P2")}</span><small>${escapeHtml(item.category)}</small></div><h4>${escapeHtml(item.title)}</h4><dl><dt>检测依据</dt><dd>${escapeHtml(item.evidence)}</dd><dt>SEO 影响</dt><dd>${escapeHtml(item.impact)}</dd><dt>具体修改</dt><dd>${escapeHtml(item.fix)}</dd><dt>验收标准</dt><dd>${escapeHtml(item.acceptance)}</dd></dl></article>`).join("") : '<p class="optimizer-success">未检测到高置信度问题，建议按下方内容方案持续扩展并复盘。</p>';
      const outline = list(result.solution?.outline).map((item, index) => `<li><span>H2 ${index + 1}</span><div><strong>${escapeHtml(item.heading)}</strong><p>${escapeHtml(item.purpose)}</p>${list(item.keyPoints).length ? `<small>${list(item.keyPoints).map((point) => escapeHtml(point)).join(" · ")}</small>` : ""}</div></li>`).join("");
      const internalLinks = list(result.solution?.internalLinks).length ? list(result.solution.internalLinks).map((item) => `<li><a href="${escapeHtml(item.target)}" target="_blank" rel="noopener">${escapeHtml(item.target)}</a><span>锚文本：${escapeHtml(item.anchor)}</span><p>${escapeHtml(item.reason)}</p></li>`).join("") : '<li><span>没有发现共享查询的其他页面；请从同主题分类页、商品页或指南页手动选择 3–5 个相关内链。</span></li>';
      const actionPlan = list(result.actionPlan).map((item) => `<tr><td>${formatNumber(item.order)}</td><td><span class="priority ${escapeHtml(String(item.priority || "P2").toLowerCase())}">${escapeHtml(item.priority)}</span></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.wordpressPath)}</td><td>${escapeHtml(item.acceptance)}</td></tr>`).join("");
      const validation = list(result.validation).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const wpSteps = list(result.solution?.wordpress?.steps).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const current = result.currentPage || {};
      const native = result.nativeContent || {};
      const nativeDirection = native.direction === "rtl" ? "rtl" : "ltr";
      const nativeFaqs = list(native.faqs).map((item) => `<li dir="${nativeDirection}"><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer || "")}</p><small dir="ltr">运营说明：${escapeHtml(item.answerGuidanceZh)}</small></li>`).join("");
      const terminology = list(native.terminologyNotesZh).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const nativeSection = result.ai?.status === "completed" ? `<section class="optimizer-native"><h3>AI 母语本地化方案</h3><p class="optimizer-ai-meta"><strong>${escapeHtml(native.languageName || result.ai.targetLanguageName || result.locale)}</strong> · ${escapeHtml(native.nativeLanguageName || "")} · ${escapeHtml(result.ai.model || "AI")}</p><div class="optimizer-native-copy" dir="${nativeDirection}"><h4>本地语言页面摘要</h4><p>${escapeHtml(native.summary || "")}</p><h4>建议开场正文</h4><p>${escapeHtml(native.introduction || "")}</p></div>${nativeFaqs ? `<h4>建议 FAQ</h4><ol class="optimizer-native-faqs">${nativeFaqs}</ol>` : ""}${terminology ? `<h4>本地化术语说明</h4><ul class="check-list">${terminology}</ul>` : ""}</section>` : "";
      modalBody.innerHTML = `<div class="optimizer-boundary">${escapeHtml(result.boundary || "")}</div><div class="optimizer-score-grid">${scores}</div><section class="optimizer-summary"><h3>智能体结论</h3><p>${escapeHtml(result.summary)}</p><div class="optimizer-platform"><i data-lucide="blocks"></i><span>${escapeHtml(platformText || "公开页面")}</span><b>页面类型：${escapeHtml(result.pageType)}</b><b>语言：${escapeHtml(result.locale)}</b></div></section><section><h3>搜索需求依据</h3><p>主关键词：<strong>${escapeHtml(result.searchIntent?.primaryKeyword || "待确认")}</strong></p><div class="table-wrap"><table><thead><tr><th>查询</th><th>曝光</th><th>点击</th><th>CTR</th><th>排名</th></tr></thead><tbody>${queries}</tbody></table></div></section><section><h3>搜索摘要最终方案</h3><div class="optimizer-snippet"><div><span>当前 Title</span><p>${escapeHtml(current.title || "缺失")}</p></div><div class="recommended"><span>建议 Title</span><p>${escapeHtml(result.solution?.proposedTitle || "")}</p></div><div><span>当前 Description</span><p>${escapeHtml(current.description || "缺失")}</p></div><div class="recommended"><span>建议 Description</span><p>${escapeHtml(result.solution?.proposedDescription || "")}</p></div><div><span>当前 H1</span><p>${escapeHtml(list(current.h1s).join("；") || "缺失")}</p></div><div class="recommended"><span>建议 H1</span><p>${escapeHtml(result.solution?.proposedH1 || "")}</p></div></div></section>${nativeSection}<section><h3>具体 SEO 问题</h3><div class="optimizer-issues">${issues}</div></section><section><h3>内容重构方案</h3><p>建议有效正文规模：约 <strong>${formatNumber(result.solution?.targetWordCount)} 词</strong>；当前约 ${formatNumber(current.wordCount)} 词。</p><ol class="optimizer-outline">${outline}</ol></section><section class="optimizer-two-column"><div><h3>内部链接方案</h3><ul class="optimizer-links">${internalLinks}</ul></div><div><h3>Schema 建议</h3><ul class="check-list">${list(result.solution?.schema).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h3>WordPress 落地</h3><p>SEO 插件：${escapeHtml(result.solution?.wordpress?.plugin || "未识别")}；编辑器：${escapeHtml(result.solution?.wordpress?.builder || "WordPress 编辑器")}</p><ol class="check-list">${wpSteps}</ol></div></section><section><h3>最终执行清单</h3><div class="table-wrap"><table style="min-width:900px"><thead><tr><th>顺序</th><th>优先级</th><th>具体动作</th><th>WordPress 操作位置</th><th>验收标准</th></tr></thead><tbody>${actionPlan}</tbody></table></div></section><section><h3>发布后验证</h3><ol class="check-list">${validation}</ol></section>`;
      if (window.lucide) window.lucide.createIcons();
    };
    const openOptimizer = () => {
      modal.hidden = false;
      document.body.classList.add("modal-open");
    };
    const closeOptimizer = () => {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
    };
    library.querySelectorAll("[data-optimizer-close]").forEach((button) => button.addEventListener("click", closeOptimizer));
    rowsElement.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-page-optimize]");
      if (!button) return;
      openOptimizer();
      modalTitle.textContent = button.dataset.pageUrl || "页面深度优化";
      modalBody.innerHTML = '<div class="optimizer-loading"><i data-lucide="loader-circle"></i><strong>AI 页面优化智能体正在分析</strong><p>实时读取页面内容，并结合该 URL 的 GA4、GSC 和目标市场语言生成母语级个性化方案。</p></div>';
      button.disabled = true;
      if (window.lucide) window.lucide.createIcons();
      try {
        const response = await fetch(`${endpoint}/${encodeURIComponent(button.dataset.pageId)}/optimize`, { method: "POST", headers: { Accept: "application/json", "x-csrf-token": csrf } });
        const payload = await response.json();
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `HTTP ${response.status}`);
        renderOptimizer(payload.result);
        button.innerHTML = '<i data-lucide="refresh-cw"></i>重新分析';
      } catch (error) {
        modalBody.innerHTML = `<div class="optimizer-error"><i data-lucide="circle-alert"></i><strong>分析失败</strong><p>${escapeHtml(error.message)}</p><small>请确认页面可以公开访问，并稍后重试。</small></div>`;
      } finally {
        button.disabled = false;
        if (window.lucide) window.lucide.createIcons();
      }
    });
    load();
  });

  document.querySelectorAll("[data-cannibal-workbench]").forEach((workbench) => {
    const endpoint = workbench.dataset.endpoint;
    const csrf = workbench.dataset.csrf;
    const statusElement = workbench.querySelector("[data-cannibal-status]");
    const resultsElement = workbench.querySelector("[data-cannibal-results]");
    const startButton = workbench.querySelector("[data-cannibal-start]");
    let running = false;

    const score = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
    const render = (payload) => {
      const total = Number(payload.totalCandidates || 0);
      const processed = Number(payload.processedPages || 0);
      const percent = total ? Math.min(100, (processed / total) * 100) : 0;
      const labels = { pending: "尚未开始", scanning: "正在扫描", completed: "检测完成", error: "检测失败" };
      const sitemapLimit = payload.discovery?.truncated ? " · Sitemap 已达到 5000 页保护上限" : "";
      statusElement.innerHTML = `<div><strong>${escapeHtml(labels[payload.status] || payload.status)}</strong><span>主语言 ${escapeHtml(payload.mainLanguage || "待识别")} · 已处理 ${formatNumber(processed)} / ${formatNumber(total)} · 纳入 ${formatNumber(payload.includedPages)} · 排除翻译或异常页面 ${formatNumber(payload.excludedPages)} · Sitemap 发现 ${formatNumber(payload.discovery?.sitemapPages || 0)}${sitemapLimit}</span></div><div class="cannibal-progress"><span style="width:${percent.toFixed(1)}%"></span></div>`;
      if (!payload.result) {
        resultsElement.innerHTML = payload.status === "scanning" ? '<div class="optimizer-loading"><i data-lucide="loader-circle"></i><strong>正在建立主语言页面向量库</strong><p>系统会按批次抓取并自动续跑，请保持此页面打开。</p></div>' : "";
        if (window.lucide) window.lucide.createIcons();
        return;
      }
      const result = payload.result;
      const rows = (result.findings || []).map((finding) => {
        const links = (finding.recommendations?.internalLinks || []).map((link) => `<li><code>${escapeHtml(link.source)}</code><span>使用锚文本 <strong>${escapeHtml(link.anchor)}</strong> 指向目标页</span></li>`).join("");
        const headings = (finding.recommendations?.headings || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        const terms = (finding.recommendations?.missingSemanticTerms || []).map((item) => `<span class="term-chip">${escapeHtml(item)}</span>`).join("");
        return `<article class="cannibal-finding"><header><span class="priority ${finding.risk === "高" ? "p1" : "p2"}">${escapeHtml(finding.risk)}风险</span><div><strong>${escapeHtml(finding.strategy)}</strong><small>${escapeHtml(finding.intent)} · 综合 ${score(finding.similarity)} · 多语言语义 ${score(finding.semanticSimilarity)} · 词法 ${score(finding.lexicalSimilarity)} · TF IDF ${score(finding.tfidfSimilarity)}</small></div></header><div class="cannibal-pair"><div><span>建议主页面</span><code>${escapeHtml(finding.primaryUrl)}</code></div><div><span>冲突页面</span><code>${escapeHtml(finding.secondaryUrl)}</code></div></div><p class="insight">${escapeHtml(finding.reason)}</p><section><h3>具体修复动作</h3><p>${escapeHtml(finding.action)}</p></section><section class="cannibal-recommendations"><div><h3>页面级精准修改</h3><dl><dt>目标页面</dt><dd><code>${escapeHtml(finding.recommendations?.targetUrl || "")}</code></dd><dt>SEO Title 无标点</dt><dd><strong>${escapeHtml(finding.recommendations?.title || "")}</strong></dd><dt>Meta Description</dt><dd>${escapeHtml(finding.recommendations?.metaDescription || "")}</dd></dl></div><div><h3>缺失语义与 H2 H3</h3><div class="term-list">${terms || "暂无"}</div><ul class="check-list">${headings}</ul></div></section><section><h3>内链结构优化</h3><ul class="cannibal-links">${links || "<li>当前没有高权重来源页建议，需人工选择相关页面。</li>"}</ul></section></article>`;
      }).join("");
      const pageItems = result.pageRecommendations || [];
      resultsElement.innerHTML = `<div class="cannibal-summary"><div><span>主语言页面</span><strong>${formatNumber(result.analyzedPages)}</strong></div><div><span>冲突组</span><strong>${formatNumber((result.findings || []).length)}</strong></div><div><span>页面整改项</span><strong>${formatNumber(pageItems.length)}</strong></div><div><span>父子页豁免</span><strong>${formatNumber(result.parentChildExemptions)}</strong></div><div><span>意图差异豁免</span><strong>${formatNumber(result.intentExemptions)}</strong></div><div><span>多语言语义模型</span><strong>${escapeHtml(result.embedding?.model || "词法回退")}</strong><small>${result.embedding?.vectorSearch ? `pgvector · ${formatNumber(result.embedding?.embeddedPages)} 页` : `未启用向量检索 · 回退 ${formatNumber(result.embedding?.fallbackPages)} 页`}</small></div><button type="button" class="secondary" data-cannibal-json><i data-lucide="download"></i>导出完整 JSON</button></div>${rows || '<div class="empty"><h2>未发现达到综合判定阈值的严重蚕食</h2><p>已排除翻译页、意图不同页面和正常父子级页面。</p></div>'}<section class="cannibal-page-section"><header><div><h2>主语言页面级整改清单</h2><p>仅列出存在 TDK 内容结构 Canonical 图片 Alt 或内链问题的页面 所有动作均需运营人员在 WordPress 手动执行</p></div><span data-cannibal-page-count></span></header><div data-cannibal-page-list></div><div class="page-pagination"><button type="button" class="secondary" data-cannibal-page-prev><i data-lucide="chevron-left"></i>上一页</button><span data-cannibal-page-status></span><button type="button" class="secondary" data-cannibal-page-next>下一页<i data-lucide="chevron-right"></i></button></div></section>`;
      const pageSize = 50;
      let pageNumber = 1;
      const renderPageItems = () => {
        const totalPages = Math.max(1, Math.ceil(pageItems.length / pageSize));
        pageNumber = Math.max(1, Math.min(pageNumber, totalPages));
        const pageList = resultsElement.querySelector("[data-cannibal-page-list]");
        const visible = pageItems.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
        pageList.innerHTML = visible.map((item) => {
          const issues = (item.issues || []).map((issue) => `<span class="term-chip issue-chip">${escapeHtml(issue)}</span>`).join("");
          const actions = (item.recommendations?.manualActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("");
          const terms = (item.recommendations?.semanticTerms || []).map((term) => `<span class="term-chip">${escapeHtml(term)}</span>`).join("");
          const links = (item.recommendations?.internalLinks || []).map((link) => `<li><code>${escapeHtml(link.source)}</code><span>使用锚文本 <strong>${escapeHtml(link.anchor)}</strong></span></li>`).join("");
          return `<details class="cannibal-page-item"><summary><span class="priority ${item.priority === "P1" ? "p1" : "p2"}">${escapeHtml(item.priority)}</span><code>${escapeHtml(item.url)}</code><span>${escapeHtml(item.intent)} · ${formatNumber((item.issues || []).length)} 项</span></summary><div class="cannibal-page-body"><div><h3>发现的问题</h3><div class="term-list">${issues}</div><h3>手动整改动作</h3><ol class="check-list">${actions}</ol></div><div><h3>建议 SEO Title 无标点</h3><strong>${escapeHtml(item.recommendations?.title || "")}</strong><h3>建议 Meta Description</h3><p>${escapeHtml(item.recommendations?.metaDescription || "")}</p><h3>建议补充语义词</h3><div class="term-list">${terms || "暂无"}</div></div><div><h3>精准内链来源</h3><ul class="cannibal-links">${links || "<li>暂无足够相关的高权重来源页 由运营人员人工选择</li>"}</ul></div></div></details>`;
        }).join("") || '<div class="empty"><h2>未发现页面级基础问题</h2></div>';
        resultsElement.querySelector("[data-cannibal-page-count]").textContent = `共 ${formatNumber(pageItems.length)} 个页面`;
        resultsElement.querySelector("[data-cannibal-page-status]").textContent = `第 ${pageNumber} / ${totalPages} 页`;
        resultsElement.querySelector("[data-cannibal-page-prev]").disabled = pageNumber <= 1;
        resultsElement.querySelector("[data-cannibal-page-next]").disabled = pageNumber >= totalPages;
        if (window.lucide) window.lucide.createIcons();
      };
      resultsElement.querySelector("[data-cannibal-page-prev]").addEventListener("click", () => { pageNumber -= 1; renderPageItems(); });
      resultsElement.querySelector("[data-cannibal-page-next]").addEventListener("click", () => { pageNumber += 1; renderPageItems(); });
      renderPageItems();
      resultsElement.querySelector("[data-cannibal-json]")?.addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cannibalization-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      });
      if (window.lucide) window.lucide.createIcons();
    };

    const scan = async (reset = false) => {
      if (running && reset) return;
      running = true;
      startButton.disabled = true;
      try {
        let first = reset;
        while (true) {
          const response = await fetch(`${endpoint}/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "x-csrf-token": csrf },
            body: JSON.stringify({ reset: first }),
          });
          first = false;
          const payload = await response.json();
          if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
          render(payload);
          if (payload.status !== "scanning") break;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (error) {
        statusElement.innerHTML = `<strong>检测失败</strong><span>${escapeHtml(error.message)}</span>`;
      } finally {
        running = false;
        startButton.disabled = false;
        startButton.innerHTML = '<i data-lucide="refresh-cw"></i>重新检测全站';
        if (window.lucide) window.lucide.createIcons();
      }
    };

    startButton.addEventListener("click", () => scan(true));
    fetch(endpoint, { headers: { Accept: "application/json" } })
      .then((response) => response.json())
      .then((payload) => {
        render(payload);
        if (payload.status === "scanning") scan(false);
      })
      .catch(() => {});
  });

  const trendElement = document.querySelector("[data-trend-data]");
  if (trendElement) {
    let trend = [];
    try {
      trend = JSON.parse(trendElement.textContent || "[]");
    } catch {}
    const palette = { green: "#087f69", blue: "#2b6cb0", gray: "#9aa8ad", grid: "#e4eaec", text: "#64747a" };
    const draw = (canvas) => {
      if (!canvas.offsetParent || !trend.length) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(320, canvas.clientWidth || 600);
      const height = 220;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      const padding = { left: 42, right: 20, top: 18, bottom: 32 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const definitions = canvas.dataset.trendChart === "search"
        ? [{ key: "gscImpressions", color: palette.blue }, { key: "gscCtr", color: palette.green, percent: true }]
        : [{ key: "sessions", color: palette.green }, { key: "gscClicks", color: palette.blue }];
      context.strokeStyle = palette.grid;
      context.fillStyle = palette.text;
      context.font = "11px system-ui";
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (plotHeight * index) / 4;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
      }
      definitions.forEach((definition) => {
        const values = trend.map((item) => Number(item[definition.key] || 0));
        const max = Math.max(...values, 1);
        context.strokeStyle = definition.color;
        context.lineWidth = 2;
        context.beginPath();
        values.forEach((value, index) => {
          const x = padding.left + (plotWidth * index) / Math.max(1, values.length - 1);
          const y = padding.top + plotHeight - (value / max) * plotHeight;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      });
      const labels = [0, Math.floor((trend.length - 1) / 2), trend.length - 1];
      labels.forEach((index) => {
        const x = padding.left + (plotWidth * index) / Math.max(1, trend.length - 1);
        context.fillText(trend[index]?.date?.slice(5) || "", x - 16, height - 10);
      });
      definitions.forEach((definition, index) => {
        context.fillStyle = definition.color;
        context.fillRect(padding.left + index * 130, 2, 10, 3);
        context.fillText(definition.key, padding.left + 15 + index * 130, 8);
      });
    };
    const canvases = [...document.querySelectorAll("[data-trend-chart]")];
    const drawAll = () => canvases.forEach(draw);
    drawAll();
    window.addEventListener("resize", drawAll);
  }
});
