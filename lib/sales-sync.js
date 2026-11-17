// Copies completed (invoiced) sales orders from Unleashed into Supabase for the admin dashboard.
// First run: a backfill of the last 24 months, a few pages per run (Unleashed is slow), with progress in sales_sync.
// After that: only orders changed since the last run (modifiedSince, with a 3 day overlap), so edits and late completions are caught.
// Kept: order number, customer code and name, dates, subtotal in the base currency, salesperson, delivery country/region,
// and per line the product code, quantity and line total. Nothing else from the order is stored.
const db = require('./db');
const { ul, configured } = require('./unleashed');

const SIZE = 200;
const MONTHS = 24;
let running = false;

const day = (v) => { const m = String(v || '').match(/\/Date\((-?\d+)/); const t = m ? +m[1] : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : null; };
const num = (v) => (Number.isFinite(+v) ? +v : 0);
function since() { const d = new Date(); d.setMonth(d.getMonth() - MONTHS); return d.toISOString().slice(0, 10); }

async function save(items) {
  const orders = [], lines = [];
  for (const o of items || []) {
    if (!o || !o.Guid || !o.Customer) continue;
    orders.push({
      guid: o.Guid, number: o.OrderNumber || null, customer_code: o.Customer.CustomerCode || null, customer_name: o.Customer.CustomerName || null,
      order_date: day(o.OrderDate), completed_date: day(o.CompletedDate), subtotal: num(o.BCSubTotal != null ? o.BCSubTotal : o.SubTotal),
      currency: (o.Currency && o.Currency.CurrencyCode) || null, salesperson: (o.SalesPerson && (o.SalesPerson.FullName || o.SalesPerson.Email)) || null,
      country: o.DeliveryCountry || null, region: o.DeliveryRegion || null, synced_at: new Date().toISOString(),
    });
    for (const l of o.SalesOrderLines || []) {
      const code = l && l.Product && l.Product.ProductCode; if (!code) continue;
      lines.push({ order_guid: o.Guid, code, qty: num(l.OrderQuantity), total: num(l.BCLineTotal != null ? l.BCLineTotal : l.LineTotal) });
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

async function run(budgetMs) {
  if (!configured() || !db.configured()) return { error: 'not configured' };
  if (running) return { error: 'already running' };
  running = true;
  const t0 = Date.now();
  try {
    let st = (await db.select('sales_sync', 'select=*&id=eq.1'))[0];
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
      const from = new Date(Date.parse(st.updated_at || 0) - 3 * 864e5).toISOString().slice(0, 19);
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
    return { ok: true, saved, page: st.page, pages: st.pages, done: st.done, ms: Date.now() - t0 };
  } finally { running = false; }
}

module.exports = { run };
