// GET /api/instock
// Returns the product codes that have stock on hand right now (no quantities, no prices).
// Built from the stock copy api/cron-stock.js keeps in the private store. Used by the quick part finder.
const { readJson } = require('../lib/store');

let memo = { at: 0, codes: null };
const TTL = 10 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    if (!memo.codes || Date.now() - memo.at > TTL) {
      const st = await readJson('portal/stock.json');
      const qty = (st && st.qty) || {};
      const codes = Object.keys(qty).filter((c) => Number(qty[c]) > 0);
      memo = { at: Date.now(), codes: codes.length ? codes : null };
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).send(JSON.stringify({ codes: memo.codes }));
  } catch (e) {
    console.error('instock failed', e.message);
    res.status(200).json({ codes: null });
  }
};
