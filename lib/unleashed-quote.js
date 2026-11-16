// Creates a Parked Sales Order in Unleashed for a quote request (the Unleashed API cannot create sales quotes).
// The team reviews it, sets freight and releases or deletes it. Website visitors whose e-mail matches an Unleashed customer get it on that customer.
// B2B store quotes: off until PORTAL_QUOTES_LIVE=1. Website quotes (/quote): off until SITE_QUOTES_UNLEASHED=1. The customer is the signed-in approved
// account's Unleashed customer, or UNLEASHED_WEB_CUSTOMER (a generic "web quotes" customer) for visitors.
// Prices come from the account's sell price tier, else the default sell price. Never fails the request.
const crypto = require('crypto');
const { ul, configured, findCustomerByEmail } = require('./unleashed');
const { readJson, cached } = require('./store');
const { authenticate } = require('./auth');

const live = (site) => (site ? process.env.SITE_QUOTES_UNLEASHED : process.env.PORTAL_QUOTES_LIVE) === '1';
const money = (n) => Math.round(n * 100) / 100;

async function accountFor(req) {
  const w = await authenticate(req);
  return w && w.account && w.account.status === 'approved' ? w.account : null;
}

async function createSalesQuote(req, q, opts) {
  const site = !!(opts && opts.site);
  if (!live(site) || !configured()) return { skipped: true };
  try {
    const acc = await accountFor(req);
    let code = acc && acc.customerCode, matched = false;
    if (!code && q.customer && q.customer.email) { try { const c = await findCustomerByEmail(q.customer.email); if (c) { code = c.code; matched = true; } } catch (e) { console.error('quote customer lookup', e.message); } }
    if (!code) code = process.env.UNLEASHED_WEB_CUSTOMER;
    if (!code) return { skipped: true, reason: 'no customer' };
    const prod = await cached('portal/products.json', 10 * 60 * 1000);
    const tiers = (prod && prod.tiers) || [];
    const idx = acc && acc.tier ? tiers.findIndex((t) => String(t).toLowerCase() === String(acc.tier).toLowerCase()) : -1;
    const lines = [];
    q.lines.forEach((l) => {
      const p = prod && prod.items && prod.items[l.pn];
      if (!p) return; // only catalog parts; free-text lines stay in HubSpot
      let price = idx >= 0 ? p.t[idx] : null;
      if (!(price > 0)) price = p.d > 0 ? p.d : 0;
      lines.push({ LineNumber: lines.length + 1, Product: { ProductCode: l.pn, Guid: p.g }, OrderQuantity: l.qty, UnitPrice: money(price), LineTotal: money(price * l.qty), LineTax: 0 });
    });
    if (!lines.length) return { skipped: true, reason: 'no catalog lines' };
    const now = new Date(), sh = q.ship || {};
    const sub = money(lines.reduce((a, l) => a + l.LineTotal, 0));
    const guid = crypto.randomUUID();
    const free = q.lines.filter((l) => !(prod && prod.items && prod.items[l.pn])).map((l) => l.pn + ' x' + l.qty);
    const body = {
      Guid: guid, OrderStatus: 'Parked', OrderDate: now.toISOString(), Customer: { CustomerCode: code }, CustomerRef: String(q.number).slice(0, 50),
      Comments: ['QUOTE REQUEST ' + q.number + (site ? ' (website)' : ' (B2B store)') + ': review, add freight, then release or delete', !acc && !matched ? 'WEB CUSTOMER: create or link the real customer' : '', q.customer.company, q.customer.name, q.customer.email, q.customer.phone,
        free.length ? 'NOT IN CATALOG: ' + free.join(', ') : '', q.notes].filter(Boolean).join(' · ').slice(0, 1000),
      DeliveryName: (q.customer.company || '').slice(0, 100) || undefined, DeliveryStreetAddress: sh.street || undefined, DeliveryCity: sh.city || undefined, DeliveryRegion: sh.state || undefined,
      DeliveryPostCode: sh.zip || undefined, DeliveryCountry: sh.country || undefined,
      Currency: { CurrencyCode: 'USD' }, ExchangeRate: 1, SalesOrderLines: lines, SubTotal: sub, TaxRate: 0, TaxTotal: 0, Total: sub
    };
    const r = await ul('SalesOrders/' + guid, '', { method: 'POST', body, timeoutMs: 30000 });
    return { ok: true, guid, number: r && r.OrderNumber, matched, code };
  } catch (e) {
    console.error('parked order failed', e.message);
    return { ok: false, error: e.message };
  }
}
module.exports = { createSalesQuote };
