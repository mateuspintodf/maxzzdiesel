// GET /api/catalog
// Returns the public part catalog (code, description, category, brand, market, engines).
// Serves the copy refreshed from Unleashed by the cron job (api/cron-catalog.js),
// or the bundled snapshot in data/catalog.json when there is none. No prices or stock leave the server.
const { hiddenSet } = require('../lib/hidden');
const CL = require('../lib/catalog-live');

module.exports = async (req, res) => {
  try {
    const c = await CL.rows();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Catalog-Source', c.src);
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    const hid = await hiddenSet();
    const rows = c.rows;
    res.status(200).send(JSON.stringify(hid.size ? rows.filter((r) => !hid.has(r[0])) : rows));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'catalog unavailable' });
  }
};
