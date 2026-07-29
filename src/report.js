const pct = (value, total) => total ? value / total : 0;
const change = (current, previous) => previous ? (current - previous) / previous : null;
const round = (value, digits = 1) => Number((Number(value) || 0).toFixed(digits));
const rows = (value) => Array.isArray(value) ? value : [];

function direction(value) {
  if (value === null) return '暂无对比';
  if (Math.abs(value) < 0.005) return '基本持平';
  return value > 0 ? '上升' : '下降';
}

function behavior(row, totalSessions) {
  return {
    ...row,
    share: pct(row.sessions, totalSessions),
    engagementRate: pct(row.engagedSessions, row.sessions),
    atcRate: pct(row.addToCarts, row.sessions)
  };
}

function marketPriority(row, benchmarks) {
  if (row.sessions < Math.max(50, benchmarks.sessions * 0.005)) return '暂缓投入';
  if (row.share >= 0.05 && row.atcRate >= benchmarks.atcRate * 0.9 && row.engagementRate >= benchmarks.engagementRate * 0.9) return '扩量';
  if (row.share >= 0.025 && row.atcRate < benchmarks.atcRate * 0.7) return '修复转化';
  if (row.share >= 0.02 && row.engagementRate < benchmarks.engagementRate * 0.75) return '加强本地化';
  return '验证市场';
}

function marketStrategy(label, row) {
  const actions = {
    '扩量': '保留当前页面与渠道组合，扩展本地化分类页、内容集群、配送与信任信息。',
    '修复转化': '流量已有规模，优先检查落地页意图、价格币种、配送承诺、商品筛选和移动端 CTA。',
    '加强本地化': '补齐本地语言导航、标题、FAQ、支付配送说明和 hreflang，减少语言与市场错配。',
    '验证市场': '先用重点页面和商业词验证稳定需求，每周观察会话、互动率与加购事件密度后再扩量。',
    '暂缓投入': '当前样本较小，维持基础收录与监控，暂不投入大规模内容和页面制作。'
  };
  return row.addToCarts === 0 && row.sessions >= 100
    ? '已有一定访问但没有加购信号，先核查事件追踪与购买路径。'
    : actions[label];
}

function languageName(value) {
  const language = String(value || '(not set)').toLowerCase();
  const names = { en: '英语', de: '德语', fr: '法语', es: '西班牙语', it: '意大利语', pt: '葡萄牙语', nl: '荷兰语', ja: '日语', ko: '韩语', zh: '中文', pl: '波兰语', ru: '俄语', sv: '瑞典语' };
  const root = language.split(/[-_]/)[0];
  return names[root] ? names[root] + '（' + value + '）' : value || '(not set)';
}

const COUNTRY_INFO = {
  usa: ['美国', 'United States', '英语', 'en'], gbr: ['英国', 'United Kingdom', '英语', 'en'], deu: ['德国', 'Germany', '德语', 'de'],
  fra: ['法国', 'France', '法语', 'fr'], irn: ['伊朗', 'Iran', '波斯语', 'fa'], vnm: ['越南', 'Vietnam', '越南语', 'vi'],
  ind: ['印度', 'India', '英语/印地语', 'hi'], chn: ['中国', 'China', '中文', 'zh'], sgp: ['新加坡', 'Singapore', '英语/中文', 'en'],
  tha: ['泰国', 'Thailand', '泰语', 'th'], bra: ['巴西', 'Brazil', '葡萄牙语', 'pt'], can: ['加拿大', 'Canada', '英语/法语', 'en'],
  esp: ['西班牙', 'Spain', '西班牙语', 'es'], ita: ['意大利', 'Italy', '意大利语', 'it'], aus: ['澳大利亚', 'Australia', '英语', 'en'],
  jpn: ['日本', 'Japan', '日语', 'ja'], kor: ['韩国', 'South Korea', '韩语', 'ko'], nld: ['荷兰', 'Netherlands', '荷兰语', 'nl'],
  mex: ['墨西哥', 'Mexico', '西班牙语', 'es'], pol: ['波兰', 'Poland', '波兰语', 'pl'], swe: ['瑞典', 'Sweden', '瑞典语', 'sv'],
  ukr: ['乌克兰', 'Ukraine', '乌克兰语/俄语', 'uk'], rus: ['俄罗斯', 'Russia', '俄语', 'ru'], bgd: ['孟加拉国', 'Bangladesh', '孟加拉语', 'bn'],
  pak: ['巴基斯坦', 'Pakistan', '乌尔都语/英语', 'ur'], idn: ['印度尼西亚', 'Indonesia', '印度尼西亚语', 'id'], irq: ['伊拉克', 'Iraq', '阿拉伯语', 'ar'],
  isr: ['以色列', 'Israel', '希伯来语', 'he'], tur: ['土耳其', 'Turkey', '土耳其语', 'tr'], bel: ['比利时', 'Belgium', '荷兰语/法语', 'nl'],
  che: ['瑞士', 'Switzerland', '德语/法语/意大利语', 'de'], aut: ['奥地利', 'Austria', '德语', 'de'], prt: ['葡萄牙', 'Portugal', '葡萄牙语', 'pt'],
  phl: ['菲律宾', 'Philippines', '英语/菲律宾语', 'en'], mys: ['马来西亚', 'Malaysia', '马来语/英语', 'ms'], are: ['阿联酋', 'United Arab Emirates', '阿拉伯语/英语', 'ar']
};

function countryInfo(code) {
  const key = String(code || '').toLowerCase();
  const info = COUNTRY_INFO[key] || [key.toUpperCase(), '', '当地语言', ''];
  return { code: key.toUpperCase(), label: info[0], ga4Name: info[1], language: info[2], locale: info[3] };
}

function pagePath(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.pathname + url.search;
  } catch {
    return value;
  }
}

