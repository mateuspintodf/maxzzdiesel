// Hotmart: the course sales of Diesel Tech Academy. Reads the sales history through the Hotmart API and maps
// both the API rows and the webhook events to one row per transaction in the table hotmart_sales.
// Credentials live only in Vercel: HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET, HOTMART_BASIC (the "Basic" token Hotmart shows).
const db = require('./db');
const configured = () => !!(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC);
const s = (v, n) => (v == null ? null : String(v).replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim().slice(0, n || 200) || null);
const iso = (ms) => { const n = Number(ms); if (n > 0) return new Date(n).toISOString(); const d = Date.parse(ms); return d ? new Date(d).toISOString() : null; };
// what counts as money in, and what counts as money given back
const PAID = ['APPROVED', 'COMPLETE'], BACK = ['REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED', 'PROTESTED'];
const STATUSES = ['APPROVED', 'COMPLETE', 'REFUNDED', 'CHARGEBACK', 'PARTIALLY_REFUNDED', 'PROTESTED', 'CANCELLED'];
// started and not paid: boleto or pix issued, waiting, expired, card refused. Read after the main ones; a status Hotmart refuses is skipped.
const OPEN = ['WAITING_PAYMENT', 'PRINTED_BILLET', 'EXPIRED', 'NO_FUNDS', 'OVERDUE', 'BLOCKED', 'STARTED'];
// webhook event name -> the status the sale ends in
const EVENT = { PURCHASE_APPROVED: 'APPROVED', PURCHASE_COMPLETE: 'COMPLETE', PURCHASE_REFUNDED: 'REFUNDED', PURCHASE_CHARGEBACK: 'CHARGEBACK', PURCHASE_PROTEST: 'PROTESTED', PURCHASE_CANCELED: 'CANCELLED', PURCHASE_BILLET_PRINTED: 'PRINTED_BILLET', PURCHASE_DELAYED: 'OVERDUE', PURCHASE_EXPIRED: 'EXPIRED' };

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
    payment_type: s(pay.type, 40), installments: Number(pay.installments_number) || null, buyer_email: s(b.email, 200) && s(b.email, 200).toLowerCase(), buyer_name: s(b.name, 160), source: s(tr.source, 120), source_sck: s(tr.source_sck, 120), external_code: s(tr.external_code, 120),
    commission_as: s(p.commission_as, 20), is_subscription: !!p.is_subscription, order_date: iso(p.order_date), approved_date: iso(p.approved_date), origin: 'api', updated_at: new Date().toISOString() };
}
// one webhook event (version 2 payload). Returns null for events that are not about a sale.
function fromWebhook(b) {
  const st = EVENT[String(b.event || '')]; const d = b.data || {}, p = d.purchase || {}, by = d.buyer || {}, pr = d.product || {}, of = p.offer || {}, or = p.origin || {}, pay = p.payment || {};
  if (!st || !p.transaction) return null;
  const row = { transaction: s(p.transaction, 60), status: st, product_id: Number(pr.id) || null, product_name: s(pr.name, 200), offer_code: s(of.code, 60), coupon: s(of.coupon_code, 60), price: p.price && p.price.value != null ? Number(p.price.value) : null, currency: s(p.price && p.price.currency_value, 8),
    payment_type: s(pay.type, 40), installments: Number(pay.installments_number) || null, buyer_email: s(by.email, 200) && s(by.email, 200).toLowerCase(), buyer_name: s(by.name, 160), buyer_phone: s(by.checkout_phone || by.phone, 40), buyer_country: s(p.checkout_country && (p.checkout_country.iso || p.checkout_country.name), 60) || s(by.address && by.address.country_iso, 60),
    source: s(or.src || or.utm_source, 120), source_sck: s(or.sck || [or.utm_source, or.utm_medium, or.utm_campaign, or.utm_content].some(Boolean) && [or.utm_source, or.utm_medium, or.utm_campaign, or.utm_content].map((x) => x || '').join('|') || null, 120), external_code: s(or.xcod, 120), is_subscription: !!(d.subscription && d.subscription.subscriber), order_date: iso(p.order_date), approved_date: iso(p.approved_date), origin: 'webhook', updated_at: new Date().toISOString() };
  if (BACK.includes(st)) row.refunded_at = iso(b.creation_date) || new Date().toISOString();
  // a refund event may arrive with less than the sale had: never overwrite a known value with nothing
  Object.keys(row).forEach((k) => { if (row[k] == null) delete row[k]; });
  return row;
}
// cart abandonment event: someone filled the checkout and left. No transaction number, so the key is buyer + product + day.
function cartFromWebhook(b) {
  if (String(b.event || '') !== 'PURCHASE_OUT_OF_SHOPPING_CART') return null;
  const d = b.data || {}, by = d.buyer || {}, pr = d.product || {}, of = d.offer || {}, email = s(by.email, 200) && s(by.email, 200).toLowerCase();
  if (!email) return null;
  const at = iso(b.creation_date) || new Date().toISOString();
  return { id: require('crypto').createHash('sha1').update(email + '|' + (pr.id || pr.name || '') + '|' + at.slice(0, 10)).digest('hex').slice(0, 32), event_at: at, product_id: Number(pr.id) || null, product_name: s(pr.name, 200), offer_code: s(of.code, 60),
    buyer_email: email, buyer_name: s(by.name, 160), buyer_phone: s(by.checkout_phone || by.phone, 40), buyer_country: s(d.checkout_country && (d.checkout_country.iso || d.checkout_country.name), 60), updated_at: new Date().toISOString() };
}
const saveCart = (row) => db.insert('hotmart_carts', [row], { onConflict: 'id' });
const save = (rows) => (rows.length ? db.insert('hotmart_sales', rows, { onConflict: 'transaction' }) : Promise.resolve([]));

