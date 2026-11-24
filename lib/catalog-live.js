// The public part catalog, the same rows the store uses: the copy api/cron-catalog.js refreshes from Unleashed every
// 30 minutes, or the bundled snapshot in data/catalog.json when the live copy cannot be read. Catalog fixes applied.
// Hidden parts are not removed here: callers filter them with lib/hidden.
const fs = require('fs');
const path = require('path');
const FIX = require('./catalog-fix');

let memo = { at: 0, rows: null, src: 'snapshot' };
const TTL = 30 * 60 * 1000;

async function loadLive() {
  const { head, get } = require('@vercel/blob');
  const h = await head('catalog/live.json').catch(() => null);
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}
const loadSnapshot = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8'));

// raw rows (before fixes) and where they came from
async function raw() {
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
  return memo;
}

// fixed rows, ready to show; at is when the rows were read (lets callers rebuild their own index only when it changed)
async function rows() {
  const m = await raw();
  return { rows: await FIX.apply(m.rows), src: m.src, at: m.at };
}

module.exports = { rows, raw };
