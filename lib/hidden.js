// Products hidden from customers (seen only by admins). Database mode only; cached for a minute per instance.
const db = require('./db');
let memo = { at: 0, set: new Set() };
async function hiddenSet() {
  if (process.env.PORTAL_DB !== '1' || !db.configured()) return new Set();
  if (Date.now() - memo.at < 60e3) return memo.set;
  try { memo = { at: Date.now(), set: new Set((await db.select('hidden_products', 'select=code')).map((r) => r.code)) }; }
  catch (e) { console.error('hidden products', e.message); memo.at = Date.now(); }
  return memo.set;
}
module.exports = { hiddenSet };