function queryIntent(query) {
  const text = String(query || '').toLowerCase();
  const character = /(anime|marin|lola bunny|kitagawa|cosplay|cartoon|角色|动漫)/i.test(text);
  const purchase = /(buy|cheap|price|sale|shop|ready to ship|for sale|kaufen|preis|günstig|acheter|prix|pas cher|comprar|precio|barato|acquista|prezzo|خرید|فروش|قیمت|mua|giá|bán|comprar)/i.test(text);
  const informational = /(how|what|guide|review|vs|compare|best|sản xuất|làm tình|cách|راهنما|چگونه)/i.test(text);
  if (character) return { label: '角色/动漫商品词', kind: 'character' };
  if (purchase) return { label: '高商业购买词', kind: 'commercial' };
  if (informational) return { label: '信息与使用场景词', kind: 'informational' };
  return { label: '品类商业词', kind: 'category' };
}

function bestRankingPage(gsc, country, query) {
  return rows(gsc.countryQueryPages)
    .filter((row) => row.country === country && row.query === query)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)[0] || {};
}

function countryMarket(marketCountries, code) {
  const info = countryInfo(code);
  return marketCountries.find((row) => row.country === info.ga4Name) || null;
}

function auditForPage(auditPages, value) {
  const path = pagePath(value).replace(/\/$/, '') || '/';
  return rows(auditPages).find((item) => {
    const candidate = pagePath(item.finalUrl || item.requestedUrl).replace(/\/$/, '') || '/';
    return candidate === path;
  }) || null;
}

function pageExecution(row, siteDensity, audit) {
  const localized = /^\/[a-z]{2}(?:-[a-z]{2})?\//i.test(row.path);
  const blog = /\/blog|\/guide|\/news/i.test(row.path);
  const home = row.path === '/' || row.path.startsWith('/?');
  const deficit = siteDensity ? Math.max(0, 1 - row.atcRate / siteDensity) : 0;
  const auditEvidence = audit
    ? ` 页面实测：HTTP ${audit.status || '失败'}，Title ${audit.titleLength || 0} 字，H1 ${rows(audit.h1s).length} 个，${audit.canonical ? '有 canonical' : '无 canonical'}，识别到 ${rows(audit.issues).length} 个问题。`
    : ' 当前没有页面抓取证据，以下页面建议属于数据推断。';
  const evidence = `${row.sessions.toLocaleString('zh-CN')} 次会话；每百次会话产生 ${round(row.atcRate * 100, 2)} 次加购事件，比站点平均 ${round(siteDensity * 100, 2)} 次低 ${round(deficit * 100)}%。${auditEvidence}`;
  const steps = [];
  if (!audit?.signals?.product) {
    if (home) steps.push('重排首页首屏：主品类入口、畅销产品、价格区间和 Ready-to-ship 入口必须在首屏内可见。');
    else if (blog) steps.push('在首屏、正文 30% 和结尾分别加入与文章意图匹配的分类入口、商品模块和明确 CTA。');
    else steps.push('首屏先展示 8–12 个匹配商品，并提供价格、材质、尺寸、库存/发货速度筛选，长篇 SEO 文案下移。');
  } else {
    steps.push('页面已识别到商品模块；下一步检查首屏是否展示价格、库存、配送和清晰 CTA，并用商品点击事件验证可用性。');
  }
  const missingTrust = audit ? ['shipping', 'payment', 'returns', 'privacy'].filter((key) => !audit.signals?.[key]) : [];
  if (!audit || missingTrust.length) steps.push(`补充首个商品模块附近的信任信息：${missingTrust.length ? missingTrust.join('、') : '配送时效、隐私包装、安全支付、退换/保修和客服入口'}。`);
  steps.push('从首页、相关分类页和高流量内容页增加 3–5 条描述性内链，锚文本围绕该页面主关键词，避免全部使用同一个词。');
  if (audit?.issues?.length) steps.push(`先修复页面实测问题：${audit.issues.slice(0, 4).join('；')}。`);
  if (localized) steps.push('由母语人员检查标题、H1、按钮、配送与 FAQ；同时核对 self-canonical、hreflang 双向返回和语言导航。');
  if (row.addToCarts === 0) steps.unshift('先用 GA4 DebugView 验证该 URL 的 view_item、select_item 和 add_to_cart，排除事件漏报后再判断页面转化。');
  return {
    evidence,
    steps,
    target: `4 周内保持会话规模，将每百次会话加购事件数提升到至少 ${round(Math.max(row.atcRate * 1.3, siteDensity * 0.8) * 100, 2)}，并同步监控自然搜索会话、商品点击与发生加购的会话数。`,
    audit
  };
}

