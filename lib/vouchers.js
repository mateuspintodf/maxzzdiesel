// Voucher rules, evaluated only on the server. A voucher discounts the order subtotal (prices already at the customer's tier); never stacks.
const db = require('./db');
const money = (n) => Math.round(n * 100) / 100;

// returns { ok:true, voucher, discount } or { ok:false, error }
async function evaluate(code, companyId, subtotal) {
  code = String(code || '').trim();
  if (!code) return { ok: false, error: 'Enter a voucher code.' };
  const v = (await db.select('vouchers', 'select=*&code=eq.' + encodeURIComponent(code) + '&limit=1'))[0];
  const bad = { ok: false, error: 'This voucher is not valid.' };
  if (!v || !v.active) return bad;
  const now = Date.now();
  if (Date.parse(v.starts_at) > now) return { ok: false, error: 'This voucher is not active yet.' };
  if (Date.parse(v.expires_at) < now) return { ok: false, error: 'This voucher has expired.' };
  if (v.company_id && v.company_id !== companyId) return bad;
  if (v.min_subtotal != null && subtotal < Number(v.min_subtotal)) return { ok: false, error: 'This voucher needs an order of at least $' + Number(v.min_subtotal).toFixed(2) + '.' };
  if (v.max_uses != null) {
    const used = await db.select('voucher_redemptions', 'select=id&voucher_id=eq.' + v.id + '&limit=' + v.max_uses);
    if (used.length >= v.max_uses) return { ok: false, error: 'This voucher has reached its limit.' };
  }
  if (v.max_uses_per_company != null) {
    const mine = await db.select('voucher_redemptions', 'select=id&voucher_id=eq.' + v.id + '&company_id=eq.' + companyId + '&limit=' + v.max_uses_per_company);
    if (mine.length >= v.max_uses_per_company) return { ok: false, error: 'You already used this voucher.' };
  }
  const raw = v.kind === 'percent' ? subtotal * Number(v.value) / 100 : Number(v.value);
  const discount = money(Math.min(raw, subtotal));
  if (!(discount > 0)) return bad;
  return { ok: true, voucher: v, discount };
}
// claims one use for the order; if a concurrent order took the last use, gives it back and fails
async function redeem(v, companyId, orderId, discount) {
  await db.insert('voucher_redemptions', [{ voucher_id: v.id, company_id: companyId, order_id: orderId, discount }], { onConflict: 'order_id', ignoreDuplicates: true });
  if (v.max_uses != null) {
    const all = await db.select('voucher_redemptions', 'select=id&voucher_id=eq.' + v.id + '&order=id&limit=' + (v.max_uses + 1));
    if (all.length > v.max_uses) { await db.remove('voucher_redemptions', 'order_id=eq.' + orderId); return false; }
  }
  return true;
}
module.exports = { evaluate, redeem, money };
