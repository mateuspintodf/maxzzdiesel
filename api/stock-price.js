// POST /api/stock-price  { codes: ["BO.0.445.120.342", ...] }   (password protected by middleware.js)
// Internal use only: returns sell prices and available stock from Unleashed for the given product codes.
// Never returns cost fields (average landed cost, last cost). Nothing here is cached publicly.
const crypto = require('crypto');
const API = 'https://api.unleashedsoftware.com';

function sign(query, key) { return crypto.createHmac('sha256', key).update(query).digest('base64'); }

async function ul(path, query, id, key) {
  const r = await fetch(`${API}/${path}?${query}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-auth-id': id,
               'api-auth-signature': sign(query, key), 'client-type': 'maxzzdiesel/website' }
  });
  if (!r.ok) throw new Error(`Unleashed ${path} ${r.status}`);
  return r.json();
}

async function allPages(path, query, id, key, max = 30) {
  const out = []; let page = 1, pages = 1;
  do {
    const d = await ul(`${path}/${page}`, query, id, key);
    pages = (d.Pagination && d.Pagination.NumberOfPages) || 1;
    out.push(...(d.Items || []));
    page++;
  } while (page <= pages && page <= max);
  return out;
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = []; for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const id = process.env.UNLEASHED_API_ID, key = process.env.UNLEASHED_API_KEY;
  if (!id || !key) return res.status(503).json({ error: 'Unleashed not configured' });
  try {
    const { codes } = await body(req);
    if (!Array.isArray(codes) || !codes.length || codes.length > 1000) return res.status(400).json({ error: 'codes[] required (max 1000)' });
    const want = new Set(codes.map(String));
    const [products, stock] = await Promise.all([
      allPages('Products', 'pageSize=1000&includeObsolete=false', id, key),
      allPages('StockOnHand', 'pageSize=1000', id, key)
    ]);
    const out = {};
    for (const p of products) {
      if (!want.has(p.ProductCode)) continue;
      const tiers = {};
      for (let i = 1; i <= 10; i++) {
        const t = p[`SellPriceTier${i}`];
        if (t && t.Value != null && Number(t.Value) > 0) tiers[t.Name || `Tier ${i}`] = Number(t.Value);
      }
      out[p.ProductCode] = { sellPrice: p.DefaultSellPrice != null ? Number(p.DefaultSellPrice) : null, tiers,
                             unit: p.UnitOfMeasure && p.UnitOfMeasure.Name, available: 0, onHand: 0 };
    }
    for (const s of stock) {
      const o = out[s.ProductCode];
      if (!o) continue;
      o.available += Number(s.AvailableQty || 0);
      o.onHand += Number(s.QtyOnHand || 0);
    }
    const missing = codes.filter((c) => !out[c]);
    return res.status(200).json({ at: new Date().toISOString(), items: out, missing });
  } catch (e) {
    console.error('stock-price error', e.message);
    return res.status(502).json({ error: 'Unleashed request failed' });
  }
};
