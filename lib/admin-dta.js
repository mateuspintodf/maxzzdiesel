// Admin handlers of Analytics > DTA courses: the Hotmart sales of Diesel Tech Academy, kept apart from the parts revenue.
const db = require('./db');
const HM = require('./hotmart');
const WF = require('./webflow');
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
    // form answers of the DTA site (Webflow). The newest page is read again when the last reading is older than 15 minutes.
    let wfNote = null;
    if (WF.configured()) { const lw = (await db.select('dta_leads', 'select=updated_at&order=updated_at.desc&limit=1').catch(() => []))[0];
      if (!lw || Date.now() - Date.parse(lw.updated_at) > 15 * 60e3) { try { const o = await WF.sync({ full: !lw, budgetMs: 8000 }); if (o.error) wfNote = o.error; } catch (e) { wfNote = 'Could not read the forms from Webflow.'; } } }
    const leadsAll = await db.selectAll('dta_leads', 'select=id,kind,submitted_at,name,email,phone,company,course,value,page,landing,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,data,deal_id&submitted_at=gte.' + from + 'T00:00:00Z&submitted_at=lte.' + to + 'T23:59:59Z&order=submitted_at.desc', 20000).catch(() => []);
    const leads = leadsAll.filter((l) => l.kind === 'course' && l.email), onsite = leadsAll.filter((l) => l.kind === 'onsite');
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
    if (emails.length || leadsAll.length) {
      (await db.selectAll('ul_customers', 'select=code,name,email,obsolete,type,tier,created_on').catch(() => [])).forEach((u) => { const e = String(u.email || '').trim().toLowerCase(); if (e && !u.obsolete) cust[e] = { code: u.code, name: u.name, type: u.type || '', tier: u.tier || '', since: u.created_on || null }; });
      (await db.selectAll('users', 'select=email,company_id').catch(() => [])).forEach((u) => { const e = String(u.email || '').toLowerCase(); if (e && !cust[e]) cust[e] = { code: null, name: 'Portal user', portal: true }; });
    }
    const stu = {}; rows.forEach((r) => { if (!r.buyer_email) return; const x = stu[r.buyer_email] || (stu[r.buyer_email] = { email: r.buyer_email, name: r.buyer_name || '', country: r.buyer_country || '', courses: 0, refunds: 0, first: r.order_date, last: r.order_date, customer: cust[r.buyer_email] || null });
      if (HM.PAID.includes(r.status)) { x.courses++; x.spent = x.spent || {}; x.spent[r.currency || '?'] = (x.spent[r.currency || '?'] || 0) + (Number(r.price) || 0); } if (HM.BACK.includes(r.status)) x.refunds++; if (r.order_date < x.first) x.first = r.order_date; if (r.order_date > x.last) x.last = r.order_date; if (!x.name && r.buyer_name) x.name = r.buyer_name; });
    const students = Object.values(stu).filter((x) => x.courses > 0);
    // parts orders of the students who are Max customers: how many, the last one, and whether the first came before or after the first course.
    // Only counts and dates: no parts revenue is brought into this screen.
    const codes = [...new Set(students.map((x) => x.customer && x.customer.code).filter(Boolean))], po = {};
    for (let i = 0; i < codes.length; i += 80) {
      (await db.selectAll('sales_orders', 'select=customer_code,order_date,is_return&customer_code=in.(' + codes.slice(i, i + 80).map((c) => encodeURIComponent('"' + c + '"')).join(',') + ')', 20000).catch(() => []))
        .forEach((o) => { if (o.is_return || !o.order_date) return; const x = po[o.customer_code] || (po[o.customer_code] = { n: 0, first: o.order_date, last: o.order_date, after: 0 }); x.n++; if (o.order_date < x.first) x.first = o.order_date; if (o.order_date > x.last) x.last = o.order_date; });
    }
    students.forEach((x) => { const c = x.customer; if (!c || !c.code) return; const o = po[c.code]; x.parts = o ? { orders: o.n, first: o.first, last: o.last } : { orders: 0 };
      x.path = !o ? 'no order yet' : String(o.first).slice(0, 10) < String(x.first).slice(0, 10) ? 'customer first' : 'course first'; });
    // ---- sales analytics: where the sale came from (tracking tags), how it was paid, when it happened
    const isMax = (r) => !!cust[r.buyer_email];
    const grp = (key, lkey) => { const m = {}, get = (k) => m[k] || (m[k] = { key: k, sales: 0, refunds: 0, revenue: {}, st: {}, mx: {}, ld: {} });
      rows.forEach((r) => { const ok = HM.PAID.includes(r.status), bk = HM.BACK.includes(r.status); if (!ok && !bk) return; const x = get(key(r) || '(not tagged)');
        if (bk) { x.refunds++; return; } x.sales++; x.revenue[r.currency || '?'] = (x.revenue[r.currency || '?'] || 0) + (Number(r.price) || 0); if (r.buyer_email) { x.st[r.buyer_email] = 1; if (isMax(r)) x.mx[r.buyer_email] = 1; } });
      if (lkey) leads.forEach((l) => { const x = get(lkey(l) || '(not tagged)'); x.ld[l.email] = 1; const lim = String(new Date(Date.parse(l.submitted_at) - 864e5).toISOString()); if ((paidAt[l.email] || []).some((d) => d >= lim)) x.lw = Object.assign(x.lw || {}, { [l.email]: 1 }); });
      return Object.values(m).map((x) => ({ key: x.key, sales: x.sales, refunds: x.refunds, revenue: x.revenue, students: Object.keys(x.st).length, max: Object.keys(x.mx).length, leads: lkey ? Object.keys(x.ld).length : null, won: Object.keys(x.lw || {}).length })).sort((a, z) => z.sales - a.sales || (z.leads || 0) - (a.leads || 0) || z.refunds - a.refunds).slice(0, 60); };
    // where a sale came from: the form answer of the same e-mail (it carries the visit source), else the tags Hotmart kept from the checkout link
    const byMail = {}; leads.slice().reverse().forEach((l) => { (byMail[l.email] = byMail[l.email] || []).push(l); });
    const leadOf = (r) => { const a = byMail[r.buyer_email]; if (!a) return null; const lim = String(new Date(Date.parse(r.order_date) + 864e5).toISOString()); let hit = null; a.forEach((l) => { if (String(l.submitted_at) <= lim) hit = l; }); return hit || a[0]; };
    const AL = { facebook: 'fb', 'facebook.com': 'fb', instagram: 'ig', 'instagram.com': 'ig' }, al = (v) => AL[v] || v;
    leads.forEach((l) => { if (l.utm_source) l.utm_source = al(l.utm_source); });
    const lt = (l) => ({ source: l.utm_source || '', medium: l.utm_medium || '', campaign: l.utm_campaign || '', content: l.utm_content || '', term: l.utm_term || '', tagged: !!(l.utm_source || l.utm_campaign), via: 'form' });
    const TR = {}; rows.forEach((r) => { const l = leadOf(r), f = l && lt(l); TR[r.transaction] = f && f.tagged ? f : Object.assign({ term: '', via: 'hotmart' }, HM.track(r)); TR[r.transaction].source = al(TR[r.transaction].source); });
    const tz = (d) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(d)); return { wd: p.find((x) => x.type === 'weekday').value, h: Number(p.find((x) => x.type === 'hour').value) % 24 }; };
    const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], wd = WD.map((k) => ({ key: k, sales: 0 })), hr = Array.from({ length: 24 }, (_, i) => ({ key: i, sales: 0 }));
    paid.forEach((r) => { if (!r.order_date) return; const t = tz(r.order_date), i = WD.indexOf(t.wd); if (i >= 0) wd[i].sales++; hr[t.h].sales++; });
    const tagged = paid.filter((r) => TR[r.transaction].tagged).length;
    const all = total ? await db.selectAll('hotmart_sales', 'select=buyer_email,order_date,status&order=order_date', 50000).catch(() => []) : [];
    // started and did not finish: abandoned checkouts (webhook) and purchases that were never paid. Recovered = the same e-mail paid afterwards.
    const paidAt = {}; all.forEach((r) => { if (r.buyer_email && HM.PAID.includes(r.status)) (paidAt[r.buyer_email] = paidAt[r.buyer_email] || []).push(String(r.order_date)); });
    const carts = await db.selectAll('hotmart_carts', 'select=*&event_at=gte.' + from + 'T00:00:00Z&event_at=lte.' + to + 'T23:59:59Z&order=event_at.desc', 5000).catch(() => []);
    const WHY = { WAITING_PAYMENT: 'Waiting for payment', PRINTED_BILLET: 'Boleto or pix issued, not paid', EXPIRED: 'Payment expired', NO_FUNDS: 'Card refused', OVERDUE: 'Payment overdue', BLOCKED: 'Blocked by Hotmart', STARTED: 'Started the purchase', CANCELLED: 'Cancelled before paying' };
    const lost = [].concat(carts.map((c) => ({ at: c.event_at, why: 'Left the checkout', product: c.product_name, email: c.buyer_email, name: c.buyer_name, phone: c.buyer_phone, country: c.buyer_country })),
      rows.filter((r) => WHY[r.status]).map((r) => ({ at: r.order_date, why: WHY[r.status], product: r.product_name, email: r.buyer_email, name: r.buyer_name, phone: r.buyer_phone, country: r.buyer_country, price: r.price, currency: r.currency })))
      .filter((x) => x.email).map((x) => Object.assign(x, { customer: cust[x.email] || null, recovered: (paidAt[x.email] || []).some((d) => d >= String(x.at)), student: !!(paidAt[x.email] || []).length }))
      .sort((a, z) => (String(a.at) < String(z.at) ? 1 : -1));
    // one line per person and product, the latest attempt
    const lk = {}, lostU = lost.filter((x) => { const k = x.email + '|' + (x.product || ''); if (lk[k]) { lk[k].tries++; return false; } x.tries = 1; lk[k] = x; return true; });
    const analytics = { tagged, untagged: paid.length - tagged, viaForm: paid.filter((r) => TR[r.transaction].via === 'form' && TR[r.transaction].tagged).length, source: grp((r) => TR[r.transaction].source, (l) => l.utm_source), medium: grp((r) => TR[r.transaction].medium, (l) => l.utm_medium), campaign: grp((r) => TR[r.transaction].campaign, (l) => l.utm_campaign), content: grp((r) => TR[r.transaction].content, (l) => l.utm_content), term: grp((r) => TR[r.transaction].term, (l) => l.utm_term), landing: grp((r) => { const l = leadOf(r); return l ? l.landing || l.page : ''; }, (l) => l.landing || l.page),
      payment: grp((r) => String(r.payment_type || '').replace(/_/g, ' ').toLowerCase()), installments: grp((r) => (r.installments ? (r.installments > 1 ? r.installments + ' installments' : 'Paid at once') : '')), offer: grp((r) => r.offer_code), coupon: grp((r) => r.coupon || '(no coupon)'), wd, hr };
    // the form answers as a funnel: answered the form -> opened a purchase at Hotmart -> paid
    const anyAt = {}; all.forEach((r) => { if (r.buyer_email) (anyAt[r.buyer_email] = anyAt[r.buyer_email] || []).push(String(r.order_date)); }); carts.forEach((c) => { if (c.buyer_email) (anyAt[c.buyer_email] = anyAt[c.buyer_email] || []).push(String(c.event_at)); });
    const after = (list, at) => (list || []).some((d) => d >= String(new Date(Date.parse(at) - 864e5).toISOString()));
    const seenL = {}, leadRows = leads.map((l) => ({ at: l.submitted_at, name: l.name, email: l.email, phone: l.phone, course: l.course, value: l.value, landing: l.landing || l.page, source: l.utm_source, medium: l.utm_medium, campaign: l.utm_campaign, content: l.utm_content, term: l.utm_term,
      status: after(paidAt[l.email], l.submitted_at) ? 'bought' : after(anyAt[l.email], l.submitted_at) ? 'tried' : (paidAt[l.email] || []).length ? 'student' : 'none', customer: cust[l.email] || null }))
      .filter((x) => { if (seenL[x.email]) { seenL[x.email].times++; return false; } x.times = 1; seenL[x.email] = x; return true; });
    const funnel = { leads: leadRows.length, tried: leadRows.filter((x) => x.status === 'bought' || x.status === 'tried').length, bought: leadRows.filter((x) => x.status === 'bought').length, value: leadRows.filter((x) => x.status !== 'bought').reduce((a, x) => a + (Number(x.value) || 0), 0) };
    // second-course voucher: a sale with a coupon needs an earlier paid sale of the same e-mail in the 30 days before it
    const hist = {}; all.forEach((r) => { if (r.buyer_email && HM.PAID.includes(r.status)) (hist[r.buyer_email] = hist[r.buyer_email] || []).push(Date.parse(r.order_date)); });
    const sale = (r) => ({ tx: r.transaction, at: r.order_date, product: r.product_name, lang: langOf(r.product_id), price: r.price, currency: r.currency, status: r.status, name: r.buyer_name, email: r.buyer_email, country: r.buyer_country, source: r.source, track: TR[r.transaction] || HM.track(r), coupon: r.coupon, pay: r.payment_type, customer: cust[r.buyer_email] || null });
    const coupons = paid.filter((r) => r.coupon).map((r) => { const t = Date.parse(r.order_date), ok = (hist[r.buyer_email] || []).some((x) => x < t && t - x <= 30 * 864e5); return Object.assign(sale(r), { earlier: ok }); });
    return res.json({ connected: HM.configured(), webflow: WF.configured(), wfNote, ready: true, from, to, last, empty: !total, funnel, leads: leadRows.slice(0, 500),
      onsite: onsite.map((l) => ({ at: l.submitted_at, name: l.name, company: l.company, email: l.email, phone: l.phone, data: l.data, deal: l.deal_id, customer: cust[l.email] || null })),
      totals: { sales: paid.length, refunds: back.length, students: students.length, currencies: Object.values(cur).sort((a, z) => z.sales - a.sales), main, ticket: main.sales ? main.revenue / main.sales : 0, refundRate: paid.length + back.length ? back.length / (paid.length + back.length) : 0,
        customers: students.filter((x) => x.customer).length, courseFirst: students.filter((x) => x.path === 'course first').length, repeat: students.filter((x) => x.courses > 1).length },
      analytics, lost: lostU.slice(0, 400), lostTotals: { all: lostU.length, open: lostU.filter((x) => !x.recovered).length, recovered: lostU.filter((x) => x.recovered).length, carts: carts.length },
      products: Object.values(prod).sort((a, z) => z.sales - a.sales), months: Object.values(month).sort((a, z) => (a.key < z.key ? -1 : 1)), langs: Object.values(lang), sources: Object.values(src).sort((a, z) => z.sales - a.sales).slice(0, 12), countries: Object.values(country).sort((a, z) => z.sales - a.sales).slice(0, 12),
      students: students.sort((a, z) => (z.customer ? 1 : 0) - (a.customer ? 1 : 0) || z.courses - a.courses || (z.last > a.last ? 1 : -1)).slice(0, 300), recent: rows.filter((r) => HM.PAID.includes(r.status) || HM.BACK.includes(r.status)).slice(0, 400).map(sale), coupons });
  };
  // one student or lead, opened from any list of the screen: purchases, form answers, the Max customer match and the progress in the members area
  A['dta-student'] = async (req, res) => {
    const w = await who(req, res); if (!w) return;
    if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
    const email = String(req.query.email || '').trim().toLowerCase(); if (!/^[^\s"'(),]+@[^\s"'(),]+$/.test(email)) return res.status(400).json({ error: 'email' });
    const q = encodeURIComponent(email);
    const [sales, leads, carts, ulc, pu] = await Promise.all([
      db.select('hotmart_sales', 'select=*&buyer_email=eq.' + q + '&order=order_date.desc&limit=100').catch(() => []),
      db.select('dta_leads', 'select=*&email=eq.' + q + '&order=submitted_at.desc&limit=50').catch(() => []),
      db.select('hotmart_carts', 'select=*&buyer_email=eq.' + q + '&order=event_at.desc&limit=50').catch(() => []),
      db.select('ul_customers', 'select=code,name,type,tier,city,state,country,salesperson,created_on,obsolete&email=ilike.' + q + '&limit=3').catch(() => []),
      db.select('users', 'select=email,name,company_id&email=ilike.' + q + '&limit=1').catch(() => [])]);
    const c = ulc.filter((x) => !x.obsolete)[0] || null; let parts = null;
    if (c) { const po = (await db.selectAll('sales_orders', 'select=order_date,is_return&customer_code=eq.' + encodeURIComponent(c.code), 5000).catch(() => [])).filter((o) => !o.is_return && o.order_date).map((o) => o.order_date).sort();
      parts = { orders: po.length, first: po[0] || null, last: po[po.length - 1] || null }; }
    let progress = { areas: [], note: '' };
    try { progress = await HM.club(email); } catch (e) { console.error('dta club', e.message); progress = { areas: [], note: 'Could not read the members area.' }; }
    const pick = (k) => [].concat(sales, leads, carts).map((x) => x[k]).filter(Boolean)[0] || null;
    const AL = { facebook: 'fb', instagram: 'ig' };
    return res.json({ email, name: pick('buyer_name') || pick('name') || (progress.areas[0] && progress.areas[0].name) || '', phone: pick('buyer_phone') || pick('phone'), country: pick('buyer_country'),
      customer: c ? { code: c.code, name: c.name, type: c.type, tier: c.tier, where: [c.city, c.state, c.country].filter(Boolean).join(', '), salesperson: c.salesperson, since: c.created_on, parts } : pu[0] ? { code: null, portal: true } : null,
      sales: sales.map((r) => ({ at: r.order_date, product: r.product_name, price: r.price, currency: r.currency, status: r.status, pay: r.payment_type, installments: r.installments, coupon: r.coupon, track: HM.track(r) })),
      leads: leads.map((l) => ({ at: l.submitted_at, kind: l.kind, course: l.course, value: l.value, landing: l.landing || l.page, referrer: l.referrer, source: AL[l.utm_source] || l.utm_source, medium: l.utm_medium, campaign: l.utm_campaign, content: l.utm_content, term: l.utm_term })),
      carts: carts.map((x) => ({ at: x.event_at, product: x.product_name })), progress });
  };
  // reads the history from Hotmart again (first import, or to catch what a webhook missed). Superadmin and manager only.
  A['dta-sync'] = async (req, res) => {
    if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
    const w = await who(req, res); if (!w) return;
    if (!can(w, 'admin')) return res.status(403).json({ error: 'role' });
    try { let wf = null; if (WF.configured()) { try { wf = await WF.sync({ full: true, budgetMs: 12000 }); } catch (e) { wf = { error: 'Could not read the forms from Webflow.' }; } }
      const out = await HM.sync({ budgetMs: 38000 }); out.forms = wf; await audit(w.email, 'dta.sync', 'dta', '', null, { rows: out.rows || 0, partial: !!out.partial, shape: out.shape || 0, older: out.older || 0, note: out.note || null, error: out.error || null }); return res.json(Object.assign({ ok: !out.error }, out)); }
    catch (e) { console.error('dta sync', e.message); return res.status(502).json({ error: 'Could not read the sales from Hotmart. Check the credentials in Vercel.' }); }
  };
};
module.exports.langOf = langOf;
