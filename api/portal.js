// B2B portal API: /api/portal?a=<action> (rewritten from /api/portal/<action>).
// Unleashed stays the source of truth for customers, prices, stock and orders. This function only:
//  - signs people in with an e-mailed link (no passwords),
//  - keeps the portal's own list of users and access requests (private blob portal/db.json),
//  - shows each approved customer the prices of their own Unleashed sell price tier and available stock,
//  - turns a cart into a Sales Order in Unleashed (status Parked, for the sales team to review).
// Costs never leave the server; nothing here reads cost fields.
const crypto = require('crypto');
const { readJson, writeJson, cached } = require('../lib/store');
const { ul, configured } = require('../lib/unleashed');
const { loginToken, verify, setSession, clearSession, sessionEmail } = require('../lib/session');
const { send, esc } = require('../lib/mail');
const { upsertContact, addNote, addTask } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');

const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const DB = 'portal/db.json';
const hits = new Map();

const admins = () => String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
const isAdmin = (email) => !!email && admins().includes(email);
const liveOrders = () => process.env.PORTAL_ORDERS_LIVE === '1';
const base = (req) => 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);

function limited(req, key, max, windowMs) {
  const k = key + '|' + String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), now = Date.now();
  const list = (hits.get(k) || []).filter((x) => now - x < windowMs);
  if (list.length >= max) return true;
  list.push(now); hits.set(k, list); if (hits.size > 5000) hits.clear();
  return false;
}
function originOk(req) { const o = req.headers.origin || ''; return !o || ALLOWED.some((re) => re.test(o)); }
async function loadDb() { return (await readJson(DB)) || { users: {}, accounts: {} }; }
const money = (n) => Math.round(n * 100) / 100;
const id = () => crypto.randomBytes(8).toString('hex');

async function whoami(req) {
  const email = sessionEmail(req);
  if (!email) return null;
  const db = await loadDb();
  const u = db.users[email];
  const admin = isAdmin(email);
  if (!u && !admin) return null;
  const acc = u && u.account ? db.accounts[u.account] : null;
  return { email, admin, user: u || null, account: acc || null, db };
}

// prices for one account: its Unleashed tier, or the default sell price
async function priceBook(account) {
  const prod = await cached('portal/products.json', 10 * 60 * 1000);
  const stock = await cached('portal/stock.json', 10 * 60 * 1000);
  if (!prod) return null;
  const idx = account && account.tier ? (prod.tiers || []).findIndex((t) => String(t).toLowerCase() === String(account.tier).toLowerCase()) : -1;
  const out = {};
  for (const [code, p] of Object.entries(prod.items || {})) {
    let price = idx >= 0 ? p.t[idx] : null;
    if (price == null) price = p.d;
    out[code] = [price == null ? null : money(price), stock && stock.qty ? (stock.qty[code] ?? 0) : null, p.img || null];
  }
  return { tier: idx >= 0 ? prod.tiers[idx] : 'Default', at: prod.at, stockAt: stock && stock.at, items: out };
}

