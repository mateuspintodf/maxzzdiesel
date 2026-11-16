// Runs the database-mode portal against an in-memory fake of PostgREST. No network, no packages.
// node tests/portal-db.test.js
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const stub = (rel, exp) => { const f = require.resolve(path.join(root, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
const sent = [];
stub('lib/store', { readJson: async () => null, writeJson: async () => {}, cached: async (k) => (global.__cache ? global.__cache(k) : null), nextNumber: async () => 'X-1' });
stub('lib/mail', { send: async (to, subj, h, body, cta) => { sent.push({ to, subj, cta }); }, esc: (s) => String(s) });
stub('lib/hubspot', { upsertContact: async () => 1, addNote: async () => {}, addTask: async () => {}, hs: async () => ({}), OWNER: () => '1', esc: (s) => s });
let ulCalls = []; let ulFail = false;
stub('lib/unleashed', { configured: () => true, ul: async (p, q, o) => { ulCalls.push({ p, o }); if (ulFail && o && o.method === 'POST') throw new Error('timeout');
  if (/^Customers\//.test(p)) return { CustomerCode: 'C1', CustomerName: 'Cust One', Guid: p.split('/')[1], SellPriceTier: 'Tier 1', StopCredit: false, PaymentTerm: 'Net30' };
  if (/^SalesOrders\//.test(p)) return { OrderNumber: 'SO-000123', OrderStatus: 'Parked' }; return {}; } });
stub('lib/unleashed-quote', { createSalesQuote: async () => ({ ok: false, skipped: true }) });
stub('lib/guard', { guard: () => null });

// ---- fake PostgREST
const T = {}; const uuid = () => require('crypto').randomUUID();
const tbl = (n) => (T[n] = T[n] || []);
const seqs = { MXO: 10000, MXQ: 10006 };
const unique = { companies: ['unleashed_code'], users: ['email'], orders: ['number'], sessions: ['token_hash'], login_links: ['nonce'], quotes: ['number'], vouchers: ['code'] };
function match(row, qs) {
  for (const [k, v] of new URLSearchParams(qs)) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const val = row[k]; const [op, ...r] = v.split('.'); const arg = r.join('.');
    if (op === 'eq' && String(val).toLowerCase() !== String(arg).toLowerCase()) return false;
    if (op === 'is' && !((arg === 'null') === (val == null))) return false;
    if (op === 'gt' && !(String(val) > arg)) return false;
    if (op === 'gte' && !(String(val) >= arg)) return false;
    if (op === 'in' && !arg.replace(/^\(|\)$/g, '').replace(/"/g, '').split(',').includes(String(val))) return false;
  }
  return true;
}
global.fetch = async (url, o) => {
  const u = new URL(url), p = u.pathname.replace('/rest/v1/', ''), qs = u.search.slice(1), m = o.method, body = o.body ? JSON.parse(o.body) : null;
  const ok = (d, s) => ({ ok: true, status: s || 200, text: async () => JSON.stringify(d) });
  const bad = (s, msg) => ({ ok: false, status: s, text: async () => JSON.stringify({ message: msg, code: '23505' }) });
  if (p === 'rpc/next_number') return ok(++seqs[body.seq]);
  const rows = tbl(p);
  if (m === 'GET') { let r = rows.filter((x) => match(x, qs)); const ord = new URLSearchParams(qs).get('order'); if (ord) { const [f, d] = ord.split('.'); r = r.slice().sort((a, b) => (String(a[f]) < String(b[f]) ? -1 : 1) * (d === 'desc' ? -1 : 1)); } const l = new URLSearchParams(qs).get('limit'); return ok(l ? r.slice(0, +l) : r); }
  if (m === 'POST') {
    const out = [];
    for (const row of body) {
      const oc = new URLSearchParams(qs).get('on_conflict');
      const keys = oc ? [oc] : (unique[p] || []);
      const dup = rows.find((x) => keys.some((k) => x[k] != null && String(x[k]).toLowerCase() === String(row[k]).toLowerCase()));
      if (dup && oc) { Object.assign(dup, row); out.push(dup); continue; }
      if (dup) return bad(409, 'duplicate key ' + p);
      if (p === 'orders') { const d2 = rows.find((x) => x.company_id === row.company_id && x.idem_key === row.idem_key); if (d2) return bad(409, 'dup idem'); }
      const n = Object.assign({ id: uuid(), created_at: new Date().toISOString(), at: new Date().toISOString(), last_seen_at: new Date().toISOString() }, row); rows.push(n); out.push(n);
    }
    return ok(out, 201);
  }
  if (m === 'PATCH') { const r = rows.filter((x) => match(x, qs)); r.forEach((x) => Object.assign(x, body)); return ok(r); }
  if (m === 'DELETE') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], qs)) rows.splice(i, 1); return ok(null); }
};
process.env.SUPABASE_URL = 'http://fake'; process.env.SUPABASE_SERVICE_KEY = 'k'; process.env.PORTAL_DB = '1'; process.env.PORTAL_ADMINS = 'boss@maxzz.com';
process.env.PORTAL_ORDERS_LIVE = '1'; process.env.PORTAL_SECRET = 'x'.repeat(40); process.env.VERCEL_ENV = 'production';

const portal = require(path.join(root, 'api/portal.js'));
const admin = require(path.join(root, 'api/admin.js'));
function call(h, a, { method = 'GET', body, cookie, query = {} } = {}) {
  return new Promise((resolve) => {
    const headers = {}; const req = { method, query: Object.assign({ a }, query), headers: { cookie: cookie || '', origin: 'https://www.maxzzdiesel.com', 'x-forwarded-for': '1.2.3.4', host: 'x' }, body };
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { resolve({ s: this.statusCode, d, headers }); }, end() { resolve({ s: this.statusCode, d: null, headers }); } };
    h(req, res);
  });
}
const ck = (r) => String(r.headers['Set-Cookie'] || '').split(';')[0];

(async () => {
  // 1. access request creates company + user + request
  let r = await call(portal, 'request', { method: 'POST', body: { name: 'Ann', company: 'ACME Diesel', email: 'ann@acme.com', phone: '9545550123', country: 'United States' } });
  assert.equal(r.d.ok, true); assert.equal(T.companies.length, 1); assert.equal(T.users[0].status, 'pending'); assert.equal(T.access_requests.length, 1);
  // pending user cannot get a link (no mail), same answer
  sent.length = 0; r = await call(portal, 'login', { method: 'POST', body: { email: 'ann@acme.com' } }); assert.equal(r.d.pending, true); assert.equal(sent.length, 0);
  // 2. admin signs in through the admin API (env bootstrap), link needs a confirm POST
  r = await call(admin, 'login', { method: 'POST', body: { email: 'boss@maxzz.com' } }); assert.equal(r.s, 200);
  const alink = decodeURIComponent(sent.pop().cta.url.split('lt=')[1]);
  r = await call(admin, 'confirm', { method: 'POST', body: { t: 'wrong' } }); assert.equal(r.s, 400);
  r = await call(admin, 'confirm', { method: 'POST', body: { t: alink } }); assert.equal(r.s, 200); const acookie = ck(r); assert.ok(acookie.startsWith('mx_admin=db.'));
  r = await call(admin, 'confirm', { method: 'POST', body: { t: alink } }); assert.equal(r.s, 400, 'link is single use');
  assert.ok(!JSON.stringify(T.sessions).includes(acookie.split('=')[1].slice(3)), 'raw token never stored');
  // customer cookie cannot open admin, and a non admin cannot sign in to admin
  r = await call(admin, 'list', { cookie: 'mx_portal=db.abc' }); assert.equal(r.s, 401);
  sent.length = 0; await call(admin, 'login', { method: 'POST', body: { email: 'ann@acme.com' } }); assert.equal(sent.length, 0);
  // 3. admin approves
  r = await call(admin, 'list', { cookie: acookie }); const acc = r.d.accounts[0]; assert.equal(acc.status, 'pending'); assert.equal(acc.users[0].email, 'ann@acme.com');
  const guid = '11111111-1111-4111-8111-111111111111';
  r = await call(admin, 'approve', { method: 'POST', cookie: acookie, body: { account: acc.id, customer: { code: 'C1', guid } } }); assert.equal(r.d.ok, true, JSON.stringify(r.d));
  assert.equal(T.companies[0].status, 'active'); assert.equal(T.companies[0].tier, 'Tier 1'); assert.equal(T.users[0].status, 'approved'); assert.ok(T.audit_log.length >= 2);
  // 4. customer signs in: link opens a confirm step, mail scanner GET does not burn it
  sent.length = 0; await call(portal, 'login', { method: 'POST', body: { email: 'ann@acme.com' } });
  const t = decodeURIComponent(sent.pop().cta.url.split('t=')[1]);
  r = await call(portal, 'verify', { query: { t } }); assert.ok(String(r.headers.Location).includes('lt=')); r = await call(portal, 'verify', { query: { t } }); assert.ok(String(r.headers.Location).includes('lt='), 'GET twice still fine');
  r = await call(portal, 'confirm', { method: 'POST', body: { t } }); assert.equal(r.s, 200); const ccookie = ck(r);
  r = await call(portal, 'me', { cookie: ccookie }); assert.equal(r.d.email, 'ann@acme.com'); assert.equal(r.d.account.company, 'ACME Diesel'); assert.equal(r.d.admin, false);
  // 5. order: idempotent, saved before Unleashed, number atomic, deterministic Guid
  global.__cache = (k) => (k === 'portal/products.json' ? { tiers: ['Tier 1'], at: 1, items: { P1: { t: [50], d: 60, g: 'gg' } } } : k === 'portal/stock.json' ? { qty: { P1: 9 } } : null);
  const order = { idem: 'abc123', po: 'PO1', lines: [{ code: 'P1', qty: 2 }], ship: { street: '1 Main', city: 'Miami', state: 'FL', zip: '33101' } };
  r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: order }); assert.equal(r.d.ok, true, JSON.stringify(r.d)); assert.equal(r.d.order.total, 100); assert.equal(r.d.order.number, 'SO-000123');
  assert.equal(T.orders.length, 1); assert.equal(T.orders[0].live, true); assert.equal(T.orders[0].number, 'MXO-10001'); assert.equal(T.order_lines.length, 1);
  const so1 = ulCalls.filter((c) => c.o && c.o.method === 'POST' && /SalesOrders/.test(c.p)); assert.equal(so1.length, 1); assert.equal(so1[0].p, 'SalesOrders/' + T.orders[0].id, 'Guid = order id');
  assert.ok(!('stopCredit' in r.d.order) && !('tier' in r.d.order), 'no internal fields to the customer');
  r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: order }); assert.equal(T.orders.length, 1, 'retry does not duplicate'); assert.equal(ulCalls.filter((c) => c.o && c.o.method === 'POST' && /SalesOrders/.test(c.p)).length, 1);
  r = await call(portal, 'orders', { cookie: ccookie }); assert.equal(r.d.orders.length, 1); assert.equal(r.d.orders[0].lines[0].qty, 2);
  // 6. Unleashed failure: no order left behind, retry uses the same Guid
  ulFail = true; const o2 = Object.assign({}, order, { idem: 'second' });
  r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: o2 }); assert.equal(r.s, 502); assert.equal(T.orders.length, 1);
  ulFail = false; const before = ulCalls.length; r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: o2 }); assert.equal(r.d.ok, true); assert.equal(T.orders.length, 2);
  const guids = ulCalls.filter((c) => c.o && c.o.method === 'POST' && /SalesOrders/.test(c.p)).map((c) => c.p).filter((x) => x === 'SalesOrders/' + T.orders[1].id); assert.equal(guids.length, 2, 'same guid on retry');
  // 7. quote history
  const quote = require(path.join(root, 'api/quote.js'));
  process.env.HUBSPOT_TOKEN = '';
  r = await call(quote, 'q', { method: 'POST', cookie: ccookie, body: { source: 'B2B store', customer: { name: 'Ann', company: 'ACME', email: 'ann@acme.com', phone: '9545550123' }, lines: [{ pn: 'P1', name: 'Inj', qty: 3 }], shipping: {} } });
  assert.equal(T.quotes.length, 1); r = await call(portal, 'quotes', { cookie: ccookie }); assert.equal(r.d.quotes.length, 1); assert.equal(r.d.quotes[0].lines[0].qty, 3); assert.ok(/^MXQ-/.test(r.d.quotes[0].id));

  // 7b. backorder: stock never blocks, the line is flagged
  const bo = Object.assign({}, order, { idem: 'bo1', lines: [{ code: 'P1', qty: 20 }] });
  r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: bo }); assert.equal(r.d.ok, true, JSON.stringify(r.d));
  const bl = T.order_lines.find((l) => l.qty === 20); assert.equal(bl.backorder, true); assert.equal(bl.stock_at_order, 9);
  assert.ok(ulCalls.filter((c) => c.o && c.o.method === 'POST' && /SalesOrders/.test(c.p)).pop().o.body.Comments.includes('BACKORDER'));
  // 7c. vouchers: admin creates, customer checks and applies, limits hold
  const ex = new Date(Date.now() + 864e5).toISOString();
  r = await call(admin, 'voucher-save', { method: 'POST', cookie: acookie, body: { code: 'bf27', kind: 'percent', value: 10, expires_at: ex, max_uses: 1 } }); assert.equal(r.d.ok, true, JSON.stringify(r.d));
  r = await call(admin, 'voucher-save', { method: 'POST', cookie: acookie, body: { code: 'BF27', kind: 'percent', value: 5, expires_at: ex } }); assert.equal(r.s, 409, 'duplicate code');
  r = await call(admin, 'voucher-save', { method: 'POST', cookie: acookie, body: { code: 'BAD', kind: 'percent', value: 150, expires_at: ex } }); assert.equal(r.s, 400);
  r = await call(admin, 'voucher-save', { method: 'POST', cookie: acookie, body: { code: 'OLD', kind: 'fixed', value: 5, starts_at: '2020-01-01', expires_at: '2020-02-01' } }); assert.equal(r.d.ok, true);
  const cart = [{ code: 'P1', qty: 2 }];
  r = await call(portal, 'voucher-check', { method: 'POST', cookie: ccookie, body: { code: 'bf27', lines: cart } }); assert.equal(r.d.ok, true); assert.equal(r.d.discount, 10); assert.equal(r.d.total, 90);
  r = await call(portal, 'voucher-check', { method: 'POST', cookie: ccookie, body: { code: 'OLD', lines: cart } }); assert.equal(r.d.ok, false);
  r = await call(portal, 'voucher-check', { method: 'POST', cookie: ccookie, body: { code: 'NOPE', lines: cart } }); assert.equal(r.d.ok, false);
  const vo = Object.assign({}, order, { idem: 'v1', voucher: 'BF27', lines: cart });
  r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: vo }); assert.equal(r.d.ok, true, JSON.stringify(r.d)); assert.equal(r.d.order.total, 90); assert.equal(T.voucher_redemptions.length, 1);
  const lastSo = ulCalls.filter((c) => c.o && c.o.method === 'POST' && /SalesOrders/.test(c.p)).pop().o.body; assert.ok(lastSo.Comments.includes('VOUCHER BF27')); assert.equal(lastSo.SubTotal, 90);
  const vo2 = Object.assign({}, order, { idem: 'v2', voucher: 'BF27', lines: cart });
  const n0 = T.orders.length; r = await call(portal, 'order', { method: 'POST', cookie: ccookie, body: vo2 }); assert.equal(r.s, 400, 'limit reached'); assert.equal(T.orders.length, n0, 'no order left');
  r = await call(admin, 'vouchers', { cookie: acookie }); assert.equal(r.d.vouchers.find((v) => v.code.toUpperCase() === 'BF27').uses, 1);
  r = await call(admin, 'voucher-toggle', { method: 'POST', cookie: acookie, body: { id: T.vouchers[0].id, active: false } }); assert.equal(T.vouchers[0].active, false);
  // 7d. visibility, track, loyalty, events
  r = await call(admin, 'hidden-set', { method: 'POST', cookie: acookie, body: { hide: true, codes: 'P9, P8', reason: 'internal' } }); assert.equal(r.d.n, 2); assert.equal(T.hidden_products.length, 2);
  r = await call(admin, 'hidden-set', { method: 'POST', cookie: acookie, body: { hide: false, codes: 'P9' } }); assert.equal(T.hidden_products.length, 1);
  const track = require(path.join(root, 'api/track.js'));
  r = await call(track, '', { method: 'POST', cookie: ccookie, body: { visitor: 'abcdef123456', session: 's1', utm: { source: 'newsletter' }, events: [{ type: 'product', code: 'P1', path: '/portal' }, { type: 'cart_add', code: 'P1', qty: 2 }, { type: 'evil' }] } }); assert.equal(r.s, 204);
  assert.equal(T.events.length, 2); assert.ok(T.events[0].company_id, 'tied to the company when signed in');
  r = await call(admin, 'events', { cookie: acookie }); assert.equal(r.d.total, 2); assert.equal(r.d.top_cart_adds[0].k, 'P1');
  r = await call(admin, 'loyalty-save', { method: 'POST', cookie: acookie, body: { enabled: false, points_per_usd: 2 } }); assert.equal(r.d.ok, true);
  r = await call(admin, 'loyalty', { cookie: acookie }); assert.equal(r.d.settings.enabled, false);
  // 7e. segments, invite, terms, accept
  r = await call(admin, 'terms-save', { method: 'POST', cookie: acookie, body: { version: 'v0', body: 'rascunho' } }); assert.equal(r.d.ok, true);
  r = await call(admin, 'segment-save', { method: 'POST', cookie: acookie, body: { name: 'Rebuilder', rules: {}, invite_subject: 'Hi rebuilders' } }); assert.equal(r.d.ok, true, JSON.stringify(r.d));
  r = await call(admin, 'segments', { cookie: acookie }); assert.equal(r.d.segments[0].name, 'Rebuilder');
  const hand = { id: uuid(), name: 'Rebuild Inc', unleashed_code: 'RB1', status: 'ready', contact_email: 'rb@rebuild.com', contact_name: 'Rob', created_at: new Date().toISOString() }; T.companies.push(hand);
  r = await call(admin, 'invite', { method: 'POST', cookie: acookie, body: { company: hand.id } }); assert.equal(r.s, 409, 'blocked until terms are published and company is linked');
  r = await call(admin, 'terms-publish', { method: 'POST', cookie: acookie, body: { version: 'v0' } }); assert.equal(r.d.ok, true);
  r = await call(admin, 'terms-save', { method: 'POST', cookie: acookie, body: { version: 'v0', body: 'x' } }); assert.equal(r.s, 409, 'published is frozen');
  sent.length = 0; r = await call(admin, 'invite', { method: 'POST', cookie: acookie, body: { company: hand.id } }); assert.equal(r.d.ok, true, JSON.stringify(r.d)); assert.equal(hand.status, 'invited');
  const iv = decodeURIComponent(sent.pop().cta.url.split('iv=')[1]);
  r = await call(portal, 'invite-info', { query: { t: iv } }); assert.equal(r.d.ok !== false, true, JSON.stringify(r.d));
  r = await call(portal, 'accept', { method: 'POST', body: { t: iv, agree: false } }); assert.equal(r.s, 400, 'must accept the terms');
  r = await call(portal, 'accept', { method: 'POST', body: { t: iv, agree: true } }); assert.equal(r.s, 200, JSON.stringify(r.d)); assert.equal(hand.status, 'active');
  r = await call(portal, 'accept', { method: 'POST', body: { t: iv, agree: true } }); assert.equal(r.s >= 400, true, 'invite is single use');
  // 8. revoke kills the session at once
  r = await call(admin, 'revoke', { method: 'POST', cookie: acookie, body: { email: 'ann@acme.com' } }); assert.equal(r.d.ok, true);
  r = await call(portal, 'me', { cookie: ccookie }); assert.equal(r.s, 401);
  // 9. reject
  await call(portal, 'request', { method: 'POST', body: { name: 'Bob', company: 'Bob Co', email: 'bob@bob.com', phone: '3055550123' } });
  r = await call(admin, 'list', { cookie: acookie }); const bob = r.d.accounts.find((a) => a.company === 'Bob Co');
  r = await call(admin, 'reject', { method: 'POST', cookie: acookie, body: { account: bob.id, reason: 'no' } }); assert.equal(r.d.ok, true); assert.equal(T.users.find((u) => u.email === 'bob@bob.com').status, 'rejected');
  // 9b. manual prospect (not in Unleashed), shows in the Invites list, cannot reuse an e-mail
  r = await call(admin, 'addprospect', { method: 'POST', cookie: acookie, body: { company: 'Hand Added Co', email: 'hand@added.com', name: 'Hal' } }); assert.equal(r.d.ok, true, JSON.stringify(r.d));
  r = await call(admin, 'addprospect', { method: 'POST', cookie: acookie, body: { company: 'Dup', email: 'hand@added.com' } }); assert.equal(r.s, 409);
  r = await call(admin, 'prospects', { cookie: acookie }); assert.equal(r.d.prospects.length, 1); assert.equal(r.d.prospects[0].users[0].email, 'hand@added.com'); assert.equal(r.d.prospects[0].source, 'manual');
  // 10. admin session limits
  const s = T.sessions.find((x) => x.kind === 'admin'); s.idle_expires_at = new Date(Date.now() - 1000).toISOString();
  r = await call(admin, 'list', { cookie: acookie }); assert.equal(r.s, 401, 'idle expiry');
  console.log('all ok');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
