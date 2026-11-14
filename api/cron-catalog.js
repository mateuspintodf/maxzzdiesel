// Scheduled (Vercel Cron, every 30 min) sync of the public catalog from Unleashed into Blob storage.
// Unleashed is slow (about 20s per page of 500 products), so a full load runs in chunks across runs and
// keeps its progress in catalog/sync.json; once complete, later runs only fetch products modified since.
// Public copy (catalog/live.json): code, description, group and brand only.
// Private copy for the B2B portal (portal/products.json): Unleashed GUID, sell price tiers, default sell price and image.
// Cost fields are never read into either copy.
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

const V = 2; // bump to force a full reload when the stored shape changes

function num(v) { const n = Number(v); return isFinite(n) && v !== null && v !== '' ? n : null; }
function privOf(p) {
  const t = []; for (let i = 1; i <= 10; i++) { const x = p['SellPriceTier' + i]; t.push(x ? num(x.Value) : null); }
  const img = (p.Images || []).find((i) => i.IsDefault) || (p.Images || [])[0];
  return { g: p.Guid, t, d: num(p.DefaultSellPrice), img: (img && img.Url) || p.ImageUrl || null, u: p.UnitOfMeasure && p.UnitOfMeasure.Name || null };
}
function tierNames(p) { const n = []; for (let i = 1; i <= 10; i++) { const x = p['SellPriceTier' + i]; n.push(x && x.Name ? x.Name : 'Sell Price Tier ' + i); } return n; }

function mapProduct(p) {
  return toRow({ code: p.ProductCode, description: p.ProductDescription,
    group: p.ProductGroup && p.ProductGroup.GroupName, brand: p.ProductBrand && p.ProductBrand.BrandName });
}

// Unleashed wants modifiedSince as yyyy-MM-ddTHH:mm:ss (UTC)
function stamp(ms) { return new Date(ms).toISOString().slice(0, 19); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  // with CRON_SECRET set, only Vercel Cron (which sends it) may run this; without it, only requests from Vercel Cron's agent
  if (secret ? req.headers.authorization !== `Bearer ${secret}` : !/vercel-cron/i.test(req.headers['user-agent'] || '')) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  if (running) return res.status(429).json({ error: 'already running' });
  running = true;
  const t0 = Date.now();
  let state = null;
  try {
    state = await readJson('catalog/sync.json');
    if (!state || state.v !== V) state = { v: V, mode: 'full', page: 1, rows: {}, priv: {}, tiers: null, startedAt: t0, syncedAt: 0 };
    let pages = state.pages || 1, done = false;

    if (state.mode === 'full') {
      // chunked full load
      while (Date.now() - t0 < BUDGET) {
        const data = await ul(`Products/${state.page}`, `pageSize=${SIZE}&includeObsolete=false`, { timeoutMs: 90000 });
        pages = state.pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
        for (const p of data.Items || []) {
          if (p.Obsolete || p.IsSellable === false) continue;
          const row = mapProduct(p); if (row) { state.rows[row[0]] = row; state.priv[p.ProductCode] = privOf(p); }
          if (!state.tiers) state.tiers = tierNames(p);
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
          if (p.Obsolete || p.IsSellable === false) { for (const k of Object.keys(state.rows)) if (state.rows[k][0] === p.ProductCode || k === code) delete state.rows[k]; delete state.priv[p.ProductCode]; }
          else if (row) { state.rows[code] = row; state.priv[p.ProductCode] = privOf(p); }
        }
        page++;
      } while (page <= pages && Date.now() - t0 < BUDGET);
      done = page > pages;
      if (done) state.syncedAt = t0;
    }

    await put('catalog/sync.json', JSON.stringify(state), OPTS);
    const rows = Object.values(state.rows);
    if (state.mode === 'incremental' && rows.length >= 500) {
      await put('catalog/live.json', JSON.stringify(rows), OPTS);
      await put('portal/products.json', JSON.stringify({ at: Date.now(), tiers: state.tiers, items: state.priv }), OPTS);
    }
    const out = { ok: true, mode: state.mode, page: state.page, pages, products: rows.length, complete: state.mode === 'incremental', ms: Date.now() - t0 };
    console.log('cron-catalog', JSON.stringify(out));
    return res.json(out);
  } catch (e) {
    console.error('cron-catalog failed', e.message, Date.now() - t0 + 'ms');
    if (state && state.mode === 'full') await put('catalog/sync.json', JSON.stringify(state), OPTS).catch(() => {}); // keep the pages already loaded
    return res.status(502).json({ ok: false, error: e.message, ms: Date.now() - t0 });
  } finally { running = false; }
};
