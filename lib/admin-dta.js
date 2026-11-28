// Admin handlers of Analytics > DTA courses: the Hotmart sales of Diesel Tech Academy, kept apart from the parts revenue.
const db = require('./db');
const HM = require('./hotmart');
const WF = require('./webflow');
const ISO10 = /^\d{4}-\d{2}-\d{2}$/;
// Spanish membership area products start with 744 or 745; the rest is the English area
const langOf = (id) => (/^74[45]/.test(String(id || '')) ? 'Spanish' : 'English');

// Onsite training requests become deals in the CRM, in their own pipeline (source onsite_training), owned by ONSITE_OWNER.
// Runs after every reading of the forms; a request already turned into a deal is left alone.
const ONSITE_OWNER = () => process.env.ONSITE_OWNER || 'Michael';
async function onsiteToCrm() {
  const todo = await db.select('dta_leads', 'select=*&kind=eq.onsite&deal_id=is.null&order=submitted_at.asc&limit=50').catch(() => []);
  let made = 0;
  for (const l of todo) {
    const D = l.data || {}, sys = Object.keys(D).filter((k) => D[k] === 'true' && !/robiel|consent/i.test(k));
    let code = null, cname = null;
    if (l.email) { const u = (await db.select('ul_customers', 'select=code,name,obsolete&email=ilike.' + encodeURIComponent(l.email) + '&limit=2').catch(() => [])).filter((x) => !x.obsolete)[0]; if (u) { code = u.code; cname = u.name; } }
    const note = [D.Location && 'Where: ' + D.Location, sys.length && 'Systems: ' + sys.join(', '), D.Technicians && 'Technicians: ' + D.Technicians, D.Timing && 'Timing: ' + D.Timing, /true/.test(D['Interested in ROBIEL tools and parts'] || '') && 'Wants ROBIEL tools and parts', D.Message && 'Message: ' + String(D.Message).slice(0, 1500), code && 'Already a Max customer: ' + cname].filter(Boolean).join('\n');
    const row = { title: 'Onsite training · ' + (l.company || l.name || l.email || 'request'), stage: 'new', owner: ONSITE_OWNER(), customer_name: cname || l.company || l.name || null, customer_code: code, contact_name: l.name || null, contact_email: l.email || null, contact_phone: l.phone || null, value: 0, source: 'onsite_training', ref: 'onsite:' + l.id, note: note || null, created_by: 'auto', created_at: l.submitted_at, stage_at: l.submitted_at };
    try { let ins = await db.insert('crm_deals', [row], { onConflict: 'ref', ignoreDuplicates: true });
      let id = Array.isArray(ins) && ins[0] && ins[0].id;
      if (!id) { const ex = (await db.select('crm_deals', 'select=id&ref=eq.' + encodeURIComponent(row.ref) + '&limit=1').catch(() => []))[0]; id = ex && ex.id; }
      else { await db.insert('crm_activities', [{ deal_id: id, kind: 'stage', body: 'Created from the onsite training form of the DTA site', created_by: 'auto' }]).catch(() => {}); made++; }
      if (id) await db.update('dta_leads', 'id=eq.' + encodeURIComponent(l.id), { deal_id: String(id) }).catch(() => {});
    } catch (e) { console.error('onsite deal', e.message); }
  }
  return made;
}
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

