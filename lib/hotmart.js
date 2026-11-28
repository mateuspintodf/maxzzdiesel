// Hotmart: the course sales of Diesel Tech Academy. Reads the sales history through the Hotmart API and maps
// both the API rows and the webhook events to one row per transaction in the table hotmart_sales.
// Credentials live only in Vercel: HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET, HOTMART_BASIC (the "Basic" token Hotmart shows).
const db = require('./db');
const configured = () => !!(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC);
const s = (v, n) => (v == null ? null : String(v).trim().slice(0, n || 200) || null);
const iso = (ms) => { const n = Number(ms); if (n > 0) return new Date(n).toISOString(); const d = Date.parse(ms); return d ? new Date(d).toISOString() : null; };
// what counts as money in, and what counts as money given back
const PAID = ['APPROVED', 'COMPLETE'], BACK = ['REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED', 'PROTESTED'];
const STATUSES = ['APPROVED', 'COMPLETE', 'REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED', 'PROTESTED', 'CANCELLED'];
// webhook event name -> the status the sale ends in
const EVENT = { PURCHASE_APPROVED: 'APPROVED', PURCHASE_COMPLETE: 'COMPLETE', PURCHASE_REFUNDED: 'REFUNDED', PURCHASE_CHARGEBACK: 'CHARGEBACK', PURCHASE_PROTEST: 'PROTESTED', PURCHASE_CANCELED: 'CANCELLED' };

let TOK = null;
async function token() {
  if (TOK && TOK.until > Date.now() + 60000) return TOK.v;
  const u = 'https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=' + encodeURIComponent(process.env.HOTMART_CLIENT_ID) + '&client_secret=' + encodeURIComponent(process.env.HOTMART_CLIENT_SECRET);
  const basic = String(process.env.HOTMART_BASIC).replace(/^Basic\s+/i, '');
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + basic } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('hotmart auth ' + r.status);
  TOK = { v: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return TOK.v;
}
// one row of the sales history API
function fromApi(it) {
  const p = it.purchase || {}, b = it.buyer || {}, pr = it.product || {}, tr = p.tracking || {}, pay = p.payment || {}, of = p.offer || {};
  if (!p.transaction) return null;
  return { transaction: s(p.transaction, 60), status: s(p.status, 40) || 'APPROVED', product_id: Number(pr.id) || null, product_name: s(pr.name, 200), offer_code: s(of.code, 60), price: p.price && p.price.value != null ? Number(p.price.value) : null, currency: s(p.price && p.price.currency_code, 8),
    payment_type: s(pay.type, 40), installments: Number(pay.installments_number) || null, buyer_email: s(b.email, 200) && s(b.email, 200).toLowerCase(), buyer_name: s(b.name, 160), source: s(tr.source, 120), source_sck: s(tr.source_sck, 120),
    commission_as: s(p.commission_as, 20), is_subscription: !!p.is_subscription, order_date: iso(p.order_date), approved_date: iso(p.approved_date), origin: 'api', updated_at: new Date().toISOString() };
}
// one webhook event (version 2 payload). Returns null for events that are not about a sale.
function fromWebhook(b) {
  const st = EVENT[String(b.event || '')]; const d = b.data || {}, p = d.purchase || {}, by = d.buyer || {}, pr = d.product || {}, of = p.offer || {}, or = p.origin || {}, pay = p.payment || {};
  if (!st || !p.transaction) return null;
  const row = { transaction: s(p.transaction, 60), status: st, product_id: Number(pr.id) || null, product_name: s(pr.name, 200), offer_code: s(of.code, 60), coupon: s(of.coupon_code, 60), price: p.price && p.price.value != null ? Number(p.price.value) : null, currency: s(p.price && p.price.currency_value, 8),
    payment_type: s(pay.type, 40), installments: Number(pay.installments_number) || null, buyer_email: s(by.email, 200) && s(by.email, 200).toLowerCase(), buyer_name: s(by.name, 160), buyer_country: s(p.checkout_country && (p.checkout_country.iso || p.checkout_country.name), 60) || s(by.address && by.address.country_iso, 60),
    source: s(or.src, 120), source_sck: s(or.sck, 120), is_subscription: !!(d.subscription && d.subscription.subscriber), order_date: iso(p.order_date), approved_date: iso(p.approved_date), origin: 'webhook', updated_at: new Date().toISOString() };
  if (BACK.includes(st)) row.refunded_at = iso(b.creation_date) || new Date().toISOString();
  // a refund event may arrive with less than the sale had: never overwrite a known value with nothing
  Object.keys(row).forEach((k) => { if (row[k] == null) delete row[k]; });
  return row;
}
const save = (rows) => (rows.length ? db.insert('hotmart_sales', rows, { onConflict: 'transaction' }) : Promise.resolve([]));

// Copies the history into the table. Hotmart only returns approved and complete sales unless each status is asked for,
// so every status is read in turn. Stops when the time budget is over and says where it stopped.
async function sync({ sinceMs, budgetMs } = {}) {
  if (!configured()) return { error: 'Hotmart is not connected yet.' };
  const t0 = Date.now(), tk = await token(), start = sinceMs || Date.UTC(2022, 0, 1), end = Date.now(); let rows = 0, pages = 0; const seen = {};
  for (const st of STATUSES) {
    let page = '';
    for (let i = 0; i < 200; i++) {
      if (Date.now() - t0 > (budgetMs || 40000)) return { ok: true, partial: true, rows, pages, stoppedAt: st };
      const u = 'https://developers.hotmart.com/payments/api/v1/sales/history?max_results=100&start_date=' + start + '&end_date=' + end + '&transaction_status=' + st + (page ? '&page_token=' + encodeURIComponent(page) : '');
      const r = await fetch(u, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk } });
      if (r.status === 429) { await new Promise((z) => setTimeout(z, 1500)); continue; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: 'Hotmart answered ' + r.status + ' reading ' + st + '.', rows, pages };
      const batch = (j.items || []).map(fromApi).filter(Boolean);
      // the same sale can be listed for the producer and the co-producer: keep one row
      const uniq = batch.filter((x) => (seen[x.transaction + x.status] ? false : (seen[x.transaction + x.status] = 1)));
      await save(uniq); rows += uniq.length; pages++;
      page = j.page_info && j.page_info.next_page_token; if (!page) break;
    }
  }
  return { ok: true, rows, pages };
}
module.exports = { configured, sync, fromWebhook, fromApi, save, PAID, BACK };
