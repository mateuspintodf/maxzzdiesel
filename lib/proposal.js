// Proposals: the sales team edits what the customer asked for (items, prices, discount, freight), sends it, the customer
// reviews it on the portal page and accepts. Cost never appears here: floors are checked in api/admin.js.
const crypto = require('crypto');
const { esc } = require('./hubspot');
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DOC = { quote: 'Quote', invoice: 'Invoice' };
const docLabel = (t) => DOC[t] || 'Quote';
const newToken = () => crypto.randomBytes(24).toString('base64url');

// lines from the admin screen: part code, name, quantity (whole), unit price (>= 0). Duplicates are merged.
function cleanLines(list) {
  const seen = new Map();
  (Array.isArray(list) ? list : []).slice(0, 300).forEach((l) => {
    const code = String((l && l.code) || '').trim().slice(0, 60), nm = String((l && l.name) || '').trim(); if (!code && !nm) return; // charge lines from the order (shipping, tax, card fee) have a name and no part code
    const qty = Math.min(99999, Math.max(0, Math.floor(Number(l.qty) || 0))), price = Math.max(0, money(l.price));
    if (!qty) return;
    const k = code + '|' + (code ? '' : nm) + '|' + price;
    if (seen.has(k)) seen.get(k).qty += qty; else seen.set(k, Object.assign({ code, name: String(l.name || '').slice(0, 140), qty, price }, l.added ? { added: 1 } : {}));
  });
  return [...seen.values()];
}

function calc(lines, pct, freight) {
  const subtotal = money(lines.reduce((a, l) => a + l.qty * l.price, 0));
  const p = Math.min(100, Math.max(0, Number(pct) || 0)), discount = money(subtotal * p / 100), f = Math.max(0, money(freight));
  return { subtotal, discount, freight: f, total: money(subtotal - discount + f) };
}

// what the customer may see: no ids of the deal, no team notes
function view(row) {
  const lines = (row.lines || []).map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: l.price, amount: money(l.qty * l.price) }));
  const t = calc(row.lines || [], row.discount_pct, row.freight);
  const expired = row.status === 'sent' && row.valid_until && Date.parse(row.valid_until) < Date.now();
  return { number: row.number, doc: row.doc_type, label: docLabel(row.doc_type), status: expired ? 'expired' : row.status, validUntil: row.valid_until, sentAt: row.sent_at, acceptedAt: row.accepted_at,
    lines, subtotal: t.subtotal, discountPct: Number(row.discount_pct) || 0, discount: t.discount, freight: t.freight, total: t.total, notes: row.notes || '',
    customer: row.customer_name || '', contact: row.contact_name || '', ship: row.ship || null, accepted: row.accepted ? { ship: row.accepted.ship || null } : null };
}

// the same document inside the e-mail
function emailTable(v) {
  const fm = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<p>${esc(v.label)} <b>${esc(v.number)}</b>${v.validUntil ? ' · valid until ' + esc(new Date(v.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : ''}</p>
<table width="100%" cellpadding="6" style="border-collapse:collapse;font-size:14px">${v.lines.map((l) => `<tr style="border-bottom:1px solid #eef0f2"><td>${esc(l.code)}<br><span style="color:#8a9097">${esc(l.name)}</span></td><td align="right" style="white-space:nowrap">${l.qty} x ${fm(l.price)}</td><td align="right" style="white-space:nowrap"><b>${fm(l.amount)}</b></td></tr>`).join('')}
${v.discount ? `<tr><td colspan="2" align="right">Discount (${v.discountPct}%)</td><td align="right">-${fm(v.discount)}</td></tr>` : ''}
${v.freight ? `<tr><td colspan="2" align="right">Freight</td><td align="right">${fm(v.freight)}</td></tr>` : ''}
<tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>${fm(v.total)}</b></td></tr></table>${v.notes ? `<p style="margin-top:14px">${esc(v.notes)}</p>` : ''}`;
}

// Accepted proposal -> the Unleashed order moves from Parked to Placed with the final lines. Off unless PROPOSAL_TO_UNLEASHED=1:
// it is the one write that reaches stock and logistics, so it is switched on by the owner after a test on the ZZTEST customer.
async function placeInUnleashed(row, ship) {
  if (process.env.PROPOSAL_TO_UNLEASHED !== '1') return { skipped: true, reason: 'switch off' };
  const { ul, configured } = require('./unleashed'); if (!configured()) return { skipped: true, reason: 'unleashed not configured' };
  if (row.lines.some((l) => !l.code)) return { skipped: true, reason: 'has charge lines (shipping, tax or fee): place it by hand' };
  const o = ((await ul('SalesOrders', 'orderNumber=' + encodeURIComponent(row.ref), { timeoutMs: 15000 })).Items || [])[0];
  if (!o) return { skipped: true, reason: 'order not found' };
  if (o.OrderStatus !== 'Parked') return { skipped: true, reason: 'order is ' + o.OrderStatus };
  const t = calc(row.lines, row.discount_pct, row.freight), k = 1 - (Number(row.discount_pct) || 0) / 100, sh = ship || {};
  const lines = row.lines.map((l, i) => { const u = money(l.price * k); return { LineNumber: i + 1, Product: { ProductCode: l.code }, OrderQuantity: l.qty, UnitPrice: u, LineTotal: money(u * l.qty), LineTax: 0 }; });
  const sub = money(lines.reduce((a, l) => a + l.LineTotal, 0));
  const body = { Guid: o.Guid, OrderNumber: o.OrderNumber, OrderStatus: 'Placed', Customer: o.Customer, CustomerRef: o.CustomerRef, SalesOrderLines: lines, SubTotal: sub, TaxTotal: 0, Total: sub,
    DeliveryStreetAddress: sh.street || o.DeliveryStreetAddress, DeliveryCity: sh.city || o.DeliveryCity, DeliveryRegion: sh.state || o.DeliveryRegion, DeliveryPostCode: sh.zip || o.DeliveryPostCode, DeliveryCountry: sh.country || o.DeliveryCountry,
    DeliveryMethod: sh.method || o.DeliveryMethod, Comments: String(o.Comments || '').slice(0, 700) + ' · PROPOSAL ACCEPTED ONLINE' + (t.freight ? ' · freight ' + t.freight.toFixed(2) : '') };
  await ul('SalesOrders/' + o.Guid, '', { method: 'POST', body, timeoutMs: 30000 });
  return { placed: true };
}

module.exports = { placeInUnleashed, money, docLabel, newToken, cleanLines, calc, view, emailTable };