function countryQueryExecution(row, context) {
  const info = countryInfo(row.country);
  const intent = queryIntent(row.query);
  const ranking = bestRankingPage(context.gsc, row.country, row.query);
  const targetPage = pagePath(ranking.page) || '尚未识别到稳定排名页';
  const market = countryMarket(context.marketCountries, row.country);
  const lowCtr = row.ctr < Math.min(0.02, context.gsc.totals.ctr * 0.6);
  const weakMarketAtc = market && market.atcRate < context.siteAtc * 0.7;
  let diagnosis;
  let target;
  const steps = [];

  if (row.position <= 10) {
    diagnosis = weakMarketAtc ? '关键词已有第一页排名和需求，但该国家站内加购明显偏低，首要任务是同时守住排名并修复页面承接。' : '关键词已在第一页，属于最接近产生增量点击的排名冲刺机会。';
    target = `4 周内把平均排名从 ${round(row.position, 1)} 推进到前 3–5 位，并保持或提升当前 CTR。`;
  } else if (row.position <= 20) {
    diagnosis = '关键词停留在第二页，页面相关性、内容覆盖或内链权重仍不足。';
    target = `6–8 周内进入前 10 位，先把平均排名提升至少 3 位。`;
  } else {
    diagnosis = row.impressions >= 500 ? '曝光已经证明搜索需求存在，但当前页面排名过低，单改标题不会解决，需要重做页面匹配或建立专门落地页。' : '当前处于低排名验证阶段，应先确认正确排名页和搜索意图，再决定是否扩展内容。';
    target = `8 周内进入前 20 位；达到前 20 后再以进入前 10 为下一阶段目标。`;
  }

  if (targetPage === '尚未识别到稳定排名页') steps.push(`在 ${info.language} 站点中指定唯一主页面承接“${row.query}”，不要让首页、分类页和内容页同时竞争。`);
  else steps.push(`优先修改 ${targetPage}：让 Title、H1、首段和首个商品/内容模块共同覆盖“${row.query}”，不要只在页尾堆关键词。`);

  if (lowCtr) steps.push(`当前 CTR 仅 ${round(row.ctr * 100, 2)}%，重写搜索标题与描述：标题前半段放核心词，后半段加入真实卖点，如库存/发货、材质、价格带或隐私配送；修改后在 GSC 按国家观察 14–28 天。`);
  else steps.push(`当前 CTR 为 ${round(row.ctr * 100, 2)}%，点击表现不差；不要大幅改写标题，重点补强页面内容、产品覆盖和内链，避免损失现有点击。`);

  if (intent.kind === 'commercial' || intent.kind === 'category') steps.push('页面首屏增加匹配商品列表、价格区间、材质/尺寸筛选、库存和配送时效；正文补充选购要点、隐私包装、支付、退换与 FAQ。');
  if (intent.kind === 'informational') steps.push('用本地语言补充真正回答问题的指南或 FAQ，并在答案之后连接到对应分类页；避免把信息词直接强行导向无解释的商品列表。');
  if (intent.kind === 'character') steps.push('先核对是否有足够匹配商品；有商品则建立角色/动漫集合页并加入相关角色内链，没有商品则合并到动漫品类页，避免制作薄内容或门页。');
  steps.push(`从 3–5 个相关的${info.language}页面增加内链到目标页，锚文本使用核心词、同义词和自然描述三种变体。`);
  steps.push(`技术验收：目标页可索引、返回 200、self-canonical 正确，并与 ${info.locale || '对应'} 语言版本保持 hreflang 双向返回；检查是否存在多个页面争夺同一词。`);
  if (weakMarketAtc) steps.push(`${info.label} GA4 每百次会话只有 ${round(market.atcRate * 100, 2)} 次加购事件，低于站点 ${round(context.siteAtc * 100, 2)} 次；同步补齐本地配送、支付、退换、客服和 CTA，不能只做排名。`);

  const marketEvidence = market
    ? `；GA4 ${info.label} ${market.sessions.toLocaleString('zh-CN')} 次会话，互动率 ${round(market.engagementRate * 100, 2)}%，每百次会话 ${round(market.atcRate * 100, 2)} 次加购事件`
    : '';
  const score = row.impressions * (row.position <= 10 ? 1.5 : row.position <= 20 ? 1.2 : 0.75) * (intent.kind === 'commercial' || intent.kind === 'category' ? 1.15 : 1);
  return {
    ...row,
    countryLabel: `${info.label}（${info.code}）`,
    intent: intent.label,
    targetPage,
    diagnosis,
    evidence: `GSC ${row.impressions.toLocaleString('zh-CN')} 曝光、${row.clicks.toLocaleString('zh-CN')} 点击，CTR ${round(row.ctr * 100, 2)}%，平均排名 ${round(row.position, 1)}${marketEvidence}。`,
    steps,
    target,
    score
  };
}

function buildDataHealth(snapshot, totals, gsc, channels) {
  const checks = [];
  const metadata = snapshot.metadata || {};
  const periodDays = Number(snapshot.period?.days || 0) || 28;
  const previousDays = Number(snapshot.previousPeriod?.days || 0) || periodDays;
  const unassigned = rows(channels).find((row) => row.name === 'Unassigned') || {};
  const unassignedShare = pct(unassigned.sessions, totals.sessions);
  const notSetCountries = rows(snapshot.current?.ga4?.countries).filter((row) => /not set/i.test(row.country)).reduce((sum, row) => sum + row.sessions, 0);
  const notSetShare = pct(notSetCountries, totals.sessions);
  const truncated = Object.entries(gsc.meta || {}).filter(([, value]) => value?.possiblyTruncated).map(([key]) => key);
  const sessionChange = change(totals.sessions, snapshot.previous?.ga4?.totals?.sessions);
  const clickChange = change(gsc.totals?.clicks, snapshot.previous?.gsc?.totals?.clicks);

  checks.push({
    key: 'period',
    status: periodDays === previousDays ? 'pass' : 'fail',
    title: '对比周期长度',
    detail: `本期 ${periodDays} 天，上期 ${previousDays} 天。`
  });
  checks.push({
    key: 'freshness',
    status: metadata.latestCompleteDate && snapshot.period?.end <= metadata.latestCompleteDate ? 'pass' : 'warn',
    title: '数据完整日期',
    detail: metadata.latestCompleteDate ? `按完整数据截止到 ${metadata.latestCompleteDate}，报告结束日为 ${snapshot.period?.end}。` : '历史快照没有记录完整数据截止日。'
  });
  checks.push({
    key: 'timezone',
    status: metadata.ga4Property?.timeZone ? 'pass' : 'warn',
    title: 'GA4 时区',
    detail: metadata.ga4Property?.timeZone ? `GA4 属性时区：${metadata.ga4Property.timeZone}。GSC 使用日期维度，跨源对比需按完整日理解。` : '未取得 GA4 属性时区，跨源日趋势需谨慎解释。'
  });
  checks.push({
    key: 'unassigned',
    status: unassignedShare > 0.05 ? 'warn' : 'pass',
    title: '未分配渠道',
    detail: `Unassigned 占会话 ${round(unassignedShare * 100, 2)}%。`
  });
  checks.push({
    key: 'not-set',
    status: notSetShare > 0.05 ? 'warn' : 'pass',
    title: '国家缺失值',
    detail: `(not set) 国家占会话 ${round(notSetShare * 100, 2)}%。`
  });
  checks.push({
    key: 'gsc-limit',
    status: truncated.length ? 'warn' : 'pass',
    title: 'GSC 行数完整性',
    detail: truncated.length ? `以下明细达到 API 行数上限，长尾数据可能被截断：${truncated.join('、')}。` : '主要 GSC 明细未达到请求行数上限；GSC 仍可能因隐私过滤隐藏少量查询。'
  });
  const divergence = sessionChange !== null && clickChange !== null && Math.sign(sessionChange) !== Math.sign(clickChange) && Math.abs(sessionChange - clickChange) >= 0.5;
  checks.push({
    key: 'cross-source',
    status: divergence ? 'warn' : 'pass',
    title: 'GA4 与 GSC 趋势一致性',
    detail: divergence
      ? `GA4 会话变化 ${round(sessionChange * 100, 1)}%，GSC 点击变化 ${round(clickChange * 100, 1)}%，方向明显不一致。先核查追踪、日期与自然搜索归因，再解释业务变化。`
      : 'GA4 会话与 GSC 点击没有出现需要强制拦截的反向大幅变化。'
  });
  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warningCount = checks.filter((item) => item.status === 'warn').length;
  return {
    level: failCount ? '低' : divergence || warningCount >= 2 ? '中' : '高',
    failCount,
    warningCount,
    checks,
    generatedAt: snapshot.generatedAt || snapshot.audit?.generatedAt || ''
  };
}

