// Scheduled (Vercel Cron, every 30 min) sync of the public catalog from Unleashed into Blob storage.
// Unleashed is slow (about 20s per page of 500 products), so a full load runs in chunks across runs and
// keeps its progress in catalog/sync.json; once complete, later runs only fetch products modified since.
// Only product code, description, group and brand are stored: no cost, price or stock.
const { put, head, get } = require('@vercel/blob');
const { ul, configured } = require('../lib/unleashed');
const { toRow } = require('../lib/catalog-map');

const BUDGET = 240 * 1000; // stop starting new pages after 4 minutes (function limit is 5)
const SIZE = 500;
const OPTS = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' };
let running = false;

async function readJson(name) {
  const h = await head(name).catch(() => null);
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch (e) { return null; }
}

function mapProduct(p) {
  return toRow({ code: p.ProductCode, description: p.ProductDescription,
    group: p.ProductGroup && p.ProductGroup.GroupName, brand: p.ProductBrand && p.ProductBrand.BrandName });
}

// Unleashed wants modifiedSince as yyyy-MM-ddTHH:mm:ss (UTC)
function stamp(ms) { return new Date(ms).toISOString().slice(0, 19); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  if (running) return res.status(429).json({ error: 'already running' });
  running = true;
  const t0 = Date.now();
  let state = null;
  try {
    state = (await readJson('catalog/sync.json')) || { mode: 'full', page: 1, rows: {}, startedAt: t0, syncedAt: 0 };
    let pages = state.pages || 1, done = false;

    if (state.mode === 'full') {
      // chunked full load
      while (Date.now() - t0 < BUDGET) {
        const data = await ul(`Products/${state.page}`, `pageSize=${SIZE}&includeObsolete=false`, { timeoutMs: 90000 });
        pages = state.pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
        for (const p of data.Items || []) {
          if (p.Obsolete || p.IsSellable === false) continue;
          const row = mapProduct(p); if (row) state.rows[row[0]] = row;
        }
        if (state.page >= pages) { done = true; break; }
        state.page++;
      }
      if (done) { state.mode = 'incremental'; state.syncedAt = state.startedAt; }
    } else {
      // only what changed since the last sync; obsolete or unsellable products are removed
      const since = stamp(state.syncedAt - 10 * 60 * 1000);
      let page = 1;
      do {
        const data = await ul(`Products/${page}`, `pageSize=${SIZE}&includeObsolete=true&modifiedSince=${since}`, { timeoutMs: 90000 });
        pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
        for (const p of data.Items || []) {
          const row = mapProduct(p);
          const code = row ? row[0] : null;
          if (p.Obsolete || p.IsSellable === false) { for (const k of Object.keys(state.rows)) if (state.rows[k][0] === p.ProductCode || k === code) delete state.rows[k]; }
          else if (row) state.rows[code] = row;
        }
        page++;
      } while (page <= pages && Date.now() - t0 < BUDGET);
      done = page > pages;
      if (done) state.syncedAt = t0;
    }

    await put('catalog/sync.json', JSON.stringify(state), OPTS);
    const rows = Object.values(state.rows);
    if (state.mode === 'incremental' && rows.length >= 500) await put('catalog/live.json', JSON.stringify(rows), OPTS);
    const out = { ok: true, mode: state.mode, page: state.page, pages, products: rows.length, complete: state.mode === 'incremental', ms: Date.now() - t0 };
    console.log('cron-catalog', JSON.stringify(out));
    return res.json(out);
  } catch (e) {
    console.error('cron-catalog failed', e.message, Date.now() - t0 + 'ms');
    if (state && state.mode === 'full') await put('catalog/sync.json', JSON.stringify(state), OPTS).catch(() => {}); // keep the pages already loaded
    return res.status(502).json({ ok: false, error: e.message, ms: Date.now() - t0 });
  } finally { running = false; }
};
