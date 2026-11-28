// Admin handlers of Analytics > DTA courses: the Hotmart sales of Diesel Tech Academy, kept apart from the parts revenue.
const db = require('./db');
const HM = require('./hotmart');
const ISO10 = /^\d{4}-\d{2}-\d{2}$/;
// Spanish membership area products start with 744 or 745; the rest is the English area
const langOf = (id) => (/^74[45]/.test(String(id || '')) ? 'Spanish' : 'English');

module.exports = function mount(A, H) {
  const { who, can, originOk, clean, audit } = H;
  A['dta-sales'] = async (req, res) => {
    const w = await who(req, res); if (!w) return;
    if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
    const today = new Date().toISOString().slice(0, 10);
    const to = ISO10.test(req.query.to || '') ? req.query.to : today, from = ISO10.test(req.query.from || '') ? req.query.from : new Date(Date.parse(to) - 364 * 864e5).toISOString().slice(0, 10);
    let rows;
    try { rows = await db.selectAll('hotmart_sales', 'select=*&order_date=gte.' + from + 'T00:00:00Z&order_date=lte.' + to + 'T23:59:59Z&order=order_date.desc', 20000); }
    catch (e) { return res.json({ connected: HM.configured(), ready: false, from, to, note: 'The sales table does not exist yet.' }); }
    const last = (await db.select('hotmart_sales', 'select=updated_at,origin&order=updated_at.desc&limit=1').catch(() => []))[0] || null;
    const total = (await db.select('hotmart_sales', 'select=transaction&limit=1').catch(() => [])).length;
    const paid = rows.filter((r) => HM.PAID.includes(r.status)), back = rows.filter((r) => HM.BACK.includes(r.status));
    // money is added per currency: Hotmart sells in the currency of the buyer and no rate is guessed here
    const cur = {}; paid.forEach((r) => { const c = r.currency || '?'; cur[c] = cur[c] || { currency: c, revenue: 0, sales: 0 }; cur[c].revenue += Number(r.price) || 0; cur[c].sales++; });
    const main = Object.values(cur).sort((a, z) => z.sales - a.sales)[0] || { currency: 'USD', revenue: 0, sales: 0 };
    const by = (list, key, name) => { const m = {}; list.forEach((r) => { const k = key(r); const x = m[k] || (m[k] = { key: k, name: name ? name(r) : k, sales: 0, revenue: {}, refunds: 0 }); x.sales++; x.revenue[r.currency || '?'] = (x.revenue[r.currency || '?'] || 0) + (Number(r.price) || 0); }); return m; };
    const prod = by(paid, (r) => String(r.product_id || r.product_name), (r) => r.product_name || String(r.product_id));
    back.forEach((r) => { const k = String(r.product_id || r.product_name); if (prod[k]) prod[k].refunds++; else prod[k] = { key: k, name: r.product_name || k, sales: 0, revenue: {}, refunds: 1 }; });
    Object.values(prod).forEach((p) => { p.lang = langOf(p.key); });
    const month = by(paid, (r) => String(r.order_date || '').slice(0, 7)), lang = by(paid, (r) => langOf(r.product_id)), src = by(paid, (r) => r.source || '(no source)'), country = by(paid.filter((r) => r.buyer_country), (r) => r.buyer_country);
    // students against the parts customers: same e-mail on a customer or on a portal user
    const emails = [...new Set(rows.map((r) => r.buyer_email).filter(Boolean))], cust = {};
    if (emails.length) {
      (await db.selectAll('ul_customers', 'select=code,name,email,obsolete').catch(() => [])).forEach((u) => { const e = String(u.email || '').toLowerCase(); if (e && !u.obsolete) cust[e] = { code: u.code, name: u.name }; });
      (await db.selectAll('users', 'select=email,company_id').catch(() => [])).forEach((u) => { const e = String(u.email || '').toLowerCase(); if (e && !cust[e]) cust[e] = { code: null, name: 'Portal user', portal: true }; });
    }
    const stu = {}; rows.forEach((r) => { if (!r.buyer_email) return; const x = stu[r.buyer_email] || (stu[r.buyer_email] = { email: r.buyer_email, name: r.buyer_name || '', country: r.buyer_country || '', courses: 0, refunds: 0, first: r.order_date, last: r.order_date, customer: cust[r.buyer_email] || null });
      if (HM.PAID.includes(r.status)) x.courses++; if (HM.BACK.includes(r.status)) x.refunds++; if (r.order_date < x.first) x.first = r.order_date; if (r.order_date > x.last) x.last = r.order_date; if (!x.name && r.buyer_name) x.name = r.buyer_name; });
    const students = Object.values(stu).filter((x) => x.courses > 0);
    // second-course voucher: a sale with a coupon needs an earlier paid sale of the same e-mail in the 30 days before it
    const all = total ? await db.selectAll('hotmart_sales', 'select=buyer_email,order_date,status&order=order_date', 50000).catch(() => []) : [];
    const hist = {}; all.forEach((r) => { if (r.buyer_email && HM.PAID.includes(r.status)) (hist[r.buyer_email] = hist[r.buyer_email] || []).push(Date.parse(r.order_date)); });
    const sale = (r) => ({ tx: r.transaction, at: r.order_date, product: r.product_name, lang: langOf(r.product_id), price: r.price, currency: r.currency, status: r.status, name: r.buyer_name, email: r.buyer_email, country: r.buyer_country, source: r.source, coupon: r.coupon, pay: r.payment_type, customer: cust[r.buyer_email] || null });
    const coupons = paid.filter((r) => r.coupon).map((r) => { const t = Date.parse(r.order_date), ok = (hist[r.buyer_email] || []).some((x) => x < t && t - x <= 30 * 864e5); return Object.assign(sale(r), { earlier: ok }); });
    return res.json({ connected: HM.configured(), ready: true, from, to, last, empty: !total,
      totals: { sales: paid.length, refunds: back.length, students: students.length, currencies: Object.values(cur).sort((a, z) => z.sales - a.sales), main, ticket: main.sales ? main.revenue / main.sales : 0, refundRate: paid.length + back.length ? back.length / (paid.length + back.length) : 0,
        customers: students.filter((x) => x.customer).length, repeat: students.filter((x) => x.courses > 1).length },
      products: Object.values(prod).sort((a, z) => z.sales - a.sales), months: Object.values(month).sort((a, z) => (a.key < z.key ? -1 : 1)), langs: Object.values(lang), sources: Object.values(src).sort((a, z) => z.sales - a.sales).slice(0, 12), countries: Object.values(country).sort((a, z) => z.sales - a.sales).slice(0, 12),
      students: students.sort((a, z) => (z.customer ? 1 : 0) - (a.customer ? 1 : 0) || z.courses - a.courses || (z.last > a.last ? 1 : -1)).slice(0, 300), recent: rows.slice(0, 60).map(sale), coupons });
  };
  // reads the history from Hotmart again (first import, or to catch what a webhook missed). Superadmin and manager only.
  A['dta-sync'] = async (req, res) => {
    if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
    const w = await who(req, res); if (!w) return;
    if (!can(w, 'admin')) return res.status(403).json({ error: 'role' });
    try { const out = await HM.sync({ budgetMs: 40000 }); await audit(w.email, 'dta.sync', 'dta', '', null, { rows: out.rows || 0, partial: !!out.partial, error: out.error || null }); return res.json(Object.assign({ ok: !out.error }, out)); }
    catch (e) { console.error('dta sync', e.message); return res.status(502).json({ error: 'Could not read the sales from Hotmart. Check the credentials in Vercel.' }); }
  };
};
module.exports.langOf = langOf;
