// B2B portal API: /api/portal?a=<action> (rewritten from /api/portal/<action>).
// Unleashed stays the source of truth for customers, prices, stock and orders. This function only:
//  - signs people in with an e-mailed link (no passwords),
//  - keeps the portal's own list of users and access requests (private blob portal/db.json),
//  - shows each approved customer the prices of their own Unleashed sell price tier and available stock,
//  - turns a cart into a Sales Order in Unleashed (status Parked, for the sales team to review).
// Costs never leave the server; nothing here reads cost fields.
const crypto = require('crypto');
const { readJson, writeJson, cached, nextNumber } = require('../lib/store');
const { ul, configured } = require('../lib/unleashed');
const { loginToken, verify, setSession, clearSession } = require('../lib/session');
const { authenticate } = require('../lib/auth');
const PS = require('../lib/portal-store');
const SDB = require('../lib/sessions-db');
const dbm = require('../lib/db');
const { hiddenSet } = require('../lib/hidden');
const vouchers = require('../lib/vouchers');
const { send, esc } = require('../lib/mail');
const { upsertContact, addNote, addTask } = require('../lib/hubspot');
const { notifyTeam, hubContact } = require('../lib/notify');
const { EMAIL, clean, readBody } = require('../lib/validate');

const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const DB = 'portal/db.json';
const USED = 'portal/used-links.json';
const hits = new Map();

// PORTAL_ADMINS plus the team superadmins (Leise, Michael, marketing@), who see the portal as admins
const admins = () => (String(process.env.PORTAL_ADMINS || '') + ',' + String(process.env.TEAM_SUPERADMINS || 'admin@maxzzdiesel.com,michael@maxzzdiesel.com,marketing@maxzzdiesel.com')).toLowerCase().split(/[,\s]+/).filter(Boolean);
const isAdmin = (email) => !!email && admins().includes(email);
const liveOrders = () => process.env.PORTAL_ORDERS_LIVE === '1';
const base = (req) => process.env.SITE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://www.maxzzdiesel.com' : 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));

