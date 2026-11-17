// Max Rewards: points per invoiced dollar, levels on the last 12 months, rewards redeemed from the balance.
// Off until an admin turns it on (loyalty_settings.enabled). While off, customers see the preview and admins see the real numbers.
// Points are written once per order, when Unleashed reports it as Completed (invoiced). Savings rewards become a one-time voucher
// for the company; the other rewards go to the sales team as a request.
const crypto = require('crypto');
const db = require('./db');
const { cached } = require('./store');
const { notifyTeam } = require('./notify');

const LEVELS = [
  { k: 'app', n: 'Apprentice', at: 0 },
  { k: 'tech', n: 'Technician', at: 10000 },
  { k: 'spec', n: 'Specialist', at: 25000 },
  { k: 'master', n: 'Master', at: 50000 }
];
// id, category, icon, name, description, points, voucher value (Savings only), minimum subtotal for the voucher
const CATALOG = [
  ['off50', 'Savings', 'off', 'US$ 50 off your next order', 'A one-time voucher for your company, valid 90 days.', 5000, 50, 0],
  ['off150', 'Savings', 'off', 'US$ 150 off your next order', 'A one-time voucher for orders over US$ 1,000, valid 90 days.', 14000, 150, 1000],
  ['off400', 'Savings', 'off', 'US$ 400 off a pump or injector set', 'A one-time voucher for orders over US$ 2,500, valid 90 days.', 35000, 400, 2500],
  ['freight', 'Shipping', 'ship', 'Free ground freight', 'One order, any size, inside the US.', 4000],
  ['nda', 'Shipping', 'fast', 'Next Day Air upgrade', 'When the truck is down and the part cannot wait.', 8000],
  ['fluid', 'Products', 'fluid', 'ISO 4113 calibration fluid, 5 gal', 'Calibration fluid for your test bench.', 6000],
  ['tool250', 'Products', 'tool', 'Robiel tool up to US$ 250', 'Pick any Robiel tool from the catalog up to this value.', 22000],
  ['jacket', 'Products', 'shirt', 'Maxzz shop jacket and cap', 'Workwear for the bench, in your team size.', 3000],
  ['dta1', 'Training', 'school', 'Diesel Tech Academy course', 'One online course for a technician on your team.', 12000],
  ['dtaall', 'Training', 'school', 'DTA complete bundle', 'Every DTA course for one technician.', 40000],
  ['bench', 'Experiences', 'bench', 'Bench day at Maxzz Florida', 'A day at our Coconut Creek bench with our technicians.', 35000],
  ['session', 'Experiences', 'mic', 'Private technical session', 'One hour online with our senior instructor on your toughest case.', 30000],
  ['meetup', 'Experiences', 'people', 'Trade show meetup', 'Lunch with the Maxzz team at ADS or AAPEX.', 20000]
].map((r) => ({ id: r[0], c: r[1], i: r[2], n: r[3], d: r[4], p: r[5], value: r[6] || 0, min: r[7] || 0 }));

const YEAR = 365 * 24 * 3600 * 1000;
async function settings() {
  const s = (await db.select('loyalty_settings', 'select=*&id=eq.1'))[0];
  return s || { enabled: false, points_per_usd: 1, expiry_months: null };
}
function levelOf(points) { let cur = LEVELS[0]; LEVELS.forEach((l) => { if (points >= l.at) cur = l; }); return cur; }

async function summary(companyId) {
  const s = await settings();
  const rows = companyId ? await db.select('loyalty_ledger', 'select=points,reason,at,order_id,expires_at&company_id=eq.' + companyId + '&order=at.desc&limit=500') : [];
  const now = Date.now();
  const live = rows.filter((r) => !r.expires_at || Date.parse(r.expires_at) > now);
  const balance = live.reduce((a, r) => a + r.points, 0);
  const year = rows.filter((r) => r.points > 0 && now - Date.parse(r.at) < YEAR).reduce((a, r) => a + r.points, 0);
  return {
    enabled: !!s.enabled, rate: Number(s.points_per_usd) || 1, balance: Math.max(0, balance), year, level: levelOf(year).k,
    history: rows.slice(0, 30).map((r) => ({ points: r.points, reason: r.reason, at: Date.parse(r.at) })),
    catalog: CATALOG.map((x) => ({ id: x.id, c: x.c, i: x.i, n: x.n, d: x.d, p: x.p }))
  };
}

// points for one invoiced order: 1 per dollar (rate from settings), double on tool sets and contamination kits
async function earnForOrder(orderId) {
  const s = await settings();
  if (!s.enabled) return 0;
  const o = (await db.select('orders', 'select=id,company_id,number,total,discount&id=eq.' + orderId))[0];
  if (!o) return 0;
  if ((await db.select('loyalty_ledger', 'select=id&order_id=eq.' + orderId + '&points=gt.0&limit=1')).length) return 0; // already paid
  const lines = await db.select('order_lines', 'select=code,qty,price&order_id=eq.' + orderId);
  const cat = await cached('catalog/live.json', 60 * 60 * 1000).catch(() => null);
  const type = {}; (Array.isArray(cat) ? cat : []).forEach((r) => { type[r[0]] = r[3]; });
  const rate = Number(s.points_per_usd) || 1;
  let pts = 0;
  lines.forEach((l) => { const v = Number(l.price || 0) * Number(l.qty || 0); pts += v * rate * (type[l.code] === 'Tool' || type[l.code] === 'Kit' ? 2 : 1); });
  const gross = lines.reduce((a, l) => a + Number(l.price || 0) * Number(l.qty || 0), 0);
  if (gross > 0 && Number(o.discount) > 0) pts = pts * (gross - Number(o.discount)) / gross; // no points on the voucher part
  pts = Math.floor(pts);
  if (pts <= 0) return 0;
  const exp = s.expiry_months ? new Date(Date.now() + s.expiry_months * 30.4 * 24 * 3600 * 1000).toISOString() : null;
  await db.insert('loyalty_ledger', [{ company_id: o.company_id, order_id: o.id, points: pts, reason: 'Order ' + o.number, expires_at: exp }]);
  return pts;
}

async function redeem(companyId, itemId, who) {
  const s = await settings();
  if (!s.enabled) return { error: 'Max Rewards opens soon.' };
  const it = CATALOG.find((x) => x.id === itemId);
  if (!it) return { error: 'That reward is not available.' };
  const sum = await summary(companyId);
  if (sum.balance < it.p) return { error: 'Not enough points yet.' };
  let code = null;
  if (it.value) {
    code = 'MXR-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await db.insert('vouchers', [{ code, description: 'Max Rewards: ' + it.n, kind: 'fixed', value: it.value, company_id: companyId, min_subtotal: it.min || null,
      starts_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(), max_uses: 1, max_uses_per_company: 1, active: true, created_by: 'rewards' }]);
  }
  await db.insert('loyalty_ledger', [{ company_id: companyId, points: -it.p, reason: 'Redeemed: ' + it.n + (code ? ' (' + code + ')' : '') }]);
  const co = (await db.select('companies', 'select=name,unleashed_code&id=eq.' + companyId))[0] || {};
  await notifyTeam('Max Rewards: ' + (co.name || 'customer') + ' redeemed ' + it.n, 'Max Rewards redemption',
    [['Company', co.name], ['Customer code', co.unleashed_code], ['By', who], ['Reward', it.n], ['Points', it.p.toLocaleString('en-US')], ['Voucher', code || 'none, the team delivers this reward']], []).catch(() => {});
  return { ok: true, code, balance: sum.balance - it.p };
}

module.exports = { LEVELS, CATALOG, settings, summary, earnForOrder, redeem };
