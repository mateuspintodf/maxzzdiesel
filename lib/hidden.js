// Products hidden from customers (seen only by admins). Database mode only; cached for a minute per instance.
// A hidden part that is in a live campaign is shown while the campaign runs.
const db = require('./db');
let memo = { at: 0, set: new Set() };
async function hiddenSet() {
  if (process.env.PORTAL_DB !== '1' || !db.configured()) return new Set();
  if (Date.now() - memo.at < 60e3) return memo.set;
  try {
    const set = new Set((await db.selectAll('hidden_products', 'select=code&order=code')).map((r) => r.code));
    const live = await require('./campaigns').liveCodes().catch(() => new Set());
    live.forEach((c) => set.delete(c));
    memo = { at: Date.now(), set };
  }
  catch (e) { console.error('hidden products', e.message); memo.at = Date.now(); }
  return memo.set;
}
module.exports = { hiddenSet };