function orderMail(o) {
  return `<p>Order <b>${esc(o.number)}</b>${o.po ? ` · PO ${esc(o.po)}` : ''}</p>
<table width="100%" cellpadding="6" style="border-collapse:collapse;font-size:14px">${o.lines.map((l) =>
    `<tr style="border-bottom:1px solid #eef0f2"><td>${esc(l.code)}<br><span style="color:#8a9097">${esc(l.name)}</span></td><td align="right">${l.qty} × $${l.price.toFixed(2)}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td align="right"><b>$${o.total.toFixed(2)}</b></td></tr></table>`;
}

const A = {};

// ---- sign in -------------------------------------------------------------
A.login = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (limited(req, 'login', 6, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  const db = await loadDb();
  const u = db.users[email];
  const ok = isAdmin(email) || (u && u.status === 'approved');
  if (ok) {
    const link = base(req) + '/api/portal/verify?t=' + encodeURIComponent(loginToken(email));
    await send(email, 'Your Maxzz Diesel sign-in link', 'Sign in to the Maxzz B2B portal',
      '<p>Use the button below to sign in. The link works once and expires in 20 minutes.</p><p style="color:#8a9097;font-size:13px">If you did not ask for it, you can ignore this e-mail.</p>',
      { url: link, label: 'Sign in' });
  }
  // same answer either way, so the form does not reveal who has an account
  return res.json({ ok: true, pending: !!(u && u.status === 'pending') });
};

A.verify = async (req, res) => {
  const p = verify(String(req.query.t || ''));
  if (!p || p.k !== 'login') { res.statusCode = 302; res.setHeader('Location', '/portal?e=link'); return res.end(); }
  const db = await loadDb();
  const u = db.users[p.e];
  if (!isAdmin(p.e) && !(u && u.status === 'approved')) { res.statusCode = 302; res.setHeader('Location', '/portal?e=access'); return res.end(); }
  if (u) { u.lastLogin = Date.now(); await writeJson(DB, db).catch(() => {}); }
  setSession(res, p.e);
  res.statusCode = 302; res.setHeader('Location', '/portal'); return res.end();
};

A.logout = async (req, res) => { clearSession(res); return res.json({ ok: true }); };

A.me = async (req, res) => {
  const w = await whoami(req);
  if (!w) return res.status(401).json({ error: 'login' });
  const acc = w.account;
  return res.json({
    email: w.email, admin: w.admin, name: w.user ? w.user.name : '', role: w.user ? w.user.role : 'admin',
    account: acc ? { company: acc.company, customer: acc.customerName || '', code: acc.customerCode || '', status: acc.status, ship: acc.ship || null } : null,
    ordersLive: liveOrders()
  });
};

// ---- access request ------------------------------------------------------
A.request = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const b = readBody(req);
  if (b.hp) return res.json({ ok: true });
  if (limited(req, 'request', 4, 60 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const f = { name: clean(b.name, 120), company: clean(b.company, 160), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 40),
    country: clean(b.country, 60), state: clean(b.state, 60), city: clean(b.city, 80), type: clean(b.type, 80), customerNumber: clean(b.customerNumber, 40), notes: clean(b.notes, 800) };
  if (!f.name || !f.company || !EMAIL.test(f.email) || f.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'missing fields' });
  const db = await loadDb();
  if (db.users[f.email] && db.users[f.email].status !== 'rejected') return res.json({ ok: true, already: db.users[f.email].status });
  const accId = id();
  db.accounts[accId] = { id: accId, company: f.company, country: f.country, state: f.state, city: f.city, type: f.type, customerNumber: f.customerNumber, notes: f.notes, status: 'pending', created: Date.now() };
  db.users[f.email] = { email: f.email, name: f.name, phone: f.phone, role: 'owner', account: accId, status: 'pending', created: Date.now() };
  await writeJson(DB, db);
  try {
    const cid = await upsertContact({ email: f.email, name: f.name, phone: f.phone, company: f.company });
    await addNote(`<p><b>B2B portal access request</b></p><p>${esc(f.company)} · ${esc(f.type)} · ${esc([f.city, f.state, f.country].filter(Boolean).join(', '))}${f.customerNumber ? ' · Unleashed customer ' + esc(f.customerNumber) : ''}</p><p>${esc(f.notes)}</p>`, [{ id: cid, type: 202 }]);
    await addTask('Approve B2B portal access: ' + f.company, 'Approve or decline at /portal (Admin).', [{ id: cid, type: 204 }], 4);
  } catch (e) { console.error('hubspot', e.message); }
  await send(f.email, 'We received your Maxzz B2B portal request', 'Request received',
    `<p>Hi ${esc(f.name.split(' ')[0])}, thanks for asking for access to the Maxzz Diesel B2B portal.</p><p>Our team reviews every account to connect it to your price list. You will get an e-mail as soon as it is approved, usually within one business day.</p>`);
  if (admins().length) await send(admins(), 'New B2B portal request: ' + f.company, 'New access request',
    `<p><b>${esc(f.company)}</b> · ${esc(f.name)} · ${esc(f.email)} · ${esc(f.phone)}</p><p>${esc([f.type, f.city, f.state, f.country].filter(Boolean).join(' · '))}</p>${f.customerNumber ? `<p>Says Unleashed customer: ${esc(f.customerNumber)}</p>` : ''}`,
    { url: base(req) + '/portal#admin', label: 'Review in the portal' });
  return res.json({ ok: true });
};

// ---- prices, stock, orders -----------------------------------------------
A.prices = async (req, res) => {
  const w = await whoami(req);
  if (!w) return res.status(401).json({ error: 'login' });
  if (!w.admin && !(w.account && w.account.status === 'approved')) return res.status(403).json({ error: 'pending' });
  const book = await priceBook(w.account);
  if (!book) return res.status(503).json({ error: 'catalog syncing' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json(book);
};

A.orders = async (req, res) => {
  const w = await whoami(req);
  if (!w || !w.account) return res.status(w ? 403 : 401).json({ error: 'login' });
  const list = (await readJson('portal/orders/' + w.account.id + '.json')) || [];
  // refresh status of recent live orders from Unleashed
  if (configured()) {
    let changed = false;
    for (const o of list.slice(0, 10)) {
      if (!o.guid || ['Completed', 'Deleted'].includes(o.status) || Date.now() - (o.checked || 0) < 5 * 60 * 1000) continue;
      try {
        const so = await ul('SalesOrders/' + o.guid, '', { timeoutMs: 15000 });
        const st = so && (so.OrderStatus || (so.Items && so.Items[0] && so.Items[0].OrderStatus));
        if (st && st !== o.status) { o.history = (o.history || []).concat([{ s: st, at: Date.now() }]); o.status = st; }
        if (so && so.OrderNumber) o.unleashedNumber = so.OrderNumber;
        o.checked = Date.now(); changed = true;
      } catch (e) { console.error('order status', e.message); }
    }
    if (changed) await writeJson('portal/orders/' + w.account.id + '.json', list).catch(() => {});
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ orders: list });
};

A.order = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoami(req);
  if (!w || !w.account || w.account.status !== 'approved') return res.status(w ? 403 : 401).json({ error: 'login' });
  if (limited(req, 'order', 10, 60 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const b = readBody(req);
  const book = await priceBook(w.account);
  const prod = await cached('portal/products.json', 10 * 60 * 1000);
  const names = {}; const cat = await cached('catalog/live.json', 30 * 60 * 1000);
  (cat || []).forEach((r) => { names[r[0]] = r[1]; });
  const lines = [];
  for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)) {
    const code = clean(l.code, 60), qty = Math.min(9999, Math.max(1, parseInt(l.qty, 10) || 0));
    const p = book && book.items[code];
    if (!p || p[0] == null) return res.status(400).json({ error: 'unknown part ' + code });
    lines.push({ code, name: names[code] || code, qty, price: p[0], total: money(p[0] * qty) });
  }
  if (!lines.length) return res.status(400).json({ error: 'empty' });
  const s = b.ship || {};
  const ship = { name: clean(s.name, 120) || w.account.company, street: clean(s.street, 160), city: clean(s.city, 80), state: clean(s.state, 60), zip: clean(s.zip, 20), country: clean(s.country, 60) || 'United States', method: clean(s.method, 40) };
  if (!ship.street || !ship.city) return res.status(400).json({ error: 'address' });
  const subtotal = money(lines.reduce((a, l) => a + l.total, 0));
  const t = new Date();
  const o = { id: id(), number: 'WEB-' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
    created: Date.now(), by: w.email, po: clean(b.po, 40), notes: clean(b.notes, 800), ship, lines, subtotal, total: subtotal, status: 'Received', live: false, history: [{ s: 'Received', at: Date.now() }] };

  if (liveOrders() && configured() && w.account.customerCode) {
    const guid = crypto.randomUUID();
    const body = {
      Guid: guid, OrderStatus: 'Parked', OrderDate: t.toISOString(), Customer: { CustomerCode: w.account.customerCode },
      CustomerRef: o.po || o.number, Comments: ['Portal B2B ' + o.number, 'By ' + w.email, o.notes].filter(Boolean).join(' · '),
      DeliveryName: ship.name, DeliveryStreetAddress: ship.street, DeliveryCity: ship.city, DeliveryRegion: ship.state, DeliveryPostCode: ship.zip, DeliveryCountry: ship.country,
      DeliveryMethod: ship.method || undefined, Currency: { CurrencyCode: 'USD' }, ExchangeRate: 1,
      SalesOrderLines: lines.map((l, i) => ({ LineNumber: i + 1, Product: { ProductCode: l.code, Guid: prod && prod.items[l.code] ? prod.items[l.code].g : undefined }, OrderQuantity: l.qty, UnitPrice: l.price, LineTotal: l.total, LineTax: 0 })),
      SubTotal: subtotal, TaxRate: 0, TaxTotal: 0, Total: subtotal
    };
    try {
      const so = await ul('SalesOrders/' + guid, '', { method: 'POST', body, timeoutMs: 45000 });
      o.guid = guid; o.live = true; o.unleashedNumber = so && so.OrderNumber; o.status = 'Parked';
    } catch (e) {
      console.error('sales order failed', e.message);
      return res.status(502).json({ error: 'We could not place the order right now. Your cart is saved; please try again or call us.' });
    }
  }
  const key = 'portal/orders/' + w.account.id + '.json';
  const list = (await readJson(key)) || [];
  list.unshift(o); await writeJson(key, list.slice(0, 500));
  await send(w.email, 'Order received ' + o.number, 'We received your order',
    `<p>Thanks. Our sales team reviews every order and you will get an e-mail when it is approved, with confirmed quantities and ship date.</p>${orderMail(o)}`,
    { url: base(req) + '/portal#orders', label: 'Track your order' });
  if (admins().length) await send(admins(), 'Portal order ' + o.number + ' · ' + w.account.company, 'New portal order',
    `<p><b>${esc(w.account.company)}</b> (${esc(w.account.customerCode || 'no Unleashed code')}) · ${esc(w.email)}</p>${o.live ? '<p>Created in Unleashed as Parked.</p>' : '<p><b>Test mode:</b> not sent to Unleashed (PORTAL_ORDERS_LIVE is off).</p>'}${orderMail(o)}`);
  return res.json({ ok: true, order: o });
};

// ---- admin (Michael, Leise) ----------------------------------------------
async function adminOnly(req, res) {
  const w = await whoami(req);
  if (!w || !w.admin) { res.status(w ? 403 : 401).json({ error: 'admin' }); return null; }
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
  Object.assign(acc, { status: 'approved', customerCode: clean(c.code, 40), customerGuid: clean(c.guid, 60), customerName: clean(c.name, 160), tier: clean(c.tier, 60), approvedBy: w.email, approvedAt: Date.now() });
  const people = Object.values(w.db.users).filter((u) => u.account === acc.id);
  people.forEach((u) => { if (u.status === 'pending') u.status = 'approved'; });
  await writeJson(DB, w.db);
  for (const u of people) await send(u.email, 'Your Maxzz B2B portal access is ready', 'Welcome to the Maxzz B2B portal',
    `<p>Hi ${esc(String(u.name || '').split(' ')[0])}, your account for <b>${esc(acc.company)}</b> is approved. You can now see your prices and stock, place orders and track them.</p>`,
    { url: base(req) + '/portal', label: 'Open the portal' });
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
  people.forEach((u) => { u.status = 'rejected'; });
  await writeJson(DB, w.db);
  if (b.notify) for (const u of people) await send(u.email, 'About your Maxzz B2B portal request', 'About your request',
    `<p>Hi ${esc(String(u.name || '').split(' ')[0])}, we could not open a portal account for ${esc(acc.company)} at this time.${acc.reason ? ' ' + esc(acc.reason) : ''}</p><p>You can still request quotes at maxzzdiesel.com/quote or reply to this e-mail.</p>`);
  return res.json({ ok: true });
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const fn = A[String(req.query.a || '')];
  if (!fn) return res.status(404).json({ error: 'not found' });
  try { return await fn(req, res); }
  catch (e) { console.error('portal', req.query.a, e.message); return res.status(500).json({ error: 'server' }); }
};
