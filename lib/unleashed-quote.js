// Creates a Draft Sales Quote in Unleashed for a quote request.
// B2B store quotes: off until PORTAL_QUOTES_LIVE=1. Website quotes (/quote): off until SITE_QUOTES_UNLEASHED=1. The customer is the signed-in approved
// account's Unleashed customer, or UNLEASHED_WEB_CUSTOMER (a generic "web quotes" customer) for visitors.
// Prices come from the account's sell price tier, else the default sell price. Never fails the request.
const crypto = require('crypto');
const { ul, configured } = require('./unleashed');
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
    const code = (acc && acc.customerCode) || process.env.UNLEASHED_WEB_CUSTOMER;
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
      lines.push({ LineNumber: lines.length + 1, Product: { ProductCode: l.pn, Guid: p.g }, QuoteQuantity: l.qty, UnitPrice: money(price), LineTotal: money(price * l.qty), LineTax: 0 });
    });
    if (!lines.length) return { skipped: true, reason: 'no catalog lines' };
    const now = new Date(), exp = new Date(Date.now() + 30 * 864e5);
    const sub = money(lines.reduce((a, l) => a + l.LineTotal, 0));
    const guid = crypto.randomUUID();
    const body = {
      Guid: guid, QuoteStatus: 'Draft', Customer: { CustomerCode: code }, QuoteDate: now.toISOString(), QuoteExpiryDate: exp.toISOString(),
      Currency: { CurrencyCode: 'USD' }, ExchangeRate: 1, SalesQuoteLines: lines, SubTotal: sub, TaxTotal: 0, Total: sub,
      Comments: [(site ? 'Website quote ' : 'Store quote ') + q.number, q.customer.company, q.customer.name, q.customer.email, q.customer.phone, q.notes].filter(Boolean).join(' · ').slice(0, 500)
    };
    const r = await ul('SalesQuotes/' + guid, '', { method: 'POST', body, timeoutMs: 30000 });
    return { ok: true, guid, number: r && (r.QuoteNumber || r.SalesQuoteNumber) };
  } catch (e) {
    console.error('sales quote failed', e.message);
    return { ok: false, error: e.message };
  }
}
module.exports = { createSalesQuote };
