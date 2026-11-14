// Scheduled (Vercel Cron) refresh of the public catalog from Unleashed into Blob storage.
// Only product code, description, group and brand are kept: no cost, price or stock is stored.
const { put } = require('@vercel/blob');
const { ul, configured } = require('../lib/unleashed');
const { toRow } = require('../lib/catalog-map');

let last = 0;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  if (Date.now() - last < 5 * 60 * 1000) return res.status(429).json({ error: 'too soon' });
  last = Date.now();
  const t0 = Date.now(), rows = [];
  try {
    let page = 1, pages = 1;
    do {
      const data = await ul(`Products/${page}`, 'pageSize=500&includeObsolete=false');
      pages = (data.Pagination && data.Pagination.NumberOfPages) || 1;
      for (const p of data.Items || []) {
        if (p.Obsolete || p.IsSellable === false) continue;
        const row = toRow({ code: p.ProductCode, description: p.ProductDescription,
          group: p.ProductGroup && p.ProductGroup.GroupName, brand: p.ProductBrand && p.ProductBrand.BrandName });
        if (row) rows.push(row);
      }
      page++;
    } while (page <= pages && page <= 60);
    if (rows.length < 500) throw new Error('too few products: ' + rows.length);
    await put('catalog/live.json', JSON.stringify(rows), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
    console.log('cron-catalog ok', rows.length, pages + ' pages', Date.now() - t0 + 'ms');
    return res.json({ ok: true, products: rows.length, pages, ms: Date.now() - t0 });
  } catch (e) {
    console.error('cron-catalog failed', e.message, Date.now() - t0 + 'ms');
    return res.status(502).json({ ok: false, error: e.message, ms: Date.now() - t0 });
  }
};