function buildTrend(snapshot) {
  const gaDaily = new Map(rows(snapshot.current?.ga4?.daily).map((row) => [row.date, row]));
  const gscDaily = new Map(rows(snapshot.current?.gsc?.daily).map((row) => [row.date, row]));
  return [...new Set([...gaDaily.keys(), ...gscDaily.keys()])]
    .filter(Boolean)
    .sort()
    .map((date) => ({
      date,
      sessions: gaDaily.get(date)?.sessions || 0,
      engagedSessions: gaDaily.get(date)?.engagedSessions || 0,
      addToCarts: gaDaily.get(date)?.addToCarts || 0,
      gscClicks: gscDaily.get(date)?.clicks || 0,
      gscImpressions: gscDaily.get(date)?.impressions || 0,
      gscCtr: gscDaily.get(date)?.ctr || 0,
      gscPosition: gscDaily.get(date)?.position || 0
    }));
}

function buildCannibalization(gsc) {
  const groups = new Map();
  for (const row of rows(gsc.queryPages)) {
    if (!row.query || !row.page) continue;
    if (!groups.has(row.query)) groups.set(row.query, []);
    groups.get(row.query).push(row);
  }
  return [...groups.entries()]
    .map(([query, pages]) => {
      const meaningful = pages.filter((row) => row.impressions >= 20).sort((a, b) => b.impressions - a.impressions);
      const impressions = meaningful.reduce((sum, row) => sum + row.impressions, 0);
      const topShare = impressions ? meaningful[0]?.impressions / impressions : 1;
      return {
        query,
        pages: meaningful.slice(0, 5),
        pageCount: meaningful.length,
        impressions,
        clicks: meaningful.reduce((sum, row) => sum + row.clicks, 0),
        topPageShare: topShare,
        risk: meaningful.length >= 2 && topShare < 0.8 ? (meaningful.length >= 3 || topShare < 0.55 ? '高' : '中') : '低'
      };
    })
    .filter((item) => item.risk !== '低' && item.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);
}

function buildContentBrief(item) {
  const intent = queryIntent(item.query);
  const info = countryInfo(item.country);
  const commercial = ['commercial', 'category', 'character'].includes(intent.kind);
  return {
    title: `${item.countryLabel}：${item.query}`,
    country: item.countryLabel,
    language: info.language,
    query: item.query,
    intent: intent.label,
    targetPage: item.targetPage,
    titleSuggestion: commercial
      ? `${item.query}：价格、材质、尺寸与隐私配送 | 品牌名`
      : `${item.query} 完整指南：选择、使用与常见问题 | 品牌名`,
    metaSuggestion: commercial
      ? `了解 ${item.query} 的可选材质、尺寸、价格区间、库存与配送信息，比较适合的产品并查看隐私包装和售后说明。`
      : `围绕 ${item.query} 提供清晰、可信的本地语言解答，并连接到匹配的分类和商品页面。`,
    h1Suggestion: item.query,
    sections: commercial
      ? ['核心产品与价格区间', '材质、尺寸和使用场景选择', '库存与配送时效', '隐私包装、支付和退换', '常见问题', '相关分类与产品内链']
      : ['直接回答搜索问题', '适用场景与注意事项', '选择或比较方法', '常见误区', 'FAQ', '相关分类和进一步阅读'],
    internalLinks: [`从 3–5 个相关${info.language}页面链接到 ${item.targetPage}`, '锚文本同时使用核心词、同义词和自然描述'],
    evidence: item.evidence,
    target: item.target
  };
}

