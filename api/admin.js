// Admin API, separate from the customer portal: own cookie (mx_admin), own session rules (1 h idle, 8 h absolute),
// own people table (admins). Works only with PORTAL_DB=1. /api/admin?a=<action>
const crypto = require('crypto');
const db = require('../lib/db');
const PS = require('../lib/portal-store');
const SDB = require('../lib/sessions-db');
const { ul, configured } = require('../lib/unleashed');
const { send, esc } = require('../lib/mail');
const { EMAIL, clean, readBody } = require('../lib/validate');

const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/(admin\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const originOk = (req) => { const o = req.headers.origin || ''; return !o || ALLOWED.some((re) => re.test(o)); };
const envAdmins = () => String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
const base = (req) => process.env.SITE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://www.maxzzdiesel.com' : 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));

// who may sign in: the admins table, plus the old PORTAL_ADMINS variable as a bootstrap (as superadmins)
async function adminRole(email) {
  const r = await db.select('admins', 'select=role,active&email=eq.' + encodeURIComponent(email) + '&limit=1');
  if (r[0]) return r[0].active ? r[0].role : null;
  return envAdmins().includes(email) ? 'superadmin' : null;
}
async function who(req, res) {
  const s = await SDB.lookup(req, 'admin');
  const role = s && (await adminRole(s.email));
  if (!role) { res.status(401).json({ error: 'login' }); return null; }
  return { email: s.email, role };
}
const can = (w, ...roles) => w.role === 'superadmin' || roles.includes(w.role);

const A = {};

A.login = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (await SDB.limited(req, 'admin-login', 5, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  if (await adminRole(email)) {
    const nonce = await SDB.newLink(email, 'admin');
    await send(email, 'Maxzz admin sign-in link', 'Sign in to Maxzz admin',
      '<p>Use the button below. The link works once and expires in 20 minutes. The admin session ends after 1 hour without activity.</p>',
      { url: base(req) + '/admin?lt=' + encodeURIComponent(nonce), label: 'Sign in' }, { greet: true });
  }
  return res.json({ ok: true }); // same answer for everyone
};
A.confirm = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (await SDB.limited(req, 'admin-confirm', 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const link = await SDB.useLink(clean(readBody(req).t, 100));
  if (!link || link.kind !== 'admin' || !(await adminRole(link.email))) return res.status(400).json({ error: 'link' });
  await SDB.create(req, res, 'admin', link.email, null);
  await PS.audit(link.email, 'admin.login', 'admin', link.email);
  return res.json({ ok: true });
};
A.logout = async (req, res) => { if (req.method !== 'POST') return res.status(405).json({ error: 'method' }); await SDB.end(req, res, 'admin'); return res.json({ ok: true }); };
A.me = async (req, res) => { const w = await who(req, res); if (!w) return; return res.json(w); };

// companies with their people, newest first, pending on top
A.list = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const d = await PS.loadDb();
  const users = Object.values(d.users);
  const rank = (s) => (s === 'pending' ? 0 : 1);
  const accounts = Object.values(d.accounts).map((a) => Object.assign({}, a, { users: users.filter((u) => u.account === a.id).map((u) => ({ email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status })) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || b.created - a.created);
  const live = await db.select('sessions', 'select=email,kind,last_seen_at&revoked_at=is.null&idle_expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&abs_expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
  const open = {}; live.filter((x) => x.kind === 'customer').forEach((x) => { const e = String(x.email).toLowerCase(); open[e] = (open[e] || 0) + 1; });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ accounts, openSessions: open, ordersLive: process.env.PORTAL_ORDERS_LIVE === '1' });
};
A.lookup = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const code = clean(req.query.code, 40);
  if (!code) return res.status(400).json({ error: 'code' });
  const q = /^[A-Za-z0-9._ -]+$/.test(code) ? 'customerCode=' + encodeURIComponent(code) : 'customer=' + encodeURIComponent(code);
  const data = await ul('Customers', q + '&pageSize=10', { timeoutMs: 30000 });
  return res.json({ customers: (data.Items || []).slice(0, 10).map((c) => ({ code: c.CustomerCode, name: c.CustomerName, tier: c.SellPriceTier || '', guid: c.Guid, stopCredit: !!c.StopCredit, terms: c.PaymentTerm || '' })) });
};
A.approve = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), c = b.customer || {};
  const d = await PS.loadDb();
  const acc = d.accounts[clean(b.account, 60)];
  if (!acc) return res.status(404).json({ error: 'account' });
  if (!c.code || !c.guid) return res.status(400).json({ error: 'pick the Unleashed customer first' });
  let cust = null;
  if (configured()) {
    const guid = clean(c.guid, 60);
    if (!/^[0-9a-f-]{36}$/i.test(guid)) return res.status(400).json({ error: 'customer' });
    const data = await ul('Customers/' + guid, '', { timeoutMs: 30000 });
    cust = data && (data.Items ? data.Items[0] : data);
    if (!cust || !cust.CustomerCode) return res.status(404).json({ error: 'Unleashed customer not found' });
  }
  const code = cust ? cust.CustomerCode : clean(c.code, 40);
  const other = Object.values(d.accounts).find((a) => a.id !== acc.id && a.status === 'approved' && a.customerCode === code);
  if (other) return res.status(409).json({ error: 'Customer ' + code + ' is already linked to ' + other.company + '.' });
  Object.assign(acc, { status: 'approved', customerCode: code, customerGuid: cust ? cust.Guid : clean(c.guid, 60), customerName: cust ? cust.CustomerName : clean(c.name, 160), tier: cust ? (cust.SellPriceTier || '') : clean(c.tier, 60),
    terms: cust ? (cust.PaymentTerm || '') : '', stopCredit: cust ? !!cust.StopCredit : false, approvedBy: w.email, approvedAt: Date.now() });
  try { await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, ['pending', 'rejected'], 'approved'); }
  catch (e) { console.error('admin approve', e.message); return res.status(409).json({ error: 'Could not save. The customer code may already be linked.' }); }
  await PS.audit(w.email, 'company.approve', 'company', acc.id, null, { code, tier: acc.tier });
  const people = Object.values(d.users).filter((u) => u.account === acc.id);
  for (const u of people) await send(u.email, 'Your Maxzz B2B portal access is ready', 'Welcome to the Maxzz B2B portal',
    `<p>Your account for <b>${esc(acc.company)}</b> is approved. You can now see your prices and stock, place orders and track them.</p>`,
    { url: base(req) + '/portal', label: 'Open the portal' }, { name: u.name, greet: true }).catch((e) => console.error('mail', e.message));
  return res.json({ ok: true });
};
A.reject = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), d = await PS.loadDb();
  const acc = d.accounts[clean(b.account, 60)];
  if (!acc) return res.status(404).json({ error: 'account' });
  acc.status = 'rejected'; acc.rejectedBy = w.email; acc.reason = clean(b.reason, 400);
  await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, null, 'rejected');
  const people = Object.values(d.users).filter((u) => u.account === acc.id);
  for (const u of people) await SDB.revokeEmail(u.email, w.email, 'customer').catch(() => {});
  await PS.audit(w.email, 'company.reject', 'company', acc.id, null, { reason: acc.reason });
  if (b.notify) for (const u of people) await send(u.email, 'About your Maxzz B2B portal request', 'About your request',
    `<p>We could not open a portal account for ${esc(acc.company)} at this time.${acc.reason ? ' ' + esc(acc.reason) : ''}</p><p>You can still request quotes at maxzzdiesel.com/quote or reply to this e-mail.</p>`, null, { name: u.name, greet: true }).catch(() => {});
  return res.json({ ok: true });
};
// ends every open customer session of one person
A.revoke = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  await SDB.revokeEmail(email, w.email, 'customer');
  await PS.audit(w.email, 'session.revoke', 'user', email);
  return res.json({ ok: true });
};
// Invites tab: companies that are not active yet (prospects added by hand or imported), with the contact to invite
A.prospects = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const cos = await db.select('companies', 'select=*&status=in.(prospect,ready,invited)&order=created_at.desc&limit=500');
  const us = cos.length ? await db.select('users', 'select=email,name,phone,company_id,status&company_id=in.(' + cos.map((c) => c.id).join(',') + ')') : [];
  return res.json({ prospects: cos.map((c) => ({ id: c.id, company: c.name, status: c.status, source: c.source, code: c.unleashed_code || '', city: c.city || '', state: c.state || '', country: c.country || '',
    users: us.filter((u) => u.company_id === c.id).map((u) => ({ email: u.email, name: u.name, phone: u.phone, status: u.status })) })) });
};
// Manual inclusion: a customer that is not in Unleashed yet (or that the team wants to invite first). Creates the company as a prospect
// and, when an e-mail is given, its contact (pending: it only gets in after the team approves and links it to Unleashed).
A.addprospect = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const f = { company: clean(b.company, 160), name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 40), city: clean(b.city, 80), state: clean(b.state, 60), country: clean(b.country, 60), notes: clean(b.notes, 800) };
  if (!f.company) return res.status(400).json({ error: 'Company name is required.' });
  if (f.email && !EMAIL.test(f.email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  if (f.email && (await db.select('users', 'select=id&email=eq.' + encodeURIComponent(f.email) + '&limit=1')).length) return res.status(409).json({ error: 'That e-mail already belongs to a portal user.' });
  const co = (await db.insert('companies', [{ name: f.company, city: f.city || null, state: f.state || null, country: f.country || null, notes: f.notes || null, status: 'prospect', source: 'manual' }]))[0];
  if (f.email) await db.insert('users', [{ company_id: co.id, email: f.email, name: f.name || null, phone: f.phone || null, role: 'owner', status: 'pending' }]);
  await PS.audit(w.email, 'prospect.add', 'company', co.id, null, { company: f.company });
  return res.json({ ok: true, id: co.id });
};
// ---- admin people and roles (superadmin only). PORTAL_ADMINS stays as a read-only bootstrap list of superadmins.
const ROLES = ['superadmin', 'sales', 'marketing'];
A.admins = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const rows = await db.select('admins', 'select=email,name,role,active,created_at,created_by&order=created_at');
  const inTable = new Set(rows.map((r) => String(r.email).toLowerCase()));
  const boot = envAdmins().filter((e) => !inTable.has(e)).map((e) => ({ email: e, name: '', role: 'superadmin', active: true, bootstrap: true }));
  return res.json({ admins: rows.map((r) => Object.assign(r, { email: String(r.email).toLowerCase() })).concat(boot), roles: ROLES });
};
A['admin-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const email = clean(b.email, 160).toLowerCase(), role = clean(b.role, 20), name = clean(b.name, 120), active = b.active !== false;
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role' });
  if (email === w.email && (!active || role !== 'superadmin')) return res.status(400).json({ error: 'You cannot remove your own superadmin access.' });
  const before = (await db.select('admins', 'select=*&email=eq.' + encodeURIComponent(email) + '&limit=1'))[0] || null;
  await db.insert('admins', [{ email, role, name: name || null, active, created_by: before ? before.created_by : w.email, updated_at: new Date().toISOString() }], { onConflict: 'email' });
  if (!active || (before && before.role !== role)) await SDB.revokeEmail(email, w.email, 'admin').catch(() => {}); // new rights start at the next sign-in
  await PS.audit(w.email, before ? 'admin.update' : 'admin.create', 'admin', email, before && { role: before.role, active: before.active }, { role, active });
  return res.json({ ok: true });
};
A.audit = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  return res.json({ rows: await db.select('audit_log', 'select=*&order=at.desc&limit=100') });
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  if (!PS.on()) return res.status(503).json({ error: 'database mode is off' });
  const fn = A[String(req.query.a || '')];
  if (!fn) return res.status(404).json({ error: 'not found' });
  try { return await fn(req, res); }
  catch (e) { console.error('admin', req.query.a, e.message); return res.status(500).json({ error: 'server' }); }
};
