// GET /api/catalog
// Returns the public part catalog (code, description, category, brand, market, engines).
// Reads live from Unleashed when UNLEASHED_API_ID and UNLEASHED_API_KEY are set,
// otherwise serves the bundled snapshot in data/catalog.json. No prices or stock leave the server.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { toRow } = require('../lib/catalog-map');

const API = 'https://api.unleashedsoftware.com';
let memo = { at: 0, rows: null };
const TTL = 30 * 60 * 1000;

async function unleashedPage(page, id, key) {
  const query = 'pageSize=1000&includeObsolete=false';
  const sig = crypto.createHmac('sha256', key).update(query).digest('base64');
  const r = await fetch(`${API}/Products/${page}?${query}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-auth-id': id, 'api-auth-signature': sig, 'client-type': 'maxzzdiesel/website' }
  });
  if (!r.ok) throw new Error('Unleashed ' + r.status);
  return r.json();
}

async function loadLive() {
  const id = process.env.UNLEASHED_API_ID, key = process.env.UNLEASHED_API_KEY;
  if (!id || !key) return null;
  const rows = [];
  let page = 1, pages = 1;
  do {
    const data = await unleashedPage(page, id, key);
    pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
    for (const p of data.Items || []) {
      if (p.Obsolete || p.IsSellable === false) continue;
      const row = toRow({
        code: p.ProductCode,
        description: p.ProductDescription,
        group: p.ProductGroup && p.ProductGroup.GroupName,
        brand: p.ProductBrand && p.ProductBrand.BrandName
      });
      if (row) rows.push(row);
    }
    page++;
  } while (page <= pages && page <= 50);
  return rows;
}

function loadSnapshot() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8'));
}

module.exports = async (req, res) => {
  try {
    if (!memo.rows || Date.now() - memo.at > TTL) {
      let rows = null;
      try { rows = await loadLive(); } catch (e) { console.error('catalog live failed', e.message); }
      memo = { at: Date.now(), rows: rows && rows.length ? rows : (memo.rows || loadSnapshot()) };
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify(memo.rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'catalog unavailable' });
  }
};
