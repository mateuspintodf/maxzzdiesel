// Data for the internal sales dashboard (/painel). Protected by middleware.js (DASH_PASSWORD).
// GET /api/dash-data?from=YYYY-MM-DD&to=YYYY-MM-DD  (defaults to the last 30 days)
// Returns raw, privacy-light rows for the period and the period before it; the page does the math.
const { hs } = require('../lib/hubspot');

const PIPE = { '71230012': 'USA', '71274341': 'Latin America' };
const SOURCE = { ORGANIC_SEARCH: 'Organic search', PAID_SEARCH: 'Paid search', EMAIL_MARKETING: 'Email marketing', SOCIAL_MEDIA: 'Organic social', PAID_SOCIAL: 'Paid social', REFERRALS: 'Referrals', OTHER_CAMPAIGNS: 'Other campaigns', DIRECT_TRAFFIC: 'Direct traffic', OFFLINE: 'Offline / imports', AI_REFERRALS: 'AI referrals' };
const DAY = 864e5;

function parseRange(q) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const now = Date.now();
  let end = ok(q.to) ? Date.parse(q.to) + DAY - 1 : now;
  let start = ok(q.from) ? Date.parse(q.from) : end - 30 * DAY;
  if (!(start < end)) start = end - 30 * DAY;
  if (end - start > 400 * DAY) start = end - 400 * DAY;
  const len = end - start;
  return { start, end, prevStart: start - len, days: Math.round(len / DAY) };
}

async function searchAll(object, from, to, properties, maxPages) {
  const out = [];
  let after;
  for (let i = 0; i < maxPages; i++) {
    const r = await hs(`/crm/v3/objects/${object}/search`, 'POST', {
      filterGroups: [{ filters: [
        { propertyName: 'createdate', operator: 'GTE', value: String(from) },
        { propertyName: 'createdate', operator: 'LTE', value: String(to) }] }],
      properties, limit: 100, after, sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }]
    });
    out.push(...(r.results || []).map((x) => x.properties));
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return { rows: out, cut: Boolean(after) };
}

async function deals(R) {
  const { rows, cut } = await searchAll('deals', R.prevStart, R.end, ['dealname', 'pipeline', 'createdate', 'hs_is_closed', 'hs_is_closed_won', 'amount', 'num_contacted_notes'], 20);
  return { cut, rows: rows.filter((r) => /^(Quote request|DTA kit offer)/.test(r.dealname || '')).map((r) => ({
    kind: /^DTA/.test(r.dealname) ? 'dta' : 'quote', name: r.dealname, region: PIPE[r.pipeline] || 'Other', created: r.createdate,
    closed: r.hs_is_closed === 'true', won: r.hs_is_closed_won === 'true', amount: Number(r.amount) || 0, contacts: Number(r.num_contacted_notes) || 0 })) };
}

async function contacts(R) {
  const { rows, cut } = await searchAll('contacts', R.prevStart, R.end, ['createdate', 'hs_analytics_source'], 60);
  const m = new Map();
  rows.forEach((r) => { const k = String(r.createdate).slice(0, 10) + '|' + (SOURCE[r.hs_analytics_source] || r.hs_analytics_source || 'Unknown'); m.set(k, (m.get(k) || 0) + 1); });
  return { cut, rows: [...m].map(([k, n]) => { const [d, s] = k.split('|'); return { d, s, n }; }) };
}

async function email(R) {
  const span = R.end - R.start;
  const interval = span <= 35 * DAY ? 'DAY' : span <= 200 * DAY ? 'WEEK' : 'MONTH';
  const q = new URLSearchParams({ interval, startTimestamp: new Date(R.prevStart).toISOString(), endTimestamp: new Date(R.end).toISOString() });
  const r = await hs(`/marketing/v3/emails/statistics/histogram?${q}`, 'GET');
  const rows = (r.results || []).map((p) => {
    const c = (p.aggregations && p.aggregations.counters) || p.counters || {};
    const start = (p.interval && p.interval.start) || p.start || p.date;
    return { start: String(start).slice(0, 10), sent: c.sent || 0, delivered: c.delivered || 0, opens: c.open || 0, clicks: c.click || 0,
      replies: c.reply || 0, unsubs: c.unsubscribed || 0, bounces: c.bounce || 0 };
  }).filter((x) => x.start && x.start !== 'undefined').sort((a, b) => (a.start < b.start ? -1 : 1));
  return { interval, rows };
}

