// Copies completed (invoiced) sales orders from Unleashed into Supabase for the admin dashboard.
// First run: a backfill of the last 24 months, a few pages per run (Unleashed is slow), with progress in sales_sync.
// After that: only orders changed since the last run (modifiedSince, with a 3 day overlap), so edits and late completions are caught.
// Kept: order number, customer code and name, dates, subtotal in the base currency, salesperson, delivery country/region,
// and per line the product code, quantity and line total. Nothing else from the order is stored.
const db = require('./db');
const { ul, configured } = require('./unleashed');

const SIZE = 200;
const HISTORY_FROM = '2015-01-01'; // full history; the first backfill runs from here
let running = false;

const day = (v) => { const m = String(v || '').match(/\/Date\((-?\d+)/); const t = m ? +m[1] : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : null; };
const num = (v) => (Number.isFinite(+v) ? +v : 0);
function since() { return HISTORY_FROM; }

async function save(items) {
  const orders = [], lines = [];
  for (const o of items || []) {
    if (!o || !o.Guid || !o.Customer) continue;
    orders.push({
      guid: o.Guid, number: o.OrderNumber || null, customer_code: o.Customer.CustomerCode || null, customer_name: o.Customer.CustomerName || null,
      order_date: day(o.OrderDate), completed_date: day(o.CompletedDate), subtotal: num(o.BCSubTotal != null ? o.BCSubTotal : o.SubTotal),
      currency: (o.Currency && o.Currency.CurrencyCode) || null, salesperson: (o.SalesPerson && (o.SalesPerson.FullName || o.SalesPerson.Email)) || null,
      country: o.DeliveryCountry || null, region: o.DeliveryRegion || null, status: o.OrderStatus || null, is_return: false, synced_at: new Date().toISOString(),
    });
    for (const l of o.SalesOrderLines || []) {
      const code = l && l.Product && l.Product.ProductCode; if (!code) continue;
      const q = num(l.OrderQuantity), uc = num(l.AverageLandedPriceAtTimeOfSale);
      // cost at the moment of the sale (Unleashed average landed cost x quantity). Admin only: never leaves the closed tables.
      lines.push({ order_guid: o.Guid, code, qty: q, total: num(l.BCLineTotal != null ? l.BCLineTotal : l.LineTotal), cost: uc > 0 ? Math.round(uc * q * 100) / 100 : null });
    }
  }
  for (let i = 0; i < orders.length; i += 100) {
    const part = orders.slice(i, i + 100);
    await db.insert('sales_orders', part, { onConflict: 'guid' });
    await db.remove('sales_lines', 'order_guid=in.(' + part.map((x) => x.guid).join(',') + ')');
  }
  for (let i = 0; i < lines.length; i += 500) await db.insert('sales_lines', lines.slice(i, i + 500));
  return orders.length;
}

// the Unleashed customer list (directory for the admin: tier, type, contact, address, salesperson)
async function syncCustomers() {
  const day0 = (v) => day(v);
  let n = 0;
  for (let page = 1; page <= 30; page++) {
    const d = await ul('Customers/' + page, 'pageSize=500', { timeoutMs: 60000 });
    const rows = (d.Items || []).filter((c) => c && c.CustomerCode).map((c) => {
      const a = (c.Addresses || []).find((x) => /physical|street/i.test(x.AddressType || '')) || (c.Addresses || [])[0] || {};
      return { code: c.CustomerCode, guid: /^[0-9a-f-]{36}$/i.test(c.Guid || '') ? c.Guid : null, name: c.CustomerName || c.CustomerCode, tier: c.SellPriceTier || null, type: c.CustomerType || null,
        email: String(c.Email || '').trim().toLowerCase() || null, contact_name: [c.ContactFirstName, c.ContactLastName].filter(Boolean).join(' ') || null, phone: c.PhoneNumber || c.MobileNumber || null,
        city: a.City || null, state: a.Region || null, country: a.Country || null, salesperson: (c.SalesPerson && (c.SalesPerson.FullName || c.SalesPerson.Email)) || null,
        payment_terms: c.PaymentTerm || null, stop_credit: !!c.StopCredit, obsolete: !!c.Obsolete, created_on: day0(c.CreatedOn), synced_at: new Date().toISOString() };
    });
    for (let i = 0; i < rows.length; i += 500) await db.insert('ul_customers', rows.slice(i, i + 500), { onConflict: 'code' });
    n += rows.length;
    if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
  }
  await db.update('sales_sync', 'id=eq.1', { customers_at: new Date().toISOString() });
  return n;
}

// product cost (average landed cost, else last cost) for the margin floor on campaigns. Admin only: kept in a closed
// table (product_costs, service role only), never in the catalog files, the portal or the repository. Refreshed once a day, in chunks.
async function syncCosts(st, t0, budgetMs) {
  let page = st.cost_page || 1, pages = st.cost_pages || 1, n = 0;
  while (Date.now() - t0 < budgetMs - 30000) {
    const d = await ul('Products/' + page, 'pageSize=500&includeObsolete=false', { timeoutMs: 90000 });
    pages = (d.Pagination && d.Pagination.NumberOfPages) || 1;
    const rows = (d.Items || []).filter((p) => p && p.ProductCode).map((p) => ({ code: p.ProductCode, avg_cost: num(p.AverageLandPrice) || null, last_cost: num(p.LastCost) || null, synced_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) await db.insert('product_costs', rows.slice(i, i + 500), { onConflict: 'code' });
    n += rows.length;
    if (page >= pages) { await db.update('sales_sync', 'id=eq.1', { cost_page: 1, cost_pages: pages, costs_at: new Date().toISOString() }); return { n, done: true }; }
    page++;
    await db.update('sales_sync', 'id=eq.1', { cost_page: page, cost_pages: pages });
  }
  return { n, done: false, page, pages };
}

// returns: Unleashed credit notes, stored as negative orders so sales, profit and commission net them out.
// Defensive on field names: a credit note that does not parse is skipped and logged, never breaks the order sync.
async function syncReturns(fromIso, t0, budgetMs) {
  let page = 1, pages = 1, n = 0;
  do {
    const d = await ul('CreditNotes/' + page, 'pageSize=200&modifiedSince=' + fromIso.slice(0, 19), { timeoutMs: 60000 });
    pages = (d && d.Pagination && d.Pagination.NumberOfPages) || 1;
    const orders = [], lines = [];
    for (const c of (d && d.Items) || []) {
      if (!c || !c.Guid || !c.Customer) continue;
      const when = day(c.CreditDate || c.CreatedOn);
      const ls = c.CreditLines || c.SalesCreditLines || [];
      let total = 0;
      for (const l of ls) {
        const code = l && l.Product && l.Product.ProductCode; if (!code) continue;
        const q = num(l.CreditQuantity != null ? l.CreditQuantity : l.Quantity), t = num(l.BCLineTotal != null ? l.BCLineTotal : (l.LineTotal != null ? l.LineTotal : l.CreditTotal));
        const uc = num(l.AverageLandedPriceAtTimeOfSale);
        total += t;
        lines.push({ order_guid: c.Guid, code, qty: -Math.abs(q), total: -Math.abs(t), cost: uc > 0 ? -Math.round(uc * Math.abs(q) * 100) / 100 : null });
      }
      if (!when) continue;
      const sub = num(c.BCSubTotal != null ? c.BCSubTotal : c.SubTotal) || total;
      orders.push({ guid: c.Guid, number: c.CreditNoteNumber || null, customer_code: c.Customer.CustomerCode || null, customer_name: c.Customer.CustomerName || null,
        order_date: when, completed_date: when, subtotal: -Math.abs(sub), currency: (c.Currency && c.Currency.CurrencyCode) || null,
        salesperson: (c.SalesPerson && (c.SalesPerson.FullName || c.SalesPerson.Email)) || null, country: null, region: null, status: 'Credit', is_return: true, synced_at: new Date().toISOString() });
    }
    for (let i = 0; i < orders.length; i += 100) {
      const part = orders.slice(i, i + 100);
      await db.insert('sales_orders', part, { onConflict: 'guid' });
      await db.remove('sales_lines', 'order_guid=in.(' + part.map((x) => x.guid).join(',') + ')');
    }
    for (let i = 0; i < lines.length; i += 500) await db.insert('sales_lines', lines.slice(i, i + 500));
    n += orders.length; page++;
  } while (page <= pages && Date.now() - t0 < budgetMs - 20000);
  return n;
}

async function run(budgetMs) {
  if (!configured() || !db.configured()) return { error: 'not configured' };
  if (running) return { error: 'already running' };
  running = true;
  const t0 = Date.now();
  try {
    let st = (await db.select('sales_sync', 'select=*&id=eq.1'))[0];
    if (st && st.lock_at && t0 - Date.parse(st.lock_at) < budgetMs + 30000) return { ok: true, skipped: 'another run is active' };
    if (st) await db.update('sales_sync', 'id=eq.1', { lock_at: new Date().toISOString() });
    if (!st) { st = { id: 1, page: 1, pages: null, since: since(), done: false, orders: 0 }; await db.insert('sales_sync', [st], { onConflict: 'id' }); }
    let saved = 0;
    if (!st.done) {
      while (Date.now() - t0 < budgetMs) {
        const data = await ul(`SalesOrders/${st.page}`, `pageSize=${SIZE}&orderStatus=Completed&startDate=${st.since}`, { timeoutMs: 90000 });
        st.pages = (data && data.Pagination && data.Pagination.NumberOfPages) || 1;
        saved += await save(data && data.Items);
        if (st.page >= st.pages) { st.done = true; st.last_full = new Date().toISOString(); break; }
        st.page++;
        await db.update('sales_sync', 'id=eq.1', { page: st.page, pages: st.pages, orders: (st.orders || 0) + saved, updated_at: new Date().toISOString() });
      }
      // the incremental runs start from the moment the backfill began, so nothing completed meanwhile is missed
      const from = st.done ? new Date(Date.now() - 3 * 864e5).toISOString() : null;
      await db.update('sales_sync', 'id=eq.1', { page: st.page, pages: st.pages, done: st.done, last_full: st.last_full || null, orders: (st.orders || 0) + saved, updated_at: from || new Date().toISOString() });
    } else {
      const from = new Date(Date.parse(st.updated_at || 0) - 36 * 3600e3).toISOString().slice(0, 19); // modifiedSince catches edits; the overlap only covers clock drift
      const started = new Date().toISOString();
      let page = 1, pages = 1;
      do {
        const data = await ul(`SalesOrders/${page}`, `pageSize=${SIZE}&orderStatus=Completed&modifiedSince=${from}`, { timeoutMs: 90000 });
        pages = (data && data.Pagination && data.Pagination.NumberOfPages) || 1;
        saved += await save(data && data.Items);
        page++;
      } while (page <= pages && Date.now() - t0 < budgetMs);
      if (page > pages) await db.update('sales_sync', 'id=eq.1', { updated_at: started, orders: (st.orders || 0) + saved });
    }
    let returns = null;
    if (st.done && Date.now() - t0 < budgetMs - 30000) returns = await syncReturns(new Date(Date.now() - (st.returns_at ? 3 : 4000) * 864e5).toISOString(), t0, budgetMs).then(async (r) => { await db.update('sales_sync', 'id=eq.1', { returns_at: new Date().toISOString() }); return r; }).catch((e) => { console.error('returns', e.message); return null; });
    let costs = null;
    if (Date.now() - t0 < budgetMs - 60000 && (!st.costs_at || Date.now() - Date.parse(st.costs_at) > 20 * 3600e3)) costs = await syncCosts(st, t0, budgetMs).catch((e) => { console.error('costs', e.message); return null; });
    let customers = null;
    if (Date.now() - t0 < budgetMs - 60000 && (!st.customers_at || Date.now() - Date.parse(st.customers_at) > 12 * 3600e3)) customers = await syncCustomers().catch((e) => { console.error('customer directory', e.message); return null; });
    return { ok: true, saved, returns, customers, costs, page: st.page, pages: st.pages, done: st.done, ms: Date.now() - t0 };
  } finally { running = false; await db.update('sales_sync', 'id=eq.1', { lock_at: null }).catch(() => {}); }
}

module.exports = { run, syncCustomers, syncCosts };