async function limited(req, key, max, windowMs) {
  if (PS.on()) { try { return await SDB.limited(req, key, max, windowMs); } catch (e) { console.error('rate limit db', e.message); } }
  const k = key + '|' + String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), now = Date.now();
  const list = (hits.get(k) || []).filter((x) => now - x < windowMs);
  if (list.length >= max) return true;
  list.push(now); hits.set(k, list);
  if (hits.size > 5000) for (const [kk, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(kk);
  return false;
}
function originOk(req) { const o = req.headers.origin || ''; return !o || ALLOWED.some((re) => re.test(o)); }
async function loadDb() { if (PS.on()) return PS.loadDb(); return (await readJson(DB)) || { users: {}, accounts: {} }; }
// signs the person in: database session when PORTAL_DB=1, the signed cookie otherwise
async function startSession(req, res, email, user) { if (PS.on()) return SDB.create(req, res, 'customer', email, user && user.id); setSession(res, email); }
const money = (n) => Math.round(n * 100) / 100;
const id = () => crypto.randomBytes(8).toString('hex');

const whoami = (req) => authenticate(req);

// prices for one account: its Unleashed tier, or the default sell price
async function priceBook(account, admin) {
  const hid = admin ? new Set() : await hiddenSet();
  const prod = await cached('portal/products.json', 10 * 60 * 1000);
  const stock = await cached('portal/stock.json', 10 * 60 * 1000);
  if (!prod) return null;
  const idx = account && account.tier ? (prod.tiers || []).findIndex((t) => String(t).toLowerCase() === String(account.tier).toLowerCase()) : -1;
  const out = {};
  for (const [code, p] of Object.entries(prod.items || {})) {
    if (hid.has(code)) continue;
    let price = idx >= 0 ? p.t[idx] : null;
    if (!(price > 0)) price = p.d;
    if (!(price > 0)) price = null; // zero or missing price shows "Ask us" and cannot be ordered
    out[code] = [price == null ? null : money(price), stock && stock.qty ? (stock.qty[code] ?? 0) : null, p.img || null, p.u || null];
  }
  return { tier: idx >= 0 ? prod.tiers[idx] : 'Default', at: prod.at, stockAt: stock && stock.at, items: out };
}

function orderMail(o) {
  return `<p>Order <b>${esc(o.number)}</b>${o.po ? ` · PO ${esc(o.po)}` : ''}</p>
<table width="100%" cellpadding="6" style="border-collapse:collapse;font-size:14px">${o.lines.map((l) =>
    `<tr style="border-bottom:1px solid #eef0f2"><td>${esc(l.code)}${l.backorder ? ' <b style="color:#c26a0a">BACKORDER</b>' : ''}<br><span style="color:#8a9097">${esc(l.name)}</span></td><td align="right" style="padding-left:16px;white-space:nowrap;vertical-align:top">${l.qty} × $${l.price.toFixed(2)}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td align="right"><b>$${o.total.toFixed(2)}</b></td></tr></table>`;
}

const A = {};

// public: product image URLs only (no prices), for the open storefront
A.images = async (req, res) => {
  const prod = await cached('portal/products.json', 30 * 60 * 1000);
  const out = {};
  const hid = await hiddenSet();
  for (const [code, p] of Object.entries((prod && prod.items) || {})) if (!hid.has(code) && p.img && /^https:\/\//.test(p.img)) out[code] = p.img;
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  return res.json(out);
};

// read-only, admins only: the Unleashed product groups (names only) and the portal category each one maps to
A.groups = async (req, res) => {
  const w = await authenticate(req);
  if (!w || !w.admin) return res.status(401).json({ error: 'admins only' });
  const { category } = require('../lib/catalog-map');
  const d = await ul('ProductGroups', '', { timeoutMs: 20000 });
  const items = ((d && d.Items) || []).map((g) => { const c = category(g.GroupName); return { name: g.GroupName, parent: (g.ParentGroup && g.ParentGroup.GroupName) || null, modified: g.LastModifiedOn || null, portal: c ? c[1] : 'hidden' }; });
  return res.json({ count: items.length, items });
};

// configuration check without revealing any value
// "Bought together" map built daily from Unleashed sales history (product codes only).
A.related = async (req, res) => {
  const r = await cached('portal/related.json', 60 * 60 * 1000);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json({ rel: (r && r.rel) || {} });
};
A.health = async (req, res) => {
  let db = 'ok';
  try { if (PS.on()) await dbm.select('sequences', 'select=name&limit=1'); else await readJson(DB); } catch (e) { db = 'error: ' + String(e && (e.name + ' ' + e.message)).slice(0, 160); }
  return res.json({ ok: db === 'ok' }); // no detail on a public endpoint
};

// ---- sign in -------------------------------------------------------------
A.login = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (await limited(req, 'login', 6, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  const u = PS.on() ? (await PS.loadOne(email)).user : (await loadDb()).users[email];
  const ok = isAdmin(email) || (u && u.status === 'approved');
  // Preview only, and only when PORTAL_PREVIEW_LOGIN=1 is set on purpose: sign in without the e-mail step.
  // Off by default because preview URLs are public unless Vercel Deployment Protection is on. Production always e-mails.
  if (ok && process.env.VERCEL_ENV === 'preview' && process.env.PORTAL_PREVIEW_LOGIN === '1') {
    await startSession(req, res, email, u);
    return res.json({ ok: true, direct: true });
  }
  if (ok) {
    const link = base(req) + '/api/portal/verify?t=' + encodeURIComponent(PS.on() ? await SDB.newLink(email) : loginToken(email));
    await send(email, 'Your Maxzz Diesel sign-in link', 'Sign in to the Maxzz B2B portal',
      '<p>Use the button below to sign in. The link works once and expires in 20 minutes.</p><p style="color:#8a9097;font-size:13px">If you did not ask for it, you can ignore this e-mail.</p>',
      { url: link, label: 'Sign in' }, { name: u && u.name, greet: true });
  }
  // same answer either way, so the form does not reveal who has an account
  return res.json({ ok: true, pending: !!(u && u.status === 'pending') });
};

const usedLinks = new Map();
A.verify = async (req, res) => {
  const t = String(req.query.t || '');
  if (PS.on()) {
    // opening the link only checks it; the sign-in itself needs a click (POST), so mail scanners cannot burn it
    const ok = await SDB.peekLink(t).catch(() => null);
    res.statusCode = 302; res.setHeader('Location', ok ? '/portal?lt=' + encodeURIComponent(t) : '/portal?e=link'); return res.end();
  }
  const p = verify(t);
  if (!p || p.k !== 'login' || !p.n || usedLinks.has(p.n)) { res.statusCode = 302; res.setHeader('Location', '/portal?e=link'); return res.end(); }
  // single use across every server instance: the link's nonce is recorded in the private store on first use
  try {
    const used = (await readJson(USED)) || {}, now = Date.now();
    if (used[p.n]) { usedLinks.set(p.n, now); res.statusCode = 302; res.setHeader('Location', '/portal?e=link'); return res.end(); }
    for (const k of Object.keys(used)) if (used[k] < now) delete used[k];
    used[p.n] = p.exp; await writeJson(USED, used);
  } catch (e) { console.error('used-links store', e && e.message); }
  usedLinks.set(p.n, Date.now()); if (usedLinks.size > 2000) usedLinks.clear();
  const db = await loadDb();
  const u = db.users[p.e];
  if (!isAdmin(p.e) && !(u && u.status === 'approved')) { res.statusCode = 302; res.setHeader('Location', '/portal?e=access'); return res.end(); }
  setSession(res, p.e);
  res.statusCode = 302; res.setHeader('Location', '/portal'); return res.end();
};

A.confirm = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req) || !PS.on()) return res.status(405).json({ error: 'method' });
  if (await limited(req, 'confirm', 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const link = await SDB.useLink(clean(readBody(req).t, 100));
  if (!link || link.kind !== 'customer') return res.status(400).json({ error: 'link' });
  const { user, account } = await PS.loadOne(link.email);
  if (!isAdmin(link.email) && !(user && user.status === 'approved' && account && account.status === 'approved')) return res.status(403).json({ error: 'access' });
  await startSession(req, res, link.email, user);
  return res.json({ ok: true });
};
// ---- invitation: the link opens a welcome page; acceptance of the published terms creates the session
A['invite-info'] = async (req, res) => {
  if (!PS.on()) return res.status(404).json({ error: 'off' });
  const l = await SDB.peekLink(clean(req.query.t, 100));
  if (!l || l.kind !== 'invite') return res.status(400).json({ error: 'link' });
  const { user, account } = await PS.loadOne(l.email);
  const t = (await dbm.select('terms_versions', 'select=version,body&status=eq.published&limit=1'))[0];
  if (!user || !account || !t) return res.status(400).json({ error: 'link' });
  return res.json({ company: account.company, name: user.name || '', email: l.email, terms: t });
};
A.accept = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req) || !PS.on()) return res.status(405).json({ error: 'method' });
  if (await limited(req, 'accept', 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const b = readBody(req);
  if (b.agree !== true) return res.status(400).json({ error: 'Please accept the terms to continue.' });
  const tok = clean(b.t, 100), l = await SDB.peekLink(tok);
  if (!l || l.kind !== 'invite') return res.status(400).json({ error: 'link' });
  const t = (await dbm.select('terms_versions', 'select=version&status=eq.published&limit=1'))[0];
  const { user, account } = await PS.loadOne(l.email);
  if (!t || !user || !account) return res.status(400).json({ error: 'link' });
  if (!(await SDB.useLink(tok))) return res.status(400).json({ error: 'link' });
  const now = new Date().toISOString();
  await dbm.update('users', 'id=eq.' + user.id, { status: 'approved', terms_version: t.version, terms_accepted_at: now, name: clean(b.name, 120) || user.name || null });
  await dbm.update('companies', 'id=eq.' + account.id, { status: 'active', approved_by: 'invite', approved_at: now });
  await PS.audit(l.email, 'invite.accept', 'company', account.id, null, { terms: t.version });
  await SDB.create(req, res, 'customer', l.email, user.id);
  return res.json({ ok: true });
};
A.logout = async (req, res) => { if (req.method !== 'POST') return res.status(405).json({ error: 'method' }); if (PS.on()) await SDB.end(req, res, 'customer'); else clearSession(res); return res.json({ ok: true }); };

A.me = async (req, res) => {
  const w = await whoami(req);
  if (!w) return res.status(401).json({ error: 'login' });
  const acc = w.account;
  return res.json({
    email: w.email, admin: w.admin, name: w.user ? w.user.name : '', phone: w.user ? (w.user.phone || '') : '', role: w.user ? w.user.role : 'admin',
    account: acc ? { company: acc.company, customer: acc.customerName || '', code: acc.customerCode || '', status: acc.status, ship: acc.ship || null } : null,
    ordersLive: liveOrders()
  });
};


// A new access request also opens a prospect customer in Unleashed, so approval links to it instead of retyping the company.
// On by default in production; on previews only with ACCESS_TO_UNLEASHED=1 (keeps tests out of the real Unleashed). ACCESS_TO_UNLEASHED=0 turns it off.
const prospectOn = () => configured() && process.env.ACCESS_TO_UNLEASHED !== '0' && (process.env.ACCESS_TO_UNLEASHED === '1' || process.env.VERCEL_ENV === 'production');
const { findCustomerByEmail } = require('../lib/unleashed');
async function createProspect(f) {
  const t = new Date(), code = 'WEB' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const guid = crypto.randomUUID(), parts = f.name.split(/\s+/);
  const where = [f.city, f.state, f.zip, f.country].filter(Boolean).join(', ');
  const body = { Guid: guid, CustomerCode: code, CustomerName: f.company.slice(0, 100), ContactFirstName: parts[0] || '', ContactLastName: parts.slice(1).join(' '),
    Email: f.email, PhoneNumber: f.phone, Notes: ['Website B2B access request, pending approval.', f.type, where, f.notes].filter(Boolean).join(' | ').slice(0, 500) };
  await ul('Customers/' + guid, '', { method: 'POST', body, timeoutMs: 15000 });
  return { code, guid };
}

// ---- access request ------------------------------------------------------
A.request = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const b = readBody(req);
  if (b.hp) return res.json({ ok: true });
  if (await limited(req, 'request', 4, 60 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const f = { name: clean(b.name, 120), company: clean(b.company, 160), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 40),
    country: clean(b.country, 60), state: clean(b.state, 60), city: clean(b.city, 80), zip: clean(b.zip, 12), type: clean(b.type, 80), customerNumber: clean(b.customerNumber, 40), notes: clean(b.notes, 800) };
  if (!f.name || !f.company || !EMAIL.test(f.email) || f.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'missing fields' });
  const prior = PS.on() ? (await PS.loadOne(f.email)).user : (await loadDb()).users[f.email];
  if (prior && prior.status !== 'rejected') return res.json({ ok: true, already: prior.status });
  let prospect = null;
  if (prospectOn() && !f.customerNumber) {
    try {
      try { prospect = await findCustomerByEmail(f.email); } catch (e) { console.error('unleashed email lookup failed', e.message); }
      if (!prospect) prospect = await createProspect(f);
      f.customerNumber = prospect.code;
      f.notes = [(prospect.existing ? 'Existing Unleashed customer found by email: ' + prospect.code + ' (' + prospect.name + ')' : 'Unleashed prospect created by the website: ' + prospect.code), f.notes].filter(Boolean).join(' | ');
    }
    catch (e) { console.error('unleashed prospect', e.message); }
  }
  if (PS.on()) await PS.createRequest(f);
  else {
  const db = await loadDb();
  const accId = id();
  db.accounts[accId] = { id: accId, company: f.company, country: f.country, state: f.state, city: f.city, type: f.type, customerNumber: f.customerNumber, notes: f.notes, status: 'pending', created: Date.now() };
  db.users[f.email] = { email: f.email, name: f.name, phone: f.phone, role: 'owner', account: accId, status: 'pending', created: Date.now() };
  await writeJson(DB, db);
  }
  let cid = null;
  try {
    cid = await upsertContact({ email: f.email, name: f.name, phone: f.phone, company: f.company });
    await addNote(`<p><b>B2B portal access request</b></p><p>${esc(f.company)} · ${esc(f.type)} · ${esc([f.city, f.state, f.zip, f.country].filter(Boolean).join(', '))}${f.customerNumber ? (prospect ? (prospect.existing ? ' · Existing Unleashed customer: ' : ' · Unleashed prospect created: ') : ' · Unleashed customer ') + esc(f.customerNumber) : ''}</p><p>${esc(f.notes)}</p>`, [{ id: cid, type: 202 }]);
    await addTask('Approve B2B portal access: ' + f.company, 'Approve or decline at /portal (Admin).', [{ id: cid, type: 204 }], 4);
  } catch (e) { console.error('hubspot', e.message); }
  await send(f.email, 'We received your Maxzz B2B portal request', 'Request received',
    `<p>Thanks for asking for access to the Maxzz Diesel B2B portal.</p><p>Our team reviews every account to connect it to your price list. You will get an e-mail as soon as it is approved, usually within one business day.</p>`, null, { name: f.name });
  await notifyTeam('New B2B access request: ' + f.company, 'New B2B access request from the website',
    [['Company', f.company], ['Contact', f.name], ['Email', f.email], ['Phone', f.phone], ['Location', [f.type, f.city, f.state, f.country].filter(Boolean).join(' · ')],
      ['Unleashed', f.customerNumber ? (prospect ? (prospect.existing ? 'Existing customer ' : 'Prospect created ') : 'Says customer ') + f.customerNumber : 'Not created'], ['Notes', f.notes]],
    [{ label: 'Approve in the portal', url: base(req) + '/portal#admin' }, { label: 'Open the contact in HubSpot', url: hubContact(cid) }]);
  return res.json({ ok: true });
};

// ---- prices, stock, orders -----------------------------------------------
A.prices = async (req, res) => {
  const w = await whoami(req);
  if (!w) return res.status(401).json({ error: 'login' });
  if (!w.admin && !(w.account && w.account.status === 'approved')) return res.status(403).json({ error: 'pending' });
  const book = await priceBook(w.account, w.admin);
  if (!book) return res.status(503).json({ error: 'catalog syncing' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(book);
};

// price a cart the way the order will, then check a voucher against it (the browser only says which code and which parts)
async function cartSubtotal(w, rawLines) {
  const book = await priceBook(w.account, w.admin); let sub = 0;
  if (!book) return null;
  for (const l of (Array.isArray(rawLines) ? rawLines : []).slice(0, 200)) {
    const p = l && book.items[clean(l.code, 60)]; if (!p || p[0] == null) continue;
    sub += p[0] * Math.min(9999, Math.max(1, parseInt(l.qty, 10) || 0));
  }
  return money(sub);
}
A['voucher-check'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req) || !PS.on()) return res.status(405).json({ error: 'method' });
  const w = await whoami(req);
  if (!w || !w.account || w.account.status !== 'approved') return res.status(w ? 403 : 401).json({ error: 'login' });
  if (await limited(req, 'voucher', 30, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const b = readBody(req), sub = await cartSubtotal(w, b.lines);
  if (sub == null) return res.status(503).json({ error: 'catalog syncing' });
  const r = await vouchers.evaluate(clean(b.code, 40), w.account.id, sub);
  if (!r.ok) return res.status(200).json({ ok: false, error: r.error });
  return res.json({ ok: true, code: r.voucher.code, discount: r.discount, subtotal: sub, total: money(sub - r.discount), description: r.voucher.description || '' });
};
A.orders = async (req, res) => {
  const w = await whoami(req);
  if (!w || !w.account) return res.status(w ? 403 : 401).json({ error: 'login' });
  const list = PS.on() ? await PS.listOrders(w.account.id) : ((await readJson('portal/orders/' + w.account.id + '.json')) || []);
  // refresh status of recent live orders from Unleashed
  if (configured()) {
    let changed = false;
    const todo = list.slice(0, 10).filter((o) => o.guid && !['Completed', 'Deleted'].includes(o.status) && Date.now() - (o.checked || 0) >= 5 * 60 * 1000);
    const budget = new Promise((r) => setTimeout(r, 8000));
    await Promise.race([budget, Promise.all(todo.map(async (o) => {
      try {
        const so = await ul('SalesOrders/' + o.guid, '', { timeoutMs: 8000 });
        const st = so && (so.OrderStatus || (so.Items && so.Items[0] && so.Items[0].OrderStatus));
        if (st && st !== o.status) { o.history = (o.history || []).concat([{ s: st, at: Date.now() }]); o.status = st; }
        if (so && so.OrderNumber) o.unleashedNumber = so.OrderNumber;
        o.checked = Date.now(); changed = true;
        if (PS.on()) await PS.updateOrderStatus(o.id, o.status, o.unleashedNumber).catch((e2) => console.error('order status save', e2.message));
      } catch (e) { console.error('order status', e.message); }
    }))]);
    if (changed && !PS.on()) await writeJson('portal/orders/' + w.account.id + '.json', list).catch(() => {});
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ orders: list });
};

A.quotes = async (req, res) => {
  const w = await whoami(req);
  if (!w) return res.status(401).json({ error: 'login' });
  const key = 'portal/quotes/' + crypto.createHash('sha256').update(w.email).digest('hex').slice(0, 24) + '.json';
  const list = PS.on() ? (w.user ? await PS.listQuotes(w.user.id) : []) : ((await readJson(key)) || []);
  // refresh status of recent quotes that also went to Unleashed
  if (configured()) {
    let changed = false;
    const todo = list.slice(0, 10).filter((q) => q.ulGuid && !['Completed', 'Deleted'].includes(q.ulStatus) && Date.now() - (q.checked || 0) >= 5 * 60 * 1000);
    const budget = new Promise((r) => setTimeout(r, 8000));
    await Promise.race([budget, Promise.all(todo.map(async (q) => {
      try {
        const sq = await ul('SalesQuotes/' + q.ulGuid, '', { timeoutMs: 8000 });
        const st = sq && sq.QuoteStatus;
        if (st && st !== q.ulStatus) { q.history = (q.history || []).concat([{ s: st, at: Date.now() }]); q.ulStatus = st; }
        if (sq && sq.QuoteExpiryDate) q.expires = sq.QuoteExpiryDate;
        q.checked = Date.now(); changed = true;
        if (PS.on()) await PS.updateQuoteStatus(q.id, q.ulStatus || 'Sent').catch((e2) => console.error('quote status save', e2.message));
      } catch (e) { console.error('quote status', e.message); }
    }))]);
    if (changed && !PS.on()) await writeJson(key, list).catch(() => {});
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ quotes: list });
};

A.order = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoami(req);
  if (!w || !w.account || w.account.status !== 'approved') return res.status(w ? 403 : 401).json({ error: 'login' });
  if (await limited(req, 'order', 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const b = readBody(req);
  const book = await priceBook(w.account, w.admin);
  const prod = await cached('portal/products.json', 10 * 60 * 1000);
  const names = {}; const cat = await cached('catalog/live.json', 30 * 60 * 1000);
  (cat || []).forEach((r) => { names[r[0]] = r[1]; });
  const lines = [];
  const key = 'portal/orders/' + w.account.id + '.json';
  const idem = clean(b.idem, 60) || (PS.on() ? crypto.randomUUID() : '');
  if (idem) { const prev = PS.on() ? await PS.findOrderByIdem(w.account.id, idem) : ((await readJson(key)) || []).find((x) => x.idem === idem); if (prev) return res.json({ ok: true, order: prev }); }
  for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)) {
    if (!l || typeof l !== 'object') continue;
    const code = clean(l.code, 60), qty = Math.min(9999, Math.max(1, parseInt(l.qty, 10) || 0));
    const p = book && book.items[code];
    if (!p || p[0] == null) return res.status(400).json({ error: 'Part ' + code + ' has no online price. Remove it from the cart and add it to a quote request instead.', code });
    // nothing is blocked by stock: lines above what is on hand go through as backorder and are flagged for the sales team
    const onHand = p[1];
    lines.push({ code, name: names[code] || code, qty, price: p[0], total: money(p[0] * qty), backorder: onHand != null && qty > onHand, stock: onHand });
  }
  if (!lines.length) return res.status(400).json({ error: 'empty' });
  const s = b.ship || {};
  const ship = { name: clean(s.name, 120) || w.account.company, street: clean(s.street, 160), city: clean(s.city, 80), state: clean(s.state, 60), zip: clean(s.zip, 20), country: clean(s.country, 60) || 'United States', method: clean(s.method, 40), fwd: clean(s.fwd, 160) };
  const pickup = /will call/i.test(ship.method);
  if (!pickup && (!ship.street || !ship.city)) return res.status(400).json({ error: 'Please fill in the street address and city.' });
  if (!pickup && /United States|Puerto Rico|Canada/.test(ship.country) && (!ship.state || !ship.zip)) return res.status(400).json({ error: 'Please fill in the state and ZIP code.' });
  let subtotal = money(lines.reduce((a, l) => a + l.total, 0));
  const gross = subtotal;
  let vch = null, discount = 0;
  if (PS.on() && clean(b.voucher, 40)) {
    const r = await vouchers.evaluate(clean(b.voucher, 40), w.account.id, gross);
    if (!r.ok) return res.status(400).json({ error: r.error, voucher: true });
    vch = r.voucher; discount = r.discount; subtotal = money(gross - discount);
  }
  const t = new Date();
  // database mode: the order id is derived from (company, idempotency key) and is also the Unleashed Sales Order Guid,
  // so a retry after a timeout reuses the same Guid and can never create a second order
  const oid = PS.on() ? PS.orderIdFor(w.account.id, idem) : id();
  const o = { id: oid, number: PS.on() ? await PS.nextNumber('order') : await nextNumber('order'),
    idem, created: Date.now(), by: w.email, po: clean(b.po, 40), notes: clean(b.notes, 800), ship, lines, subtotal, total: subtotal, status: 'Received', live: false, history: [{ s: 'Received', at: Date.now() }] };
  if (vch) { o.voucher = vch.code; o.discount = discount; o.gross = gross; }

  // database mode: the order is on record before Unleashed is called
  if (PS.on()) {
    try { await PS.saveOrder(w.account.id, w.user && w.user.id, o, { tier: w.account.tier, stopCredit: w.account.stopCredit });
      if (vch && !(await vouchers.redeem(vch, w.account.id, o.id, discount))) { await PS.dropOrder(o.id).catch(() => {}); return res.status(400).json({ error: 'This voucher has reached its limit.', voucher: true }); } }
    catch (e) { if (e.status === 409) { const prev = await PS.findOrderByIdem(w.account.id, idem); if (prev) return res.json({ ok: true, order: prev }); } console.error('order save', e.message); return res.status(503).json({ error: 'We could not place the order right now. Please try again in a moment.' }); }
  }
  if (liveOrders() && configured() && w.account.customerCode) {
    const guid = PS.on() ? o.id : crypto.randomUUID();
    const body = {
      Guid: guid, OrderStatus: 'Parked', OrderDate: t.toISOString(), Customer: { CustomerCode: w.account.customerCode },
      CustomerRef: o.po || o.number, Comments: ['Portal B2B ' + o.number, vch ? 'VOUCHER ' + vch.code + ' (-$' + discount.toFixed(2) + ')' : '', lines.some((l) => l.backorder) ? 'BACKORDER: ' + lines.filter((l) => l.backorder).map((l) => l.code + ' (' + l.qty + ' asked, ' + (l.stock || 0) + ' on hand)').join(', ') : '', w.account.stopCredit ? 'CREDIT HOLD: check before releasing' : '', 'By ' + w.email, ship.fwd && ('Forwarder: ' + ship.fwd), o.notes].filter(Boolean).join(' · '),
      DeliveryName: ship.name, DeliveryStreetAddress: ship.street, DeliveryCity: ship.city, DeliveryRegion: ship.state, DeliveryPostCode: ship.zip, DeliveryCountry: ship.country,
      DeliveryMethod: ship.method || undefined, Currency: { CurrencyCode: 'USD' }, ExchangeRate: 1,
      SalesOrderLines: lines.map((l, i) => ({ LineNumber: i + 1, Product: { ProductCode: l.code, Guid: prod && prod.items[l.code] ? prod.items[l.code].g : undefined }, OrderQuantity: l.qty, UnitPrice: l.price, DiscountRate: vch ? money(discount / gross * 1e4) / 1e4 : undefined, LineTotal: vch ? money(l.total * (1 - discount / gross)) : l.total, LineTax: 0 })),
      SubTotal: subtotal, TaxRate: 0, TaxTotal: 0, Total: subtotal
    };
    try {
      const so = await ul('SalesOrders/' + guid, '', { method: 'POST', body, timeoutMs: 45000 });
      o.guid = guid; o.live = true; o.unleashedNumber = so && so.OrderNumber; o.status = 'Parked';
      if (o.unleashedNumber) { o.storeNumber = o.number; o.number = o.unleashedNumber; } // the Unleashed number becomes the locator
      if (PS.on()) await PS.orderLive(o.id, o.unleashedNumber, 'Parked').catch((e2) => console.error('order live save', e2.message));
    } catch (e) {
      console.error('sales order failed', e.message);
      if (admins().length) send(admins(), 'ALERT: portal order failed ' + o.number + ' · ' + w.account.company, 'Order could not reach Unleashed', `<p><b>${esc(w.account.company)}</b> · ${esc(w.email)} · total $${o.total.toFixed(2)}</p><p>Unleashed said: ${esc(String(e.message).slice(0, 200))}</p><p>The customer was told to try again. Nothing was created in Unleashed unless it answered after the timeout; a retry reuses the same order id.</p>`, null, { internal: true }).catch(() => {});
      if (PS.on()) await PS.dropOrder(o.id).catch(() => {}); // not sent: the retry uses the same Guid
      return res.status(502).json({ error: 'We could not place the order right now. Your cart is saved; please try again or call us.' });
    }
  }
  // once Unleashed has the order, the customer must get a success answer even if saving or e-mail fails
  if (!PS.on()) try { const list = (await readJson(key)) || []; list.unshift(o); await writeJson(key, list.slice(0, 500)); } catch (e) { console.error('order save', e.message); }
  try {
  await send(w.email, 'Order received ' + o.number, 'We received your order',
    `<p>Thanks. Our sales team reviews every order and you will get an e-mail when it is approved, with confirmed quantities and ship date.</p>${orderMail(o)}`,
    { url: base(req) + '/portal#orders', label: 'Track your order' }, { name: w.user && w.user.name, greet: true });
  const orderTo = Array.from(new Set((process.env.VERCEL_ENV === 'production' ? String(process.env.TEAM_NOTIFY || 'admin@maxzzdiesel.com,michael@maxzzdiesel.com').toLowerCase().split(/[,\s]+/).filter(Boolean) : []).concat(admins())));
  if (orderTo.length) await send(orderTo, 'Portal order ' + o.number + ' · ' + w.account.company, 'New portal order',
    `<p><b>${esc(w.account.company)}</b> (${esc(w.account.customerCode || 'no Unleashed code')}) · ${esc(w.email)}</p>${w.account.stopCredit ? '<p><b>Credit hold:</b> this customer is on stop credit in Unleashed. Check payment before releasing.</p>' : ''}${o.live ? '<p>Created in Unleashed as Parked.</p>' : '<p><b>Test mode:</b> not sent to Unleashed (PORTAL_ORDERS_LIVE is off).</p>'}${orderMail(o)}`, null, { internal: true });
  } catch (e) { console.error('order mail', e.message); }
  return res.json({ ok: true, order: o });
};

// ---- admin (Michael, Leise) ----------------------------------------------
async function adminOnly(req, res) {
  const w = await whoami(req);
  if (!w || !w.admin) { res.status(w ? 403 : 401).json({ error: 'admin' }); return null; }
  if (!w.db) w.db = await loadDb();
  return w;
}
A['admin-list'] = async (req, res) => {
  const w = await adminOnly(req, res); if (!w) return;
  const users = Object.values(w.db.users);
  const accounts = Object.values(w.db.accounts).map((a) => Object.assign({}, a, { users: users.filter((u) => u.account === a.id).map((u) => ({ email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status })) }));
  accounts.sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || b.created - a.created);
  res.setHeader('Cache-Control', 'private, no-store');
  const prod = await cached('portal/products.json', 10 * 60 * 1000);
  const stock = await cached('portal/stock.json', 10 * 60 * 1000);
  return res.json({ accounts, sync: { tiers: prod ? prod.tiers : null, products: prod ? Object.keys(prod.items || {}).length : 0, pricesAt: prod && prod.at, stockAt: stock && stock.at, ordersLive: liveOrders(), mail: !!process.env.RESEND_API_KEY } });
};
A['admin-lookup'] = async (req, res) => {
  const w = await adminOnly(req, res); if (!w) return;
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const code = clean(req.query.code, 40);
  if (!code) return res.status(400).json({ error: 'code' });
  const q = /^[A-Za-z0-9._ -]+$/.test(code) ? 'customerCode=' + encodeURIComponent(code) : 'customer=' + encodeURIComponent(code);
  const data = await ul('Customers', q + '&pageSize=10', { timeoutMs: 30000 });
  return res.json({ customers: (data.Items || []).slice(0, 10).map((c) => ({ code: c.CustomerCode, name: c.CustomerName, tier: c.SellPriceTier || '', guid: c.Guid, stopCredit: !!c.StopCredit, terms: c.PaymentTerm || '' })) });
};
A['admin-approve'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await adminOnly(req, res); if (!w) return;
  const b = readBody(req);
  const acc = w.db.accounts[clean(b.account, 40)];
  if (!acc) return res.status(404).json({ error: 'account' });
  const c = b.customer || {};
  if (!c.code || !c.guid) return res.status(400).json({ error: 'pick the Unleashed customer first' });
  // read the customer from Unleashed itself; the browser only says which one
  let cust = null;
  if (configured()) {
    const guid = clean(c.guid, 60);
    if (!/^[0-9a-f-]{36}$/i.test(guid)) return res.status(400).json({ error: 'customer' });
    const data = await ul('Customers/' + guid, '', { timeoutMs: 30000 });
    cust = data && (data.Items ? data.Items[0] : data);
    if (!cust || !cust.CustomerCode) return res.status(404).json({ error: 'Unleashed customer not found' });
  }
  const code = cust ? cust.CustomerCode : clean(c.code, 40);
  const other = Object.values(w.db.accounts).find((a) => a.id !== acc.id && a.status === 'approved' && a.customerCode === code);
  if (other && !b.force) return res.status(409).json({ error: 'Customer ' + code + ' is already linked to ' + other.company + '. Check before linking it again.' });
  Object.assign(acc, { status: 'approved', customerCode: code, customerGuid: cust ? cust.Guid : clean(c.guid, 60), customerName: cust ? cust.CustomerName : clean(c.name, 160), tier: cust ? (cust.SellPriceTier || '') : clean(c.tier, 60),
    terms: cust ? (cust.PaymentTerm || '') : '', stopCredit: cust ? !!cust.StopCredit : false, approvedBy: w.email, approvedAt: Date.now() });
  const people = Object.values(w.db.users).filter((u) => u.account === acc.id);
  people.forEach((u) => { if (u.status === 'pending' || u.status === 'rejected') u.status = 'approved'; });
  if (PS.on()) {
    try { await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, ['pending', 'rejected'], 'approved'); }
    catch (e) { console.error('approve save', e.message); return res.status(409).json({ error: 'Could not save: customer ' + code + ' may already be linked to another company.' }); }
    await PS.audit(w.email, 'company.approve', 'company', acc.id, null, { code, tier: acc.tier });
  } else await writeJson(DB, w.db);
  for (const u of people) await send(u.email, 'Your Maxzz B2B portal access is ready', 'Welcome to the Maxzz B2B portal',
    `<p>Your account for <b>${esc(acc.company)}</b> is approved. You can now see your prices and stock, place orders and track them.</p>`,
    { url: base(req) + '/portal', label: 'Open the portal' }, { name: u.name, greet: true });
  return res.json({ ok: true });
};
// Admin: ends every open session of one person (or all people of a company) at once; they sign in again by e-mail link.
A['admin-revoke'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await adminOnly(req, res); if (!w) return;
  const b = readBody(req);
  const email = clean(b.email, 160).toLowerCase(), now = Date.now();
  if (PS.on()) { await SDB.revokeEmail(email, w.email); await PS.audit(w.email, 'session.revoke', 'user', email); return res.json({ ok: true }); }
  const u = w.db.users[email];
  if (u) u.revokedBefore = now;
  else { w.db.revokedBefore = w.db.revokedBefore || {}; w.db.revokedBefore[email] = now; }
  await writeJson(DB, w.db);
  return res.json({ ok: true });
};
A['admin-reject'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await adminOnly(req, res); if (!w) return;
  const b = readBody(req);
  const acc = w.db.accounts[clean(b.account, 40)];
  if (!acc) return res.status(404).json({ error: 'account' });
  acc.status = 'rejected'; acc.rejectedBy = w.email; acc.reason = clean(b.reason, 400);
  const people = Object.values(w.db.users).filter((u) => u.account === acc.id);
  people.forEach((u) => { u.status = 'rejected'; u.revokedBefore = Date.now(); });
  if (PS.on()) {
    await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, null, 'rejected');
    for (const u of people) await SDB.revokeEmail(u.email, w.email).catch(() => {});
    await PS.audit(w.email, 'company.reject', 'company', acc.id, null, { reason: acc.reason });
  } else await writeJson(DB, w.db);
  if (b.notify) for (const u of people) await send(u.email, 'About your Maxzz B2B portal request', 'About your request',
    `<p>We could not open a portal account for ${esc(acc.company)} at this time.${acc.reason ? ' ' + esc(acc.reason) : ''}</p><p>You can still request quotes at maxzzdiesel.com/quote or reply to this e-mail.</p>`, null, { name: u.name, greet: true });
  return res.json({ ok: true });
};

// Admin: makes sure the generic "Website quotes" customer exists in Unleashed (website quotes are filed under it
// as Draft sales quotes). POST only; creates it once, never edits or deletes anything.
A['admin-web-customer'] = async (req, res) => {
  const w = await adminOnly(req, res); if (!w) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!configured()) return res.status(503).json({ error: 'unleashed not configured' });
  const code = 'WEBQUOTE';
  const found = await ul('Customers', 'customerCode=' + code);
  const hit = found && (found.Items || []).find((c) => String(c.CustomerCode).toUpperCase() === code);
  if (hit) return res.json({ ok: true, existed: true, code: hit.CustomerCode, name: hit.CustomerName });
  const guid = crypto.randomUUID();
  const r = await ul('Customers/' + guid, '', { method: 'POST', body: { Guid: guid, CustomerCode: code, CustomerName: 'Website quotes', Currency: { CurrencyCode: 'USD' }, Notes: 'Generic customer for quote requests sent from maxzzdiesel.com. Move each quote to the real customer before converting it to an order.' } });
  return res.json({ ok: true, created: true, code: (r && r.CustomerCode) || code });
};
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const fn = A[String(req.query.a || '')];
  if (!fn) return res.status(404).json({ error: 'not found' });
  try { return await fn(req, res); }
  catch (e) { console.error('portal', req.query.a, e.message); return res.status(500).json({ error: 'server' }); }
};
