const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDemoSnapshot } = require('../src/demo');
const { generateReport } = require('../src/report');

test('generates a complete GA4 and GSC Chinese operating report', () => {
  const snapshot = buildDemoSnapshot();
  snapshot.current.gsc.pages.push({ page: 'https://example.com/gsc-only-guide', clicks: 3, impressions: 420, ctr: 0.0071, position: 14.2 });
  const report = generateReport(snapshot, { name: 'Demo', websiteUrl: 'https://example.com/' });
  assert.equal(report.site.name, 'Demo');
  assert.equal(report.kpis.sessions, 18642);
  assert.ok(report.conclusions.length >= 4);
  assert.ok(report.pagePriorities.some((row) => row.page.includes('/blogs/')));
  assert.ok(report.queryOpportunities.some((row) => row.query === 'lightweight hiking backpack'));
  assert.equal(report.tracking.status, '需要修复');
  assert.ok(report.actions.some((row) => row.phase === '60-90 天'));
  assert.equal(report.version, 4);
  assert.ok(report.marketCountries.some((row) => row.country === 'United States' && row.priority === '扩量'));
  assert.ok(report.languages.some((row) => row.label.includes('德语')));
  assert.ok(report.countryLanguages.some((row) => row.country === 'Germany' && row.language === 'de-de'));
  assert.ok(report.countryChannels.some((row) => row.sessionDefaultChannelGroup === 'Organic Search'));
  assert.ok(report.countryDevices.some((row) => row.country === 'usa' && row.device === 'MOBILE'));
  assert.ok(report.countryQueries.some((row) => row.query === 'wanderrucksack'));
  assert.ok(report.countryQueries.some((row) => row.targetPage.includes('/de/collections/wanderrucksaecke')));
  assert.ok(report.countryQueries.every((row) => row.evidence && row.diagnosis && row.steps.length >= 4 && row.target));
  assert.ok(new Set(report.countryQueries.map((row) => row.steps.join('|'))).size > 1);
  assert.ok(report.seoRoadmap.length >= 5);
  assert.ok(report.pagePriorities.every((row) => row.evidence && row.steps.length >= 3 && row.target));
  assert.equal(report.pageInventorySummary.total, report.pageInventory.length);
  assert.ok(report.pageInventory.length > report.pagePriorities.length);
  assert.ok(report.pageInventory.some((row) => row.page === '/gsc-only-guide' && row.source === 'gsc' && row.gscImpressions === 420));
  assert.ok(report.pageInventory.every((row) => row.url && row.priority && row.diagnosis && row.action && row.evidence));
  assert.ok(report.conclusions.some((row) => row.includes('最大访问市场')));
  assert.ok(report.actions.some((row) => row.action.includes('United States')));
  assert.equal(report.dataHealth.level, '高');
  assert.equal(report.trend.length, 28);
  assert.ok(report.pageAudits.length >= 4);
  assert.ok(report.contentBriefs.length > 0);
  assert.ok(report.cannibalization.some((row) => row.query === 'lightweight hiking backpack'));
  assert.ok(report.queryOpportunities.every((row) => Number.isFinite(row.potentialClicks)));
  assert.ok(report.boundary.includes('事件密度'));
});

test('downgrades confidence when GA4 and GSC move sharply in opposite directions', () => {
  const snapshot = buildDemoSnapshot();
  snapshot.previous.ga4.totals.sessions = snapshot.current.ga4.totals.sessions * 4;
  snapshot.previous.gsc.totals.clicks = snapshot.current.gsc.totals.clicks / 2;
  const report = generateReport(snapshot, { name: 'Divergence', websiteUrl: 'https://example.com/' });
  assert.equal(report.dataHealth.level, '中');
  assert.ok(report.dataHealth.checks.some((row) => row.key === 'cross-source' && row.status === 'warn'));
  assert.ok(report.conclusions.some((row) => row.includes('数据可信度为“中”')));
});


test('does not expose revenue or advertising targets', () => {
  const report = generateReport(buildDemoSnapshot(), { name: 'Demo', websiteUrl: 'https://example.com/' });
  const text = JSON.stringify(report);
  assert.ok(report.boundary.includes('不包含订单、收入、广告和利润数据'));
  assert.equal(text.includes('广告花费目标'), false);
});

test('keeps working when older snapshots do not have market breakdowns', () => {
  const snapshot = buildDemoSnapshot();
  delete snapshot.current.ga4.countries;
  delete snapshot.current.ga4.languages;
  delete snapshot.current.ga4.devices;
  delete snapshot.current.ga4.countryLanguages;
  delete snapshot.current.ga4.countryChannels;
  delete snapshot.current.ga4.countryLandingPages;
  delete snapshot.current.gsc.countryDevices;
  delete snapshot.current.gsc.countryQueries;
  delete snapshot.current.gsc.countryQueryPages;
  const report = generateReport(snapshot, { name: 'Legacy', websiteUrl: 'https://example.com/' });
  assert.deepEqual(report.marketCountries, []);
  assert.deepEqual(report.languages, []);
  assert.deepEqual(report.countryQueries, []);
  assert.ok(report.seoRoadmap.length > 0);
  assert.ok(report.conclusions.length >= 3);
});
