const crypto = require('node:crypto');
const { google } = require('googleapis');
const { DateTime } = require('luxon');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
];

function createOAuthClient(config, tokens) {
  const client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri || config.appBaseUrl + '/auth/google/callback'
  );
  if (tokens) client.setCredentials(tokens);
  return client;
}

function relaySignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function isPrivateRelayReturnUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.pathname !== '/auth/google/relay/callback') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host) ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

function createRelayState({ returnTo, csrf }, secret, now = Date.now()) {
  if (!secret || !isPrivateRelayReturnUrl(returnTo))
    throw new Error('Invalid OAuth relay configuration');
  const payload = Buffer.from(JSON.stringify({ v: 1, returnTo, csrf, iat: now }))
    .toString('base64url');
  return `lan.${payload}.${relaySignature(payload, secret)}`;
}

function readRelayState(state, secret, options = {}) {
  const [prefix, payload, signature] = String(state || '').split('.');
  if (prefix !== 'lan' || !payload || !signature || !secret)
    throw new Error('Invalid OAuth relay state');
  const expected = relaySignature(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer))
    throw new Error('Invalid OAuth relay state');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const now = options.now || Date.now();
  const maxAgeMs = options.maxAgeMs || 15 * 60 * 1000;
  if (value.v !== 1 || !value.csrf || !isPrivateRelayReturnUrl(value.returnTo) ||
      !Number.isFinite(value.iat) || value.iat > now + 60_000 || now - value.iat > maxAgeMs)
    throw new Error('Expired or invalid OAuth relay state');
  return value;
}

function relayEncryptionKey(secret) {
  return crypto.createHash('sha256').update(`searchops-oauth-relay:${secret}`).digest();
}

function sealRelayPayload(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', relayEncryptionKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

function openRelayPayload(value, secret) {
  const [iv, tag, body] = String(value || '').split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !body)
    throw new Error('Invalid OAuth relay payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', relayEncryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}

function authorizationUrl(config, state) {
  return createOAuthClient(config).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state
  });
}

async function exchangeCode(config, code) {
  const client = createOAuthClient(config);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const profile = await oauth2.userinfo.get();
  return { tokens, profile: profile.data };
}

async function listResources(config, tokens) {
  const auth = createOAuthClient(config, tokens);
  const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });
  const searchConsole = google.webmasters({ version: 'v3', auth });
  const [accountResponse, sitesResponse] = await Promise.all([
    analyticsAdmin.accountSummaries.list({ pageSize: 200 }),
    searchConsole.sites.list()
  ]);
  const properties = [];
  for (const account of accountResponse.data.accountSummaries || []) {
    for (const property of account.propertySummaries || []) {
      properties.push({
        id: String(property.property || '').replace('properties/', ''),
        name: property.displayName || property.property,
        account: account.displayName || account.account
      });
    }
  }
  const sites = (sitesResponse.data.siteEntry || [])
    .filter((site) => site.permissionLevel && site.permissionLevel !== 'siteUnverifiedUser')
    .map((site) => ({ url: site.siteUrl, permission: site.permissionLevel }));
  return { properties, sites };
}

function metric(row, index) {
  return Number(row.metricValues?.[index]?.value || 0);
}

function dimension(row, index) {
  return row.dimensionValues?.[index]?.value || '';
}

function ga4Behavior(row, dimensionNames, includeCommerce) {
  const result = {};
  dimensionNames.forEach((name, index) => {
    result[name] = dimension(row, index) || '(not set)';
  });
  result.sessions = metric(row, 0);
  result.users = metric(row, 1);
  result.engagedSessions = metric(row, 2);
  result.addToCarts = includeCommerce ? metric(row, 3) : 0;
  result.checkouts = includeCommerce ? metric(row, 4) : 0;
  result.purchases = includeCommerce ? metric(row, 5) : 0;
  return result;
}

async function ga4Run(auth, propertyId, body) {
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const response = await analyticsData.properties.runReport({
    property: 'properties/' + String(propertyId).replace('properties/', ''),
    requestBody: body
  });
  return response.data;
}

