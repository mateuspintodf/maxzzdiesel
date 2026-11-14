// Scheduled (Vercel Cron) sync of available stock from Unleashed into a private blob for the B2B portal.
// Keeps only ProductCode -> AvailableQty. Cost fields in the Unleashed response (AvgCost, TotalCost) are dropped.
const { ul, configured } = require('../lib/unleashed');
const { readJson, writeJson } = require('../lib/store');

const BUDGET = 240 * 1000;
let running = false;
function stamp(ms) { return new Date(ms).toISOString().slice(0, 19); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  if (running) return res.status(429).json({ error: 'already running' });
  running = true;
  const t0 = Date.now();
  let st = null;
  try {
    st = (await readJson('portal/stock-sync.json')) || { mode: 'full', page: 1, qty: {}, startedAt: t0, syncedAt: 0 };
    const full = st.mode === 'full';
    const q = full ? 'pageSize=1000' : 'pageSize=1000&modifiedSince=' + stamp(st.syncedAt - 10 * 60 * 1000);
    let page = full ? st.page : 1, pages = 1;
    do {
      const data = await ul(`StockOnHand/${page}`, q, { timeoutMs: 90000 });
      pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
      for (const x of data.Items || []) {
        if (!x.ProductCode) continue;
        const n = Number(x.AvailableQty);
        st.qty[x.ProductCode] = isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
      }
      if (full) st.page = page;
      page++;
    } while (page <= pages && Date.now() - t0 < BUDGET);
    const done = page > pages;
    if (done) { st.syncedAt = full ? st.startedAt : t0; st.mode = 'incremental'; }
    await writeJson('portal/stock-sync.json', st);
    if (done) await writeJson('portal/stock.json', { at: Date.now(), qty: st.qty });
    const out = { ok: true, mode: st.mode, products: Object.keys(st.qty).length, complete: done, ms: Date.now() - t0 };
    console.log('cron-stock', JSON.stringify(out));
    return res.json(out);
  } catch (e) {
    console.error('cron-stock failed', e.message);
    if (st && st.mode === 'full') await writeJson('portal/stock-sync.json', st).catch(() => {});
    return res.status(502).json({ ok: false, error: e.message, ms: Date.now() - t0 });
  } finally { running = false; }
};
