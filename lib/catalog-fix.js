// What the store shows is the Unleashed catalog with two corrections made here:
//  - the engine parts range (Volvo Engine Kits, sold on its own site) is left out;
//  - a category fixed by hand in the admin (Catalog) wins over the one worked out from the Unleashed product group.
const db = require('./db');

const CATS = { injectors: 'Injector', pumps: 'Pump', nozzle: 'Nozzle', rail: 'Rail', seal: 'Repair part', tool: 'Tool', fluids: 'Fluid', kits: 'Kit' };
let memo = { at: 0, map: {} };
const TTL = 5 * 60 * 1000;

async function overrides(fresh) {
  if (!fresh && Date.now() - memo.at < TTL) return memo.map;
  const map = {};
  if (db.configured()) {
    try { (await db.selectAll('product_overrides', 'select=code,category')).forEach((r) => { if (CATS[r.category]) map[r.code] = r.category; }); }
    catch (e) { console.error('catalog overrides', e.message); return memo.map; } // keep the last good copy
  }
  memo = { at: Date.now(), map };
  return map;
}
function clear() { memo.at = 0; }

// rows: [code, description, slug, category, brand, market, engines]
async function apply(rows, fresh) {
  const ov = await overrides(fresh);
  const out = [];
  for (const r of rows || []) {
    if (r[2] === 'engine') continue;
    const k = ov[r[0]];
    if (k && k !== r[2]) { const c = r.slice(); c[2] = k; c[3] = CATS[k]; out.push(c); } else out.push(r);
  }
  return out;
}

module.exports = { apply, overrides, clear, CATS };