async function ga4RunAll(auth, propertyId, body, pageSize = 100000, maxPages = 10) {
  const rows = [];
  let firstResponse = null;
  let rowCount = 0;
  let pageCount = 0;
  while (pageCount < maxPages) {
    const response = await ga4Run(auth, propertyId, {
      ...body,
      limit: String(pageSize),
      offset: String(rows.length)
    });
    if (!firstResponse) firstResponse = response;
    const chunk = response.rows || [];
    rows.push(...chunk);
    rowCount = Number(response.rowCount || rows.length);
    pageCount += 1;
    if (!chunk.length || chunk.length < pageSize || rows.length >= rowCount) break;
  }
  return {
    ...(firstResponse || {}),
    rows,
    rowCount,
    queryMeta: {
      rowCount: rows.length,
      availableRowCount: rowCount,
      pagesFetched: pageCount,
      possiblyTruncated: rows.length < rowCount
    }
  };
}

async function pullGa4Breakdowns(auth, propertyId, startDate, endDate, metrics, includeCommerce, detailed) {
  const dateRanges = [{ startDate, endDate }];
  const definitions = [
    ['daily', ['date'], 400],
    ['channels', ['sessionDefaultChannelGroup'], 100],
    ['landingPages', ['landingPagePlusQueryString'], 100000, true],
    ['countries', ['country'], 250],
    ['languages', ['language'], 250],
    ['devices', ['deviceCategory'], 20],
    ['countryLanguages', ['country', 'language'], 1000],
    ['countryChannels', ['country', 'sessionDefaultChannelGroup'], 1000],
    ['countryLandingPages', ['country', 'landingPagePlusQueryString'], 2500]
  ].filter(([key]) => detailed || key === 'daily');
  const results = await Promise.all(definitions.map(async ([key, dimensionNames, limit, paginate]) => {
    const request = (reportMetrics) => {
      const body = {
        dateRanges,
        dimensions: dimensionNames.map((name) => ({ name })),
        metrics: reportMetrics,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: String(limit)
      };
      return paginate ? ga4RunAll(auth, propertyId, body, limit) : ga4Run(auth, propertyId, body);
    };
    let data;
    let rowHasCommerce = includeCommerce;
    try {
      data = await request(metrics);
    } catch (error) {
      if (!includeCommerce || !String(error.message).includes('metric')) throw error;
      data = await request([{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }]);
      rowHasCommerce = false;
    }
    return [key, (data.rows || []).map((row) => ga4Behavior(row, dimensionNames, rowHasCommerce)), data.queryMeta];
  }));
  const breakdowns = {};
  const meta = {};
  for (const [key, rows, queryMeta] of results) {
    breakdowns[key] = rows;
    if (queryMeta) meta[key] = queryMeta;
  }
  return { ...breakdowns, meta };

}

