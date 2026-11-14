// GET /api/catalog
// Returns the public part catalog (code, description, category, brand, market, engines).
// Serves the copy refreshed from Unleashed by the cron job (api/cron-catalog.js),
// or the bundled snapshot in data/catalog.json when there is none. No prices or stock leave the server.
const fs = require('fs');
const path = require('path');
const { toRow } = require('../lib/catalog-map');

const { head, get } = require('@vercel/blob');
let memo = { at: 0, rows: null, src: 'snapshot' };
const TTL = 30 * 60 * 1000;

// Live catalog = the copy api/cron-catalog.js refreshes from Unleashed every 30 minutes.
async function loadLive() {
  const h = await head('catalog/live.json').catch(() => null);
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}

function loadSnapshot() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8'));
}

module.exports = async (req, res) => {
  try {
    if (!memo.rows || Date.now() - memo.at > TTL) {
      let rows = null;
      const t0 = Date.now();
      try {
        rows = await Promise.race([loadLive(), new Promise((_, no) => setTimeout(() => no(new Error('timeout 5s')), 5000))]);
        console.log('catalog live ok', rows && rows.length, Date.now() - t0 + 'ms');
      } catch (e) { console.error('catalog live failed', e.message, Date.now() - t0 + 'ms'); }
      const live = !!(rows && rows.length);
      memo = { at: Date.now(), rows: live ? rows : (memo.rows || loadSnapshot()), src: live ? 'live' : (memo.rows ? memo.src : 'snapshot') };
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Catalog-Source', memo.src);
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify(memo.rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'catalog unavailable' });
  }
};