function buildPageInventory(ga, gsc, siteDensity, auditPages, siteUrl) {
  const inventory = new Map();
  const ensure = (value) => {
    if (!value || value === '(not set)') return null;
    try {
      const url = new URL(value, siteUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.hash = '';
      const key = url.href;
      if (!inventory.has(key)) {
        let displayPage = key;
        try {
          const base = new URL(siteUrl);
          if (url.hostname === base.hostname) displayPage = url.pathname + url.search;
        } catch {}
        inventory.set(key, {
          url: key,
          page: displayPage || '/',
          sessions: 0,
          users: 0,
          engagedSessions: 0,
          addToCarts: 0,
          gscClicks: 0,
          gscImpressions: 0,
          gscPositionWeight: 0
        });
      }
      return inventory.get(key);
    } catch {
      return null;
    }
  };

  for (const row of rows(ga.landingPages)) {
    const page = ensure(row.path);
    if (!page) continue;
    page.sessions += Number(row.sessions || 0);
    page.users += Number(row.users || 0);
    page.engagedSessions += Number(row.engagedSessions || 0);
    page.addToCarts += Number(row.addToCarts || 0);
  }
  for (const row of rows(gsc.pages)) {
    const page = ensure(row.page);
    if (!page) continue;
    page.gscClicks += Number(row.clicks || 0);
    page.gscImpressions += Number(row.impressions || 0);
    page.gscPositionWeight += Number(row.position || 0) * Number(row.impressions || 0);
  }

  const priorityRank = { P1: 1, P2: 2, P3: 3 };
  return [...inventory.values()].map((page) => {
    const addToCartDensity = pct(page.addToCarts, page.sessions);
    const engagementRate = pct(page.engagedSessions, page.sessions);
    const gscCtr = pct(page.gscClicks, page.gscImpressions);
    const gscPosition = page.gscImpressions ? page.gscPositionWeight / page.gscImpressions : 0;
    const hasGa4 = page.sessions > 0;
    const hasGsc = page.gscImpressions > 0 || page.gscClicks > 0;
    const source = hasGa4 && hasGsc ? 'both' : hasGa4 ? 'ga4' : 'gsc';
    const sourceLabel = source === 'both' ? 'GA4 + GSC' : source === 'ga4' ? '仅 GA4' : '仅 GSC';
    const audit = auditForPage(auditPages, page.url);
    const weakBehavior = page.sessions >= 200 && (addToCartDensity < 0.01 || addToCartDensity < siteDensity * 0.8);
    const seoOpportunity = page.gscImpressions >= 100 && (gscCtr < 0.02 || (gscPosition >= 4 && gscPosition <= 20));
    const auditRisk = rows(audit?.issues).length > 0;
    const priority = auditRisk || weakBehavior || (page.gscImpressions >= 1000 && seoOpportunity)
      ? 'P1'
      : page.sessions >= 50 || page.gscImpressions >= 100 ? 'P2' : 'P3';

    let diagnosis;
    let action;
    if (auditRisk) {
      diagnosis = `页面实测发现：${audit.issues.slice(0, 4).join('；')}。`;
      action = `先修复页面实测问题，再按 GA4 行为和 GSC 搜索表现观察 14–28 天。`;
    } else if (source === 'ga4') {
      diagnosis = 'GA4 已记录该落地页访问，但本周期 GSC 页面数据中未出现，可能主要来自非自然渠道、搜索量较低或 URL 口径不同。';
      action = weakBehavior ? '先验证商品浏览和加购事件，再检查首屏商品路径、CTA、配送与信任信息。' : '检查 canonical、索引状态和自然搜索入口，并继续观察页面行为。';
    } else if (source === 'gsc') {
      diagnosis = 'GSC 已记录该 URL 的搜索曝光或点击，但 GA4 落地页中未匹配到会话，需要检查跳转、URL 参数和 GA4 页面采集。';
      action = seoOpportunity ? '优化标题、描述、页面意图和内链，同时核对 GA4 是否能正确记录该 URL。' : '先核对 GA4 页面路径和重定向，再决定是否扩大内容投入。';
    } else if (weakBehavior && seoOpportunity) {
      diagnosis = '页面同时存在站内商品行为偏弱和搜索点击/排名提升空间，应联合优化 SERP 承诺与落地页承接。';
      action = '同步优化标题描述、首屏商品模块、筛选、CTA、配送信任信息和相关内链。';
    } else if (weakBehavior) {
      diagnosis = '页面已有访问规模，但加购事件密度低于站点基准。';
      action = '先验证事件准确性，再优化商品入口、筛选、CTA 和信任模块。';
    } else if (seoOpportunity) {
      diagnosis = '页面已有搜索曝光，但 CTR 或排名仍有提升空间。';
      action = '按主要查询优化 Title、Description、H1、内容覆盖和内部链接。';
    } else {
      diagnosis = '当前样本未达到强诊断阈值，保留在全量页面库中持续观察。';
      action = '监控会话、曝光、点击、CTR、排名和加购事件密度，数据达到阈值后再创建任务。';
    }

    const evidence = `来源 ${sourceLabel}；GA4 会话 ${round(page.sessions, 0)}、加购事件 ${round(page.addToCarts, 0)}、每百次会话 ${round(addToCartDensity * 100, 2)} 次；GSC 点击 ${round(page.gscClicks, 0)}、曝光 ${round(page.gscImpressions, 0)}、CTR ${round(gscCtr * 100, 2)}%、排名 ${gscPosition ? round(gscPosition, 1) : '-'}。`;
    const score = page.sessions * 10 + page.gscClicks * 20 + page.gscImpressions + (auditRisk ? 100000 : 0);
    return {
      priority,
      page: page.page,
      url: page.url,
      source,
      sourceLabel,
      sessions: page.sessions,
      users: page.users,
      engagedSessions: page.engagedSessions,
      engagementRate,
      addToCarts: page.addToCarts,
      addToCartDensity,
      gscClicks: page.gscClicks,
      gscImpressions: page.gscImpressions,
      gscCtr,
      gscPosition,
      audited: Boolean(audit),
      auditStatus: audit?.status || 0,
      auditIssues: rows(audit?.issues),
      diagnosis,
      action,
      evidence,
      score
    };
  }).sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.score - a.score || a.page.localeCompare(b.page));
}