async function pullGa4Period(auth, propertyId, startDate, endDate, detailed = true) {
  const ecommerceMetrics = [
    { name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' },
    { name: 'addToCarts' }, { name: 'checkouts' }, { name: 'ecommercePurchases' }
  ];
  let totals;
  let breakdowns = {};
  let breakdownMetrics = ecommerceMetrics;
  let breakdownHasCommerce = true;
  try {
    const totalResult = await ga4Run(auth, propertyId, { dateRanges: [{ startDate, endDate }], metrics: ecommerceMetrics });
    const row = totalResult.rows?.[0] || {};
    totals = { sessions: metric(row, 0), users: metric(row, 1), engagedSessions: metric(row, 2), addToCarts: metric(row, 3), checkouts: metric(row, 4), purchases: metric(row, 5) };
  } catch (error) {
    if (!String(error.message).includes('metric')) throw error;
    const basic = [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }];
    const totalResult = await ga4Run(auth, propertyId, { dateRanges: [{ startDate, endDate }], metrics: basic });
    const row = totalResult.rows?.[0] || {};
    totals = { sessions: metric(row, 0), users: metric(row, 1), engagedSessions: metric(row, 2), addToCarts: 0, checkouts: 0, purchases: 0 };
    breakdownMetrics = basic;
    breakdownHasCommerce = false;
  }
  breakdowns = await pullGa4Breakdowns(auth, propertyId, startDate, endDate, breakdownMetrics, breakdownHasCommerce, detailed);
  return {
    totals,
    daily: (breakdowns.daily || []).map(({ date, ...row }) => ({
      date: String(date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
      ...row
    })),
    channels: (breakdowns.channels || []).map(({ sessionDefaultChannelGroup, ...row }) => ({ name: sessionDefaultChannelGroup || 'Unassigned', ...row })),
    landingPages: (breakdowns.landingPages || []).map(({ landingPagePlusQueryString, ...row }) => ({ path: landingPagePlusQueryString || '(not set)', ...row })),
    countries: breakdowns.countries || [],
    languages: breakdowns.languages || [],
    devices: breakdowns.devices || [],
    countryLanguages: breakdowns.countryLanguages || [],
    countryChannels: breakdowns.countryChannels || [],
    countryLandingPages: breakdowns.countryLandingPages || [],
    meta: breakdowns.meta || {}
  };
}

async function gscQuery(api, siteUrl, startDate, endDate, dimensions, rowLimit = 25000, startRow = 0) {
  const response = await api.searchanalytics.query({
    siteUrl,
    requestBody: { startDate, endDate, dimensions, rowLimit, startRow, dataState: 'final' }
  });
  const data = response.data;
  data.queryMeta = {
    dimensions,
    rowLimit,
    rowCount: (data.rows || []).length,
    possiblyTruncated: (data.rows || []).length >= rowLimit
  };
  return data;
}

async function gscQueryAll(api, siteUrl, startDate, endDate, dimensions, rowLimit = 25000, maxPages = 10) {
  const collected = [];
  let lastMeta = null;
  let pageCount = 0;
  while (pageCount < maxPages) {
    const chunk = await gscQuery(api, siteUrl, startDate, endDate, dimensions, rowLimit, collected.length);
    const chunkRows = chunk.rows || [];
    collected.push(...chunkRows);
    lastMeta = chunk.queryMeta;
    pageCount += 1;
    if (chunkRows.length < rowLimit) break;
  }
  return {
    rows: collected,
    queryMeta: {
      ...(lastMeta || { dimensions, rowLimit }),
      rowCount: collected.length,
      pagesFetched: pageCount,
      possiblyTruncated: pageCount >= maxPages && collected.length >= rowLimit * maxPages
    }
  };
}

function gscRows(data, key) {
  return (data.rows || []).map((row) => ({
    [key]: row.keys?.[0] || '', clicks: Number(row.clicks || 0), impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0), position: Number(row.position || 0)
  }));
}

function gscMultiRows(data, keys) {
  return (data.rows || []).map((row) => {
    const result = {};
    keys.forEach((key, index) => { result[key] = row.keys?.[index] || ''; });
    return {
      ...result,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0)
    };
  });
}

async function pullGscPeriod(auth, siteUrl, startDate, endDate, detailed = true) {
  const api = google.webmasters({ version: 'v3', auth });
  const [totalData, daily] = await Promise.all([
    gscQuery(api, siteUrl, startDate, endDate, []),
    gscQuery(api, siteUrl, startDate, endDate, ['date'], 500)
  ]);
  const totals = totalData.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const base = {
    totals: { clicks: Number(totals.clicks || 0), impressions: Number(totals.impressions || 0), ctr: Number(totals.ctr || 0), position: Number(totals.position || 0) },
    daily: gscRows(daily, 'date'),
    meta: { daily: daily.queryMeta }
  };
  if (!detailed) return base;
  const [queries, pages, countries, devices, countryDevices, countryQueries, countryQueryPages, queryPages, searchAppearances] = await Promise.all([
    gscQuery(api, siteUrl, startDate, endDate, ['query']),
    gscQueryAll(api, siteUrl, startDate, endDate, ['page']),
    gscQuery(api, siteUrl, startDate, endDate, ['country']),
    gscQuery(api, siteUrl, startDate, endDate, ['device']),
    gscQuery(api, siteUrl, startDate, endDate, ['country', 'device'], 5000),
    gscQuery(api, siteUrl, startDate, endDate, ['country', 'query'], 10000),
    gscQuery(api, siteUrl, startDate, endDate, ['country', 'query', 'page'], 25000),
    gscQuery(api, siteUrl, startDate, endDate, ['query', 'page'], 25000),
    gscQuery(api, siteUrl, startDate, endDate, ['searchAppearance'], 1000).catch(() => ({ rows: [], queryMeta: { dimensions: ['searchAppearance'], rowLimit: 1000, rowCount: 0, possiblyTruncated: false, unavailable: true } }))
  ]);
  return {
    ...base,
    queries: gscRows(queries, 'query'),
    pages: gscRows(pages, 'page'),
    countries: gscRows(countries, 'country'),
    devices: gscRows(devices, 'device'),
    countryDevices: gscMultiRows(countryDevices, ['country', 'device']),
    countryQueries: gscMultiRows(countryQueries, ['country', 'query']),
    countryQueryPages: gscMultiRows(countryQueryPages, ['country', 'query', 'page']),
    queryPages: gscMultiRows(queryPages, ['query', 'page']),
    searchAppearances: gscRows(searchAppearances, 'searchAppearance'),
    meta: {
      ...base.meta,
      queries: queries.queryMeta,
      pages: pages.queryMeta,
      countryQueries: countryQueries.queryMeta,
      countryQueryPages: countryQueryPages.queryMeta,
      queryPages: queryPages.queryMeta,
      searchAppearances: searchAppearances.queryMeta
    }
  };
}