async function hotmart(R) {
  const { HOTMART_CLIENT_ID: id, HOTMART_CLIENT_SECRET: secret, HOTMART_BASIC: basic } = process.env;
  if (!id || !secret || !basic) return { connected: false, rows: [] };
  const tk = await fetch(`https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
    { method: 'POST', headers: { Authorization: 'Basic ' + basic.replace(/^Basic\s+/i, ''), 'Content-Type': 'application/json' } }).then((r) => r.json());
  if (!tk.access_token) throw new Error('Hotmart auth failed');
  const out = [];
  let page;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ start_date: String(R.prevStart), end_date: String(R.end), max_results: '500' });
    if (page) q.set('page_token', page);
    const r = await fetch(`https://developers.hotmart.com/payments/api/v1/sales/history?${q}`, { headers: { Authorization: 'Bearer ' + tk.access_token } }).then((x) => x.json());
    (r.items || []).forEach((it) => {
      const p = it.purchase || {};
      out.push({ date: new Date(p.approved_date || p.order_date || 0).toISOString().slice(0, 10), product: (it.product && it.product.name) || 'Course',
        value: (p.price && Number(p.price.value)) || 0, currency: (p.price && p.price.currency_code) || 'USD', status: p.status || '' });
    });
    page = r.page_info && r.page_info.next_page_token;
    if (!page) break;
  }
  return { connected: true, rows: out };
}


async function shopify(R) {
  const { SHOPIFY_STORE: store, SHOPIFY_ADMIN_TOKEN: token } = process.env;
  if (!store || !token) return { connected: false, rows: [] };
  const host = store.includes('.') ? store : `${store}.myshopify.com`;
  const q = `query($cursor: String, $q: String) { orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    edges { node { createdAt displayFinancialStatus cancelledAt currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 20) { edges { node { title quantity } } } } }
    pageInfo { hasNextPage endCursor } } }`;
  const filter = `created_at:>=${new Date(R.prevStart).toISOString().slice(0, 10)} created_at:<=${new Date(R.end).toISOString().slice(0, 10)}`;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`https://${host}/admin/api/2025-07/graphql.json`, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { cursor, q: filter } }) }).then((x) => x.json());
    if (r.errors) throw new Error('Shopify: ' + JSON.stringify(r.errors).slice(0, 150));
    const o = r.data && r.data.orders;
    if (!o) break;
    o.edges.forEach(({ node: n }) => {
      if (n.cancelledAt) return;
      out.push({ date: n.createdAt.slice(0, 10), value: Number(n.currentTotalPriceSet.shopMoney.amount) || 0, currency: n.currentTotalPriceSet.shopMoney.currencyCode,
        status: n.displayFinancialStatus || '', items: n.lineItems.edges.map((e) => ({ title: e.node.title, qty: e.node.quantity })) });
    });
    if (!o.pageInfo.hasNextPage) break;
    cursor = o.pageInfo.endCursor;
  }
  return { connected: true, rows: out };
}

async function settle(fn) {
  try { return { status: 'ok', ...(await fn()) }; } catch (e) { console.error(e); return { status: 'error', message: String(e.message || e).slice(0, 200) }; }
}

module.exports = async (req, res) => {
  if (!process.env.HUBSPOT_TOKEN) return res.status(503).json({ error: 'crm not configured' });
  const R = parseRange(req.query || {});
  const [d, c, e, h, sh] = await Promise.all([settle(() => deals(R)), settle(() => contacts(R)), settle(() => email(R)), settle(() => hotmart(R)), settle(() => shopify(R))]);
  let unleashed;
  // Snapshot of Unleashed revenue by customer lives in an env var, never in the (public) repo.
  try { unleashed = { status: 'ok', period: 'Jul 2025 to Jun 2026', rows: JSON.parse(process.env.UNLEASHED_SNAPSHOT || '[]') }; }
  catch (err) { unleashed = { status: 'error', message: 'snapshot unreadable' }; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    generated: new Date().toISOString(),
    range: { from: new Date(R.start).toISOString().slice(0, 10), to: new Date(R.end).toISOString().slice(0, 10), prevFrom: new Date(R.prevStart).toISOString().slice(0, 10), days: R.days },
    deals: d, contacts: c, email: e, hotmart: h, shopify: sh, unleashed
  });
};