// Copies the history into the table. Hotmart only returns approved and complete sales unless each status is asked for,
// so every status is read in turn. Stops when the time budget is over and says where it stopped.
async function sync({ sinceMs, budgetMs } = {}) {
  if (!configured()) return { error: 'Hotmart is not connected yet.' };
  const t0 = Date.now(), tk = await token(), start = sinceMs || Date.UTC(2022, 0, 1), end = Date.now(); let rows = 0, pages = 0, shape = 0, why = ''; const seen = {};
  // request shapes, from the fastest to the plainest
  const SHAPES = [(a, b) => 'max_results=100&start_date=' + a + '&end_date=' + b, (a, b) => 'max_results=50&start_date=' + a + '&end_date=' + b, (a, b) => 'start_date=' + a + '&end_date=' + b, (a, b) => 'start_date=' + Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), new Date().getUTCDate()) + '&end_date=' + b, () => 'max_results=50'];
  for (const st of STATUSES.concat(OPEN)) {
    let page = '';
    for (let i = 0; i < 200; i++) {
      if (Date.now() - t0 > (budgetMs || 40000)) return { ok: true, partial: true, rows, pages, stoppedAt: st };
      const u = 'https://developers.hotmart.com/payments/api/v1/sales/history?' + SHAPES[shape](start, end) + '&transaction_status=' + st + (page ? '&page_token=' + encodeURIComponent(page) : '');
      const r = await fetch(u, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk } });
      if (r.status === 429) { await new Promise((z) => setTimeout(z, 1500)); continue; }
      const txt = await r.text().catch(() => ''); let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      // Hotmart refuses some combinations of page size and dates with a 400: try the next request shape before giving up
      if (r.status === 400 && !page && shape < SHAPES.length - 1) { why = txt.replace(/\s+/g, ' ').slice(0, 160); shape++; i--; continue; }
      if (r.status === 400) why = txt.replace(/\s+/g, ' ').slice(0, 160) || why;
      if (!r.ok && OPEN.includes(st)) break;
      if (!r.ok) return { error: 'Hotmart answered ' + r.status + ' reading ' + st + '.' + (r.status === 401 || r.status === 403 ? ' The credential was not accepted.' : '') + (why ? ' Hotmart said: ' + why : ''), rows, pages };
      const batch = (j.items || []).map(fromApi).filter(Boolean);
      // the same sale can be listed for the producer and the co-producer: keep one row
      const uniq = batch.filter((x) => (seen[x.transaction + x.status] ? false : (seen[x.transaction + x.status] = 1)));
      await save(uniq); rows += uniq.length; pages++;
      page = j.page_info && j.page_info.next_page_token; if (!page) break;
    }
  }
  // when Hotmart only accepted a one year window, walk back year by year (paid and refunded sales only) until two empty years in a row
  let older = 0;
  if (shape === 3) {
    const Y = 365 * 864e5; let b = Date.now() - Y, emptyYears = 0;
    for (let y = 0; y < 10 && emptyYears < 2; y++, b -= Y) {
      let got = 0;
      for (const st of ['APPROVED', 'COMPLETE', 'REFUNDED', 'CHARGEBACK']) {
        let page = '';
        for (let i = 0; i < 100; i++) {
          if (Date.now() - t0 > (budgetMs || 40000)) return { ok: true, partial: true, rows, pages, shape, older };
          const r = await fetch('https://developers.hotmart.com/payments/api/v1/sales/history?start_date=' + (b - Y) + '&end_date=' + b + '&transaction_status=' + st + (page ? '&page_token=' + encodeURIComponent(page) : ''), { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk } });
          if (r.status === 429) { await new Promise((z) => setTimeout(z, 1500)); continue; }
          const j = await r.json().catch(() => ({})); if (!r.ok) break;
          const batch = (j.items || []).map(fromApi).filter(Boolean).filter((x) => (seen[x.transaction + x.status] ? false : (seen[x.transaction + x.status] = 1)));
          await save(batch); rows += batch.length; older += batch.length; got += batch.length; pages++;
          page = j.page_info && j.page_info.next_page_token; if (!page) break;
        }
      }
      emptyYears = got ? 0 : emptyYears + 1;
    }
  }
  return { ok: true, rows, pages, shape, older, note: shape ? why : '' };
}
// Reads the tracking tags of a sale as source / medium / campaign / content.
// Accepted shapes: sck (or xcod) as "source|medium|campaign|content", or a query string with utm_ keys, or plain src + sck (source + campaign).
function track(r) {
  const out = { source: '', medium: '', campaign: '', content: '' }, src = String(r.source || '').trim(), raw = [r.source_sck, r.external_code].map((x) => String(x || '').trim()).filter(Boolean);
  const q = raw.find((x) => /utm_(source|medium|campaign)=/i.test(x)), bar = raw.find((x) => x.indexOf('|') >= 0);
  if (q) { q.split(/[&;]/).forEach((kv) => { const m = /^utm_(source|medium|campaign|content)=(.*)$/i.exec(kv); if (m) { try { out[m[1].toLowerCase()] = decodeURIComponent(m[2]); } catch (e) { out[m[1].toLowerCase()] = m[2]; } } }); }
  else if (bar) { const a = bar.split('|').map((x) => x.trim()); out.source = a[0] || ''; out.medium = a[1] || ''; out.campaign = a[2] || ''; out.content = a[3] || ''; }
  else if (src) { out.campaign = raw[0] || ''; }
  else if (raw[0]) { out.source = raw[0]; }
  if (!out.source) out.source = src;
  Object.keys(out).forEach((k) => { out[k] = out[k].toLowerCase().slice(0, 80); });
  out.tagged = !!(out.source || out.medium || out.campaign);
  return out;
}
// Members area (Hotmart Club): how far a student went. One request for the student in each area, one for the lessons.
// HOTMART_CLUB can replace the list of area subdomains (comma separated).
const AREAS = () => String(process.env.HOTMART_CLUB || 'dieseltechacademy').split(',').map((x) => x.trim()).filter(Boolean);
async function club(email, areas) {
  if (!configured()) return { areas: [], note: 'Hotmart is not connected.' };
  const tk = await token(), H = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk } }, out = [], debug = []; let note = '';
  for (const sub of (areas && areas.length ? areas : AREAS())) {
    const r = await fetch('https://developers.hotmart.com/club/api/v1/users?subdomain=' + encodeURIComponent(sub) + '&email=' + encodeURIComponent(email), H).catch(() => null);
    if (!r || !r.ok) { debug.push({ area: sub, status: r ? r.status : 0, body: r ? (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200) : '' }); if (r && r.status !== 404) note = 'The members area ' + sub + ' answered ' + r.status + '.'; continue; }
    const j = await r.json().catch(() => ({}));
    const list = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : j.items && typeof j.items === 'object' && Object.keys(j.items).length ? [j.items] : Array.isArray(j.users) ? j.users : j.user_id || j.email ? [j] : [];
    debug.push({ area: sub, status: r.status, keys: Array.isArray(j) ? ['(array)'] : Object.keys(j), itemsType: Array.isArray(j.items) ? 'array' : typeof j.items, items: list.length, itemKeys: list[0] ? Object.keys(list[0]) : [], progressKeys: list[0] && list[0].progress ? Object.keys(list[0].progress) : [] });
    if (!list.length && areas && areas.length) { // looking for the right address: what does the area answer without the e-mail filter
      const r2 = await fetch('https://developers.hotmart.com/club/api/v1/users?subdomain=' + encodeURIComponent(sub) + '&max_results=3', H).catch(() => null), j2 = r2 && r2.ok ? await r2.json().catch(() => ({})) : {};
      const l2 = Array.isArray(j2.items) ? j2.items : [];
      debug.push({ probe: sub, status: r2 ? r2.status : 0, keys: Object.keys(j2), n: l2.length, itemKeys: l2[0] ? Object.keys(l2[0]) : [], progressKeys: l2[0] && l2[0].progress ? Object.keys(l2[0].progress) : [], page: j2.page_info ? Object.keys(j2.page_info) : [] }); }
    for (const u of list.slice(0, 3)) {
      const pr = u.progress || {}, a = { area: sub, name: s(u.name, 160), status: s(u.status, 40), role: s(u.role, 40), first: iso(u.first_access_date), last: iso(u.last_access_date), visits: Number(u.access_count) || 0, engagement: s(u.engagement, 40),
        pct: pr.completed_percentage != null ? Number(pr.completed_percentage) : null, done: pr.completed != null ? Number(pr.completed) : null, total: pr.total != null ? Number(pr.total) : null, modules: [] };
      const id = u.user_id || u.id;
      if (id) { const lr = await fetch('https://developers.hotmart.com/club/api/v1/users/' + encodeURIComponent(id) + '/lessons?subdomain=' + encodeURIComponent(sub), H).catch(() => null);
        if (lr) debug.push({ lessons: lr.status });
        if (lr && lr.ok) { const lj = await lr.json().catch(() => ({})), m = {}; const LL = Array.isArray(lj) ? lj : Array.isArray(lj.lessons) ? lj.lessons : Array.isArray(lj.items) ? lj.items : []; debug.push({ lessonKeys: Array.isArray(lj) ? ['(array)'] : Object.keys(lj), n: LL.length, first: LL[0] ? Object.keys(LL[0]) : [] });
          LL.forEach((l) => { const k = s(l.module_name, 160) || 'Course'; const x = m[k] || (m[k] = { name: k, done: 0, total: 0, last: null, next: null }); x.total++; if (l.is_completed) { x.done++; const d = iso(l.completed_date); if (d && (!x.last || d > x.last)) x.last = d; } else if (!x.next) x.next = s(l.page_name, 160); });
          a.modules = Object.values(m); } }
      out.push(a);
    }
  }
  return { areas: out, note, debug };
}
module.exports = { club, track, cartFromWebhook, saveCart, OPEN,  configured, sync, fromWebhook, fromApi, save, PAID, BACK };
