// Scheduled (Vercel Cron, daily) "bought together" map from Unleashed sales history.
// Reads completed sales orders from the last 24 months, a few pages per run (Unleashed is slow), and counts how
// often two products appear on the same order. Only product codes and counts are kept: no customers, prices or
// cost fields are stored (the order JSON is read in memory and discarded line by line).
// Progress lives in portal/related-sync.json; the finished map is portal/related.json { at, rel: { code: [codes] } }.
// A full rebuild starts again once the map is older than 7 days.
const { put, head, get } = require('@vercel/blob');
const { ul, configured } = require('../lib/unleashed');

const BUDGET = 240 * 1000;
const SIZE = 200;
const MONTHS = 24;
const TOP = 8;
const MAX_LINES = 40; // very large orders (stock orders, distributors) say little about what goes together
const OPTS = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' };
let running = false;

async function readJson(name) {
  const h = await head(name).catch(() => null);
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch (e) { return null; }
}

function since() { const d = new Date(); d.setMonth(d.getMonth() - MONTHS); return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret ? req.headers.authorization !== `Bearer ${secret}` : !/vercel-cron/i.test(req.headers['user-agent'] || '')) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  if (running) return res.status(429).json({ error: 'already running' });
  running = true;
  const t0 = Date.now();
  try {
    let st = await readJson('portal/related-sync.json');
    const done = await readJson('portal/related.json');
    if (!st || st.done) {
      if (st && st.done && done && Date.now() - done.at < 7 * 864e5) return res.json({ ok: true, fresh: true });
      st = { page: 1, pages: null, from: since(), orders: 0, counts: {}, done: false };
    }
    while (Date.now() - t0 < BUDGET) {
      const data = await ul(`SalesOrders/${st.page}`, `pageSize=${SIZE}&orderStatus=Completed&startDate=${st.from}`, { timeoutMs: 90000 });
      st.pages = (data && data.Pagination && data.Pagination.NumberOfPages) || 1;
      for (const o of (data && data.Items) || []) {
        const codes = [...new Set((o.SalesOrderLines || []).map((l) => l && l.Product && l.Product.ProductCode).filter(Boolean))];
        if (codes.length < 2 || codes.length > MAX_LINES) continue;
        st.orders++;
        for (const a of codes) {
          const m = st.counts[a] || (st.counts[a] = {});
          for (const b of codes) if (a !== b) m[b] = (m[b] || 0) + 1;
        }
      }
      if (st.page >= st.pages) { st.done = true; break; }
      st.page++;
    }
    if (st.done) {
      const rel = {};
      for (const [a, m] of Object.entries(st.counts)) {
        const top = Object.entries(m).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, TOP).map(([c]) => c);
        if (top.length) rel[a] = top;
      }
      await put('portal/related.json', JSON.stringify({ at: Date.now(), orders: st.orders, rel }), OPTS);
      st.counts = {};
    }
    await put('portal/related-sync.json', JSON.stringify(st), OPTS);
    const out = { ok: true, page: st.page, pages: st.pages, orders: st.orders, done: st.done, ms: Date.now() - t0 };
    console.log('cron-related', JSON.stringify(out));
    return res.json(out);
  } catch (e) {
    console.error('cron-related', e.message);
    return res.status(500).json({ error: 'sync failed' });
  } finally { running = false; }
};
