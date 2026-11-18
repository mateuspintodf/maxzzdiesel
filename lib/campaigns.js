// Product campaigns (Black Friday and the like): a name, a badge shown on the parts, a discount rule and a list of parts.
// The discount is applied inside the price book, so the portal shows it and the order is priced with it the same way.
// kind 'percent': value = % off the customer's own price (tier price). kind 'price': value = a fixed unit price.
// A part can carry its own value (override). When a part is in two live campaigns, the lower price wins.
// stack_vouchers: whether a voucher may also discount the campaign parts (off by default). A hidden part that is in a live
// campaign shows to customers while the campaign runs (lib/hidden.js).
const db = require('./db');
let memo = { at: 0, list: null };

async function live(force) {
  if (!force && memo.list && Date.now() - memo.at < 60e3) return memo.list;
  if (!db.configured() || process.env.PORTAL_DB !== '1') return [];
  try {
    const now = new Date().toISOString();
    const cs = await db.select('campaigns', 'select=*&active=eq.true&starts_at=lte.' + now + '&ends_at=gt.' + now + '&order=ends_at');
    for (const c of cs) c.items = await db.selectAll('campaign_products', 'select=code,value&campaign_id=eq.' + c.id);
    memo = { at: Date.now(), list: cs };
  } catch (e) { console.error('campaigns', e.message); memo.at = Date.now(); memo.list = memo.list || []; }
  return memo.list;
}

// best campaign price for one part given its normal price; returns null when no campaign applies
function bestFor(list, code, price) {
  let best = null;
  for (const c of list) {
    const it = c.itemsBy || (c.itemsBy = Object.fromEntries(c.items.map((i) => [i.code, i])));
    const i = it[code]; if (!i) continue;
    // fixed-price campaigns only use the price set on each part; % campaigns fall back to the campaign %
    if (c.kind === 'price' && !(Number(i.value) > 0)) continue;
    const v = i.value != null ? Number(i.value) : Number(c.value);
    let p = c.kind === 'price' ? v : price != null ? price * (1 - Math.min(100, Math.max(0, v)) / 100) : null;
    if (!(p > 0)) continue;
    if (price != null && p >= price) continue;
    p = Math.round(p * 100) / 100;
    if (!best || p < best.price) best = { price: p, slug: c.slug, stack: !!c.stack_vouchers, name: c.name };
  }
  return best;
}

// what the open storefront may see: no prices, only which parts are in which campaign
async function publicList(hidden) {
  return (await live()).map((c) => ({ slug: c.slug, name: c.name, badge: c.badge || c.name, description: c.description || '', color: c.color || '#d32a37', banner: c.banner_url || '', starts_at: c.starts_at, ends_at: c.ends_at,
    pct: c.kind === 'percent' ? Number(c.value) : null, vouchers: !!c.stack_vouchers, all: !!c.show_all, codes: c.items.map((i) => i.code).filter((x) => !hidden || !hidden.has(x)) }));
}

// codes in any live campaign (they are shown even when hidden)
async function liveCodes() { const s = new Set(); (await live()).forEach((c) => c.items.forEach((i) => s.add(i.code))); return s; }

module.exports = { liveCodes, live, bestFor, publicList, reset: () => { memo = { at: 0, list: null }; } };