function generateReport(snapshot, site) {
  const ga = snapshot.current.ga4;
  const gsc = snapshot.current.gsc;
  const prevGa = snapshot.previous?.ga4?.totals || {};
  const prevGsc = snapshot.previous?.gsc?.totals || {};
  const totals = ga.totals;
  const channels = rows(ga.channels);
  const organic = channels.find((row) => row.name === 'Organic Search') || {};
  const direct = channels.find((row) => row.name === 'Direct') || {};
  const siteDensity = pct(totals.addToCarts, totals.sessions);
  const siteEngagement = pct(totals.engagedSessions, totals.sessions);
  const organicDensity = pct(organic.addToCarts, organic.sessions);
  const directDensity = pct(direct.addToCarts, direct.sessions);
  const trackingBroken = totals.addToCarts > 0 && (!totals.checkouts || !totals.purchases);
  const gscDevices = rows(gsc.devices);
  const mobile = gscDevices.find((row) => String(row.device).toUpperCase() === 'MOBILE') || {};
  const mobileShare = pct(mobile.clicks, gsc.totals.clicks);
  const benchmarks = { sessions: totals.sessions, atcRate: siteDensity, engagementRate: siteEngagement };
  const auditPages = rows(snapshot.audit?.pages);
  const pageInventory = buildPageInventory(ga, gsc, siteDensity, auditPages, site.websiteUrl);
  const pageInventorySummary = {
    total: pageInventory.length,
    both: pageInventory.filter((row) => row.source === 'both').length,
    ga4: pageInventory.filter((row) => row.source === 'ga4').length,
    gsc: pageInventory.filter((row) => row.source === 'gsc').length,
    p1: pageInventory.filter((row) => row.priority === 'P1').length,
    p2: pageInventory.filter((row) => row.priority === 'P2').length,
    p3: pageInventory.filter((row) => row.priority === 'P3').length,
    ga4PossiblyTruncated: Boolean(ga.meta?.landingPages?.possiblyTruncated),
    gscPossiblyTruncated: Boolean(gsc.meta?.pages?.possiblyTruncated),
    ga4LandingPageCount: rows(ga.landingPages).length,
    gscPageCount: rows(gsc.pages).length
  };

  const pagePriorities = rows(ga.landingPages)
    .map((row) => ({ ...row, atcRate: pct(row.addToCarts, row.sessions) }))
    .filter((row) => row.sessions >= 200 && (row.atcRate < 0.01 || row.atcRate < siteDensity))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10)
    .map((row, index) => {
      const audit = auditForPage(auditPages, row.path);
      const execution = pageExecution(row, siteDensity, audit);
      return {
        priority: index < 3 ? 'P1' : 'P2',
        page: row.path,
        sessions: row.sessions,
        addToCarts: row.addToCarts,
        atcRate: row.atcRate,
        diagnosis: audit?.issues?.length
          ? `流量已有规模，页面实测发现 ${audit.issues.slice(0, 3).join('、')}，应先修复可验证问题再观察商品行为。`
          : row.addToCarts === 0 ? '有访问但没有加购事件，先排除追踪漏报，再修复商品路径' : '流量充足，但每会话加购事件密度低于站点平均',
        action: execution.steps[0],
        evidence: execution.evidence,
        steps: execution.steps,
        target: execution.target,
        audit
      };
    });

  const queryPageMap = new Map();
  for (const row of rows(gsc.queryPages)) {
    if (!queryPageMap.has(row.query)) queryPageMap.set(row.query, []);
    queryPageMap.get(row.query).push(row);
  }
  const allQueries = rows(gsc.queries);
  const queryOpportunities = allQueries
    .filter((row) => row.impressions >= 100 && (row.ctr < 0.02 || (row.position >= 4 && row.position <= 20)))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15)
    .map((row) => {
      const intent = queryIntent(row.query);
      let action;
      if (row.position <= 10 && row.ctr < 0.02) action = `先在 GSC 确认主排名页，保留核心词相关性，重写 Title/Description 提升点击；随后补充${intent.label}所需的商品、FAQ 和 3–5 条内链。`;
      else if (row.position <= 10) action = `不要大改搜索摘要；围绕${intent.label}补强主排名页的产品覆盖、选购信息和内链，目标冲刺前 3–5 位。`;
      else if (row.position <= 20) action = `确认唯一主排名页，补齐${intent.label}内容和首屏模块，并从相关高权重页面增加内链，先推进到前 10。`;
      else action = `先检查是否由错误页面获得曝光；如无稳定匹配页，为该意图建立或重构专门页面，再处理标题、内容和内链。`;
      const peers = allQueries.filter((candidate) => Math.abs(candidate.position - row.position) <= 1 && candidate.impressions >= 50);
      const benchmarkCtr = peers.length
        ? peers.reduce((sum, candidate) => sum + candidate.clicks, 0) / Math.max(1, peers.reduce((sum, candidate) => sum + candidate.impressions, 0))
        : gsc.totals.ctr;
      const rankingPages = (queryPageMap.get(row.query) || []).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
      return {
        ...row,
        type: row.position <= 10 ? '4-10 位冲刺词' : row.position <= 20 ? '11-20 位增长词' : '低排名/低点击词',
        action,
        targetPage: pagePath(rankingPages[0]?.page),
        benchmarkCtr,
        potentialClicks: Math.max(0, Math.round(row.impressions * benchmarkCtr - row.clicks)),
        confidence: row.impressions >= 1000 ? '高' : row.impressions >= 300 ? '中' : '观察',
        effort: row.position <= 10 ? '低-中' : row.position <= 20 ? '中' : '高'
      };
    });

  const marketCountries = rows(ga.countries)
    .map((row) => behavior(row, totals.sessions))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15)
    .map((row) => {
      const priority = marketPriority(row, benchmarks);
      return { ...row, priority, strategy: marketStrategy(priority, row) };
    });

  const languages = rows(ga.languages)
    .map((row) => behavior(row, totals.sessions))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 15)
    .map((row) => {
      const priority = marketPriority(row, benchmarks);
      return { ...row, label: languageName(row.language), priority, strategy: marketStrategy(priority, row) };
    });

  const countryTotals = new Map(rows(ga.countries).map((row) => [row.country, row.sessions]));
  const countryLanguages = rows(ga.countryLanguages)
    .map((row) => ({ ...behavior(row, totals.sessions), countryShare: pct(row.sessions, countryTotals.get(row.country)) }))
    .filter((row) => row.sessions >= 25)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)
    .map((row) => ({
      ...row,
      languageLabel: languageName(row.language),
      insight: row.countryShare >= 0.2 ? '该语言已形成明显市场份额，应核查对应语言页面与导航承接。' : '属于长尾语言组合，先检查是否被错误跳转或错误标记。'
    }));

  const countryChannels = rows(ga.countryChannels)
    .map((row) => ({ ...behavior(row, totals.sessions), countryShare: pct(row.sessions, countryTotals.get(row.country)) }))
    .filter((row) => row.sessions >= 25)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)
    .map((row) => ({
      ...row,
      strategy: row.sessionDefaultChannelGroup === 'Organic Search'
        ? '用该国家的 GSC 关键词与落地页继续扩展 SEO，并检查本地语言承接。'
        : '核查该渠道在该国家的落地页、UTM 归因和商品路径是否一致。'
    }));

  const countries = rows(gsc.countries).sort((a, b) => b.clicks - a.clicks).slice(0, 12).map((row) => ({
    ...row,
    strategy: row.ctr >= gsc.totals.ctr ? '已有搜索需求基础，扩展本地化分类页、内链和信任文案。' : '曝光存在但点击偏弱，先优化标题描述并验证本地搜索意图。'
  }));
  const devices = gscDevices.sort((a, b) => b.clicks - a.clicks).map((row) => ({
    ...row,
    strategy: String(row.device).toUpperCase() === 'MOBILE' ? '首屏优先显示商品、筛选、CTA、支付与配送信任信息。' : '检查搜索摘要与首屏信息密度，保持商品路径清晰。'
  }));
  const countryDevices = rows(gsc.countryDevices)
    .filter((row) => row.impressions >= 50)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20)
    .map((row) => ({
      ...row,
      strategy: String(row.device).toUpperCase() === 'MOBILE'
        ? '用该国家的移动端搜索结果和真实设备验收标题、速度、首屏与 CTA。'
        : '检查该国家桌面端标题描述、页面信息密度与分类导航。'
    }));
  const countryQueries = rows(gsc.countryQueries)
    .filter((row) => row.impressions >= 50 && (row.ctr < 0.02 || (row.position >= 4 && row.position <= 20)))
    .map((row) => countryQueryExecution(row, { gsc, marketCountries, siteAtc: siteDensity }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((row, index) => ({
      ...row,
      priority: index < 3 ? 'P1' : index < 10 ? 'P2' : 'P3',
      type: row.position <= 10 ? '第一页冲刺' : row.position <= 20 ? '第二页突破' : '页面重建'
    }));

  const seoRoadmap = [
    ...countryQueries.slice(0, 6).map((row, index) => ({
      priority: index < 3 ? 'P1' : 'P2',
      title: `${row.countryLabel}：${row.query}`,
      page: row.targetPage,
      evidence: row.evidence,
      diagnosis: row.diagnosis,
      steps: row.steps.slice(0, 5),
      target: row.target
    })),
    ...pagePriorities.slice(0, 3).map((row, index) => ({
      priority: index === 0 ? 'P1' : 'P2',
      title: `落地页转化与 SEO 承接：${row.page}`,
      page: row.page,
      evidence: row.evidence,
      diagnosis: row.diagnosis,
      steps: row.steps.slice(0, 5),
      target: row.target
    }))
  ].slice(0, 8);

  const dataHealth = buildDataHealth(snapshot, totals, gsc, channels);
  const trend = buildTrend(snapshot);
  const cannibalization = buildCannibalization(gsc);
  const contentBriefs = countryQueries.slice(0, 8).map(buildContentBrief);
  const conclusions = [];
  conclusions.push('当前仅使用 GA4 与 GSC 数据，报告不判断真实订单、收入、广告花费、ROAS 或利润。');
  conclusions.push('本期获得 ' + totals.sessions.toLocaleString('zh-CN') + ' 次会话，较上期' + direction(change(totals.sessions, prevGa.sessions)) + ' ' + Math.abs(round((change(totals.sessions, prevGa.sessions) || 0) * 100)) + '%；自然搜索占会话 ' + round(pct(organic.sessions, totals.sessions) * 100) + '%。');
  conclusions.push('GSC 获得 ' + gsc.totals.clicks.toLocaleString('zh-CN') + ' 次点击，较上期' + direction(change(gsc.totals.clicks, prevGsc.clicks)) + ' ' + Math.abs(round((change(gsc.totals.clicks, prevGsc.clicks) || 0) * 100)) + '%，整体 CTR 为 ' + round(gsc.totals.ctr * 100, 2) + '%。');
  if (marketCountries[0]) conclusions.push('GA4 最大访问市场为 ' + marketCountries[0].country + '，贡献 ' + round(marketCountries[0].share * 100) + '% 会话，当前建议为“' + marketCountries[0].priority + '”。');
  if (languages[0]) conclusions.push('最大浏览器语言为 ' + languages[0].label + '，贡献 ' + round(languages[0].share * 100) + '% 会话；语言分析代表用户浏览器偏好，不等同于网站已正确提供该语言页面。');
  if (organicDensity < directDensity) conclusions.push('自然搜索每百次会话产生 ' + round(organicDensity * 100, 2) + ' 次加购事件，低于直接访问的 ' + round(directDensity * 100, 2) + ' 次。该指标是事件密度，不等同于发生加购的会话转化率；仍应优先检查 SEO 落地页的商品路径。');
  if (trackingBroken) conclusions.push('GA4 已记录加购，但 begin_checkout 或 purchase 为 0，当前首要数据风险是结账与购买事件缺失，不能把 0 解释为没有真实成交。');
  if (dataHealth.level !== '高') conclusions.push(`本报告数据可信度为“${dataHealth.level}”，存在 ${dataHealth.warningCount} 个警告和 ${dataHealth.failCount} 个失败项；在解释大幅变化前先处理数据健康中心中的问题。`);

  const topSeo = countryQueries[0];
  const topPage = pagePriorities[0];
  const actions = [
    { phase: '7 天', priority: 'P1', owner: '数据/开发', action: '补齐 begin_checkout 与 purchase 事件，并验证商品参数、币种和页面来源', outcome: '恢复可用的转化漏斗' },
    { phase: '7 天', priority: 'P1', owner: '运营/CRO', action: topPage ? `先改 ${topPage.page}：${topPage.steps.slice(0, 2).join(' ')}` : '改造流量最高但加购事件密度低于站点平均的落地页', outcome: topPage ? topPage.target : '提升现有流量的商品浏览与加购' },
    { phase: '7 天', priority: 'P1', owner: 'SEO/本地化', action: topSeo ? `先处理 ${topSeo.countryLabel} 的“${topSeo.query}”，目标页 ${topSeo.targetPage}。${topSeo.steps.slice(0, 2).join(' ')}` : '处理高曝光低 CTR 或排名 4-20 的核心查询', outcome: topSeo ? topSeo.target : '获得更多自然点击并提升重点词排名' },
    { phase: '30 天', priority: 'P2', owner: '本地化', action: marketCountries[0] ? '围绕 ' + marketCountries[0].country + ' 完善主语言页面、配送、支付、退换和信任内容' : '为高潜国家完善语言、配送、支付、退换和信任内容', outcome: '降低重点市场的决策阻力' },
    { phase: '30 天', priority: 'P2', owner: '内容/SEO', action: '按国家拆分 4-20 位商业查询，补充分类文案、FAQ、对比内容和内链', outcome: '推动重点国家优先词进入前 10 位' },
    { phase: '60-90 天', priority: 'P3', owner: 'SEO/技术', action: '建立国家与语言主题集群，规范 canonical/hreflang，并持续清理重复和蚕食页面', outcome: '形成可持续的多市场自然增长结构' }
  ];

  return {
    version: 4,
    generatedAt: new Date().toISOString(),
    site,
    period: snapshot.period,
    previousPeriod: snapshot.previousPeriod,
    boundary: '仅分析 GA4、Google Search Console 与绑定域名的公开页面，不包含订单、收入、广告和利润数据。add_to_cart 展示为事件密度，不等同于会话转化率或真实成交。',
    conclusions,
    kpis: {
      sessions: totals.sessions,
      sessionsChange: change(totals.sessions, prevGa.sessions),
      organicSessions: organic.sessions || 0,
      organicShare: pct(organic.sessions, totals.sessions),
      engagementRate: siteEngagement,
      addToCartRate: siteDensity,
      addToCartDensity: siteDensity,
      addToCartEvents: totals.addToCarts,
      gscClicks: gsc.totals.clicks,
      gscClicksChange: change(gsc.totals.clicks, prevGsc.clicks),
      gscImpressions: gsc.totals.impressions,
      gscCtr: gsc.totals.ctr,
      averagePosition: gsc.totals.position
    },
    channels: channels.map((row) => behavior(row, totals.sessions)),
    pagePriorities,
    pageInventory,
    pageInventorySummary,
    queryOpportunities,
    seoRoadmap,
    contentBriefs,
    cannibalization,
    pageAudits: auditPages,
    auditSummary: snapshot.audit || null,
    dataHealth,
    trend,
    searchAppearances: rows(gsc.searchAppearances),
    marketCountries,
    languages,
    countryLanguages,
    countryChannels,
    countries,
    devices,
    countryDevices,
    countryQueries,
    tracking: {
      status: trackingBroken ? '需要修复' : '基础事件可用',
      addToCarts: totals.addToCarts,
      checkouts: totals.checkouts,
      purchases: totals.purchases,
      recommendations: trackingBroken ? [
        '在进入结账页时发送 begin_checkout。',
        '在支付成功页发送 purchase，并携带 transaction_id、value、currency。',
        '商品数组发送 item_id、item_name、item_category、price、quantity。',
        '同时保留 page_location、page_referrer 与 UTM，完成 DebugView 和实时报告验收。'
      ] : ['每周抽查关键事件数量、参数完整性与渠道归因。']
    },
    marketInsight: mobileShare >= 0.5 ? '移动端贡献 ' + round(mobileShare * 100) + '% 的自然点击，应作为各国家页面改造和验收的第一设备。' : '桌面与移动流量较均衡，各国家页面改造需要双端同步验收。',
    actions,
    weeklyKpis: [
      '各重点国家 sessions、engagement rate 与每百次会话 add_to_cart 事件数',
      '各浏览器语言的流量占比与行为质量',
      '国家 × 渠道的会话、互动率和加购事件密度',
      '国家 × 设备的 GSC clicks、CTR 与平均排名',
      '重点国家商业查询的 CTR 与排名变化',
      'Organic Search sessions 与环比',
      'begin_checkout 与 purchase 是否持续可用',
      '前三个重点落地页的 sessions、商品点击、加购事件密度与发生加购的会话数'
    ]
  };
}

module.exports = { generateReport, pct, change, round };