function resolveReportingDates(options = {}) {
  const latestComplete = DateTime.utc().minus({ days: 3 }).startOf('day');
  const requestedStart = DateTime.fromISO(String(options.startDate || ''), { zone: 'utc' });
  const requestedEnd = DateTime.fromISO(String(options.endDate || ''), { zone: 'utc' });
  let end = requestedEnd.isValid ? requestedEnd.startOf('day') : latestComplete;
  if (end > latestComplete) end = latestComplete;
  const requestedDays = Math.min(180, Math.max(7, Number(options.days || 28)));
  let start = requestedStart.isValid ? requestedStart.startOf('day') : end.minus({ days: requestedDays - 1 });
  if (start > end) start = end.minus({ days: requestedDays - 1 });
  if (end.diff(start, 'days').days > 179) start = end.minus({ days: 179 });
  const durationDays = Math.round(end.diff(start, 'days').days) + 1;
  const previousEnd = start.minus({ days: 1 });
  const previousStart = previousEnd.minus({ days: durationDays - 1 });
  return {
    period: { start: start.toISODate(), end: end.toISODate(), days: durationDays },
    previousPeriod: { start: previousStart.toISODate(), end: previousEnd.toISODate(), days: durationDays },
    latestCompleteDate: latestComplete.toISODate()
  };
}

async function propertyMetadata(auth, propertyId) {
  try {
    const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth });
    const response = await analyticsAdmin.properties.get({
      name: 'properties/' + String(propertyId).replace('properties/', '')
    });
    return {
      timeZone: response.data.timeZone || '',
      currencyCode: response.data.currencyCode || '',
      displayName: response.data.displayName || ''
    };
  } catch (error) {
    return { timeZone: '', currencyCode: '', displayName: '', error: error.message };
  }
}

async function syncSite(config, tokens, site, options = {}) {
  const auth = createOAuthClient(config, tokens);
  const range = resolveReportingDates(options);
  const dates = range.period;
  const previousDates = range.previousPeriod;
  const [ga4, gsc, previousGa4, previousGsc, property] = await Promise.all([
    pullGa4Period(auth, site.ga4_property_id, dates.start, dates.end, true),
    pullGscPeriod(auth, site.gsc_site_url, dates.start, dates.end, true),
    pullGa4Period(auth, site.ga4_property_id, previousDates.start, previousDates.end, false),
    pullGscPeriod(auth, site.gsc_site_url, previousDates.start, previousDates.end, false),
    propertyMetadata(auth, site.ga4_property_id)
  ]);
  return {
    source: 'google-api',
    generatedAt: new Date().toISOString(),
    period: dates,
    previousPeriod: previousDates,
    current: { ga4, gsc },
    previous: { ga4: previousGa4, gsc: previousGsc },
    metadata: {
      latestCompleteDate: range.latestCompleteDate,
      ga4Property: property,
      gscDataState: 'final',
      gscRowLimits: gsc.meta || {}
    }
  };
}

module.exports = {
  SCOPES,
  createOAuthClient,
  authorizationUrl,
  exchangeCode,
  listResources,
  syncSite,
  resolveReportingDates,
  createRelayState,
  readRelayState,
  sealRelayPayload,
  openRelayPayload,
  isPrivateRelayReturnUrl,
};