module.exports = function mount(A, H) {
  const { who, can, originOk, clean, audit } = H;
  A['dta-sales'] = async (req, res) => {
    const w = await who(req, res); if (!w) return;
    if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
    const today = new Date().toISOString().slice(0, 10), seeParts = can(w, 'sales');
    const to = ISO10.test(req.query.to || '') ? req.query.to : today, from = ISO10.test(req.query.from || '') ? req.query.from : new Date(Date.parse(to) - 364 * 864e5).toISOString().slice(0, 10);
    let rows;
    try { rows = await db.selectAll('hotmart_sales', 'select=*&order_date=gte.' + from + 'T00:00:00Z&order_date=lte.' + to + 'T23:59:59Z&order=order_date.desc', 20000); }
    catch (e) { return res.json({ connected: HM.configured(), ready: false, from, to, note: 'The sales table does not exist yet.' }); }
    // form answers of the DTA site (Webflow). The newest page is read again when the last reading is older than 15 minutes.
    let wfNote = null;
    if (WF.configured()) { const lw = (await db.select('dta_leads', 'select=updated_at&order=updated_at.desc&limit=1').catch(() => []))[0];
      if (!lw || Date.now() - Date.parse(lw.updated_at) > 15 * 60e3) { try { const o = await WF.sync({ full: !lw, budgetMs: 8000 }); if (o.error) wfNote = o.error; } catch (e) { wfNote = 'Could not read the forms from Webflow.'; } } }
    await onsiteToCrm().catch((e) => console.error('onsite', e.message));
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
    // the same sales by day and by week (weeks start on Monday), with the empty days and weeks kept so the chart shows the gaps
    const dkey = (d) => String(d).slice(0, 10), wkey = (d) => { const t = new Date(dkey(d) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
    const fill = (kf, step) => { const m = {}; paid.forEach((r) => { if (!r.order_date) return; const k = kf(r.order_date), x = m[k] || (m[k] = { key: k, sales: 0, revenue: {} }); x.sales++; x.revenue[r.currency || '?'] = (x.revenue[r.currency || '?'] || 0) + (Number(r.price) || 0); });
      const ks = Object.keys(m).sort(); if (!ks.length) return [];
      const out = [], end = kf(to + 'T12:00:00Z'); let c = new Date((ks[0] < kf(from + 'T12:00:00Z') ? ks[0] : kf(from + 'T12:00:00Z') < ks[0] && paid.length && Date.parse(to) - Date.parse(from) < 200 * 864e5 ? kf(from + 'T12:00:00Z') : ks[0]) + 'T12:00:00Z');
      for (let i = 0; i < 800; i++) { const k = c.toISOString().slice(0, 10); if (k > end) break; out.push(m[k] || { key: k, sales: 0, revenue: {} }); c.setUTCDate(c.getUTCDate() + step); }
      return out; };
    const days = fill(dkey, 1), weeks = fill(wkey, 7);
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
      (await db.selectAll('sales_orders', 'select=customer_code,order_date,is_return,subtotal&customer_code=in.(' + codes.slice(i, i + 80).map((c) => encodeURIComponent('"' + c + '"')).join(',') + ')', 20000).catch(() => []))
        .forEach((o) => { if (!o.order_date) return; const x = po[o.customer_code] || (po[o.customer_code] = { n: 0, first: o.order_date, last: o.order_date, list: [] }); const v = Number(o.subtotal) || 0; x.list.push([String(o.order_date).slice(0, 10), o.is_return ? -Math.abs(v) : v]); if (o.is_return) return; x.n++; if (o.order_date < x.first) x.first = o.order_date; if (o.order_date > x.last) x.last = o.order_date; });
    }
    students.forEach((x) => { const c = x.customer; if (!c || !c.code) return; const o = po[c.code]; x.parts = o ? { orders: o.n, first: o.first, last: o.last } : { orders: 0 };
      x.path = !o ? 'no order yet' : String(o.first).slice(0, 10) < String(x.first).slice(0, 10) ? 'customer first' : 'course first';
      // parts bought from the day of the first course on: the number that shows what the courses bring to the parts business
      if (o) { const f = String(x.first).slice(0, 10), aft = o.list.filter((a) => a[0] >= f), bef = o.list.filter((a) => a[0] < f); x.partsAfter = seeParts ? Math.round(aft.reduce((t, a) => t + a[1], 0)) : null; x.partsBefore = seeParts ? Math.round(bef.reduce((t, a) => t + a[1], 0)) : null; x.ordersAfter = aft.filter((a) => a[1] > 0).length;
        const fa = aft.filter((a) => a[1] > 0).map((a) => a[0]).sort()[0]; x.daysToParts = fa ? Math.round((Date.parse(fa) - Date.parse(f)) / 864e5) : null; } });
    const withAfter = students.filter((x) => x.ordersAfter > 0), newAfter = withAfter.filter((x) => x.path === 'course first');
    const courseOf = {}; paid.forEach((r) => { if (!r.buyer_email) return; (courseOf[r.buyer_email] = courseOf[r.buyer_email] || {})[r.product_name || '?'] = 1; });
    const byCourse = {}; students.forEach((x) => { Object.keys(courseOf[x.email] || {}).forEach((cn) => { const b = byCourse[cn] || (byCourse[cn] = { name: cn, students: 0, max: 0, after: 0, parts: 0 }); b.students++; if (x.customer && x.customer.code) b.max++; if (x.ordersAfter > 0) { b.after++; b.parts += x.partsAfter || 0; } }); });
    const toParts = { seeParts, students: students.length, max: students.filter((x) => x.customer && x.customer.code).length, after: withAfter.length, newAfter: newAfter.length, parts: seeParts ? withAfter.reduce((t, x) => t + (x.partsAfter || 0), 0) : null, partsNew: seeParts ? newAfter.reduce((t, x) => t + (x.partsAfter || 0), 0) : null,
      days: median(withAfter.map((x) => x.daysToParts).filter((v) => v != null)), courses: Object.values(byCourse).map((b) => Object.assign(b, { parts: seeParts ? b.parts : null })).sort((a, z) => z.after - a.after || z.students - a.students) };
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
    const all = total ? await db.selectAll('hotmart_sales', 'select=buyer_email,order_date,status,price,currency&order=order_date', 50000).catch(() => []) : [];
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
    // how long things take: form answer to purchase, first course to second course
    const gapL = leadRows.filter((x) => x.status === 'bought').map((x) => { const lim = Date.parse(x.at) - 864e5, d = (paidAt[x.email] || []).map((v) => Date.parse(v)).filter((v) => v >= lim).sort((a, b) => a - b)[0]; return d == null ? null : Math.max(0, Math.round((d - Date.parse(x.at)) / 864e5)); }).filter((v) => v != null);
    const gap2 = []; Object.keys(paidAt).forEach((e) => { const ds = [...new Set(paidAt[e].map((v) => String(v).slice(0, 10)))].sort(); if (ds.length > 1) gap2.push(Math.round((Date.parse(ds[1]) - Date.parse(ds[0])) / 864e5)); });
    const timing = { leadDays: median(gapL), leadSame: gapL.filter((v) => v === 0).length, lead3: gapL.filter((v) => v > 0 && v <= 3).length, leadLater: gapL.filter((v) => v > 3).length, leadN: gapL.length, secondDays: median(gap2), secondN: gap2.length, buyers: Object.keys(paidAt).length };
    // the same numbers for the period right before, to show whether things are moving
    let prev = null; const span = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
    if (span <= 366) { const pt = new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10), pf = new Date(Date.parse(from) - span * 864e5).toISOString().slice(0, 10);
      const pr = all.filter((r) => String(r.order_date) >= pf + 'T00:00:00' && String(r.order_date) <= pt + 'T23:59:59' && HM.PAID.includes(r.status));
      const pl = (await db.select('dta_leads', 'select=email&kind=eq.course&submitted_at=gte.' + pf + 'T00:00:00Z&submitted_at=lte.' + pt + 'T23:59:59Z&limit=5000').catch(() => []));
      prev = { from: pf, to: pt, sales: pr.length, revenue: pr.filter((r) => (r.currency || '?') === main.currency).reduce((t, r) => t + (Number(r.price) || 0), 0), leads: new Set(pl.map((x) => x.email).filter(Boolean)).size }; }
    // second-course voucher: a sale with a coupon needs an earlier paid sale of the same e-mail in the 30 days before it
    const hist = {}; all.forEach((r) => { if (r.buyer_email && HM.PAID.includes(r.status)) (hist[r.buyer_email] = hist[r.buyer_email] || []).push(Date.parse(r.order_date)); });
    const sale = (r) => ({ tx: r.transaction, at: r.order_date, product: r.product_name, lang: langOf(r.product_id), price: r.price, currency: r.currency, status: r.status, name: r.buyer_name, email: r.buyer_email, country: r.buyer_country, source: r.source, track: TR[r.transaction] || HM.track(r), coupon: r.coupon, pay: r.payment_type, customer: cust[r.buyer_email] || null });
    const coupons = paid.filter((r) => r.coupon).map((r) => { const t = Date.parse(r.order_date), ok = (hist[r.buyer_email] || []).some((x) => x < t && t - x <= 30 * 864e5); return Object.assign(sale(r), { earlier: ok }); });
    return res.json({ connected: HM.configured(), webflow: WF.configured(), wfNote, ready: true, from, to, last, empty: !total, funnel, toParts, timing, prev, leads: leadRows.slice(0, 500),
      onsite: onsite.map((l) => ({ at: l.submitted_at, name: l.name, company: l.company, email: l.email, phone: l.phone, data: l.data, deal: l.deal_id, owner: ONSITE_OWNER(), customer: cust[l.email] || null })),
      totals: { sales: paid.length, refunds: back.length, students: students.length, currencies: Object.values(cur).sort((a, z) => z.sales - a.sales), main, ticket: main.sales ? main.revenue / main.sales : 0, refundRate: paid.length + back.length ? back.length / (paid.length + back.length) : 0,
        customers: students.filter((x) => x.customer).length, courseFirst: students.filter((x) => x.path === 'course first').length, repeat: students.filter((x) => x.courses > 1).length },
      analytics, lost: lostU.slice(0, 400), lostTotals: { all: lostU.length, open: lostU.filter((x) => !x.recovered).length, recovered: lostU.filter((x) => x.recovered).length, carts: carts.length },
      products: Object.values(prod).sort((a, z) => z.sales - a.sales), months: Object.values(month).sort((a, z) => (a.key < z.key ? -1 : 1)), weeks, days: days.length <= 400 ? days : [], langs: Object.values(lang), sources: Object.values(src).sort((a, z) => z.sales - a.sales).slice(0, 12), countries: Object.values(country).sort((a, z) => z.sales - a.sales).slice(0, 12),
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
    // a superadmin can try other area addresses while the right one is being found
    const tryAreas = w.role === 'superadmin' && req.query.club ? String(req.query.club).split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9._-]{2,80}$/.test(x)).slice(0, 8) : null;
    try { progress = await HM.club(email, tryAreas); } catch (e) { console.error('dta club', e.message); progress = { areas: [], note: 'Could not read the members area.' }; }
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
