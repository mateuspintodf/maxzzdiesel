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
// ---------------------------------------------------------------- Unleashed import into segments
const addrOf = (c) => { const a = (c.Addresses || []).find((x) => /physical|street/i.test(x.AddressType || '')) || (c.Addresses || [])[0] || {}; return { city: a.City || '', state: a.Region || '', country: a.Country || '' }; };
async function allCustomers() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const d = await ul('Customers', 'pageSize=500&pageNumber=' + page, { timeoutMs: 40000 });
    (d.Items || []).forEach((c) => out.push(c));
    if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
  }
  return out;
}
// codes of customers with at least one sales order since a date (used by the "bought in the last N months" filter)
async function buyersSince(months) {
  const since = new Date(Date.now() - months * 30.44 * 864e5).toISOString().slice(0, 10), codes = new Set();
  for (let page = 1; page <= 40; page++) {
    const d = await ul('SalesOrders', 'orderStatus=Completed,Placed,Parked,Backordered&startDate=' + since + '&pageSize=200&pageNumber=' + page, { timeoutMs: 40000 });
    (d.Items || []).forEach((o) => { if (o.Customer && o.Customer.CustomerCode) codes.add(o.Customer.CustomerCode); });
    if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
  }
  return codes;
}
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
async function selectCustomers(f) {
  f = f || {};
  let rows = (await allCustomers()).filter((c) => c.CustomerCode && !c.Obsolete);
  const tiers = list(f.tiers), types = list(f.types), countries = list(f.countries), states = list(f.states), q = String(f.name || '').trim().toLowerCase();
  if (tiers.length) rows = rows.filter((c) => tiers.includes(String(c.SellPriceTier || '').toLowerCase()));
  if (types.length) rows = rows.filter((c) => types.includes(String(c.CustomerType || '').toLowerCase()));
  if (countries.length) rows = rows.filter((c) => countries.includes(addrOf(c).country.toLowerCase()));
  if (states.length) rows = rows.filter((c) => states.includes(addrOf(c).state.toLowerCase()));
  if (q) rows = rows.filter((c) => (c.CustomerName + ' ' + c.CustomerCode).toLowerCase().includes(q));
  if (f.hasEmail) rows = rows.filter((c) => EMAIL.test(String(c.Email || '').trim()));
  const m = parseInt(f.boughtWithinMonths, 10);
  if (m > 0) { const buyers = await buyersSince(Math.min(m, 120)); rows = rows.filter((c) => buyers.has(c.CustomerCode)); }
  const nb = parseInt(f.notBoughtWithinMonths, 10);
  if (nb > 0) { const buyers = await buyersSince(Math.min(nb, 120)); rows = rows.filter((c) => !buyers.has(c.CustomerCode)); }
  return rows;
}
const facet = (rows, fn) => { const m = {}; rows.forEach((c) => { const k = fn(c) || '(none)'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 40); };
A['import-preview'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const rows = await selectCustomers(readBody(req).filters);
  const have = new Set((await db.select('companies', 'select=unleashed_code&unleashed_code=not.is.null')).map((r) => r.unleashed_code));
  return res.json({ total: rows.length, alreadyInPortal: rows.filter((c) => have.has(c.CustomerCode)).length, withEmail: rows.filter((c) => EMAIL.test(String(c.Email || '').trim())).length,
    tiers: facet(rows, (c) => c.SellPriceTier), types: facet(rows, (c) => c.CustomerType), countries: facet(rows, (c) => addrOf(c).country),
    sample: rows.slice(0, 15).map((c) => ({ code: c.CustomerCode, name: c.CustomerName, tier: c.SellPriceTier || '', type: c.CustomerType || '', email: c.Email || '', city: addrOf(c).city, country: addrOf(c).country })) });
};
async function segmentByName(name, by) {
  const e = encodeURIComponent(name);
  const f = (await db.select('segments', 'select=*&name=eq.' + e + '&limit=1'))[0];
  return f || (await db.insert('segments', [{ name, created_by: by }]))[0];
}
A.import = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const b = readBody(req), segName = clean(b.segment, 80);
  if (!segName) return res.status(400).json({ error: 'Give the segment a name (for example Rebuilders).' });
  const rows = await selectCustomers(b.filters);
  if (!rows.length) return res.status(400).json({ error: 'No customer matches these filters.' });
  const seg = await segmentByName(segName, w.email);
  await db.update('segments', 'id=eq.' + seg.id, { rules: b.filters || {} });
  const existing = {}; (await db.select('companies', 'select=id,unleashed_code&unleashed_code=not.is.null')).forEach((r) => { existing[r.unleashed_code] = r.id; });
  const fresh = rows.filter((c) => !existing[c.CustomerCode]);
  for (let i = 0; i < fresh.length; i += 100) {
    const made = await db.insert('companies', fresh.slice(i, i + 100).map((c) => { const a = addrOf(c); return { name: c.CustomerName || c.CustomerCode, unleashed_code: c.CustomerCode, unleashed_guid: /^[0-9a-f-]{36}$/i.test(c.Guid || '') ? c.Guid : null,
      tier: c.SellPriceTier || null, payment_terms: c.PaymentTerm || null, stop_credit: !!c.StopCredit, customer_type: c.CustomerType || null, city: a.city || null, state: a.state || null, country: a.country || null,
      status: 'prospect', source: 'unleashed_import', contact_email: String(c.Email || '').trim().toLowerCase() || null, contact_name: [c.ContactFirstName, c.ContactLastName].filter(Boolean).join(' ') || null, contact_phone: c.PhoneNumber || null, tier_synced_at: new Date().toISOString() }; }));
    made.forEach((m) => { existing[m.unleashed_code] = m.id; });
  }
  const links = rows.map((c) => ({ company_id: existing[c.CustomerCode], segment_id: seg.id, added_by: w.email })).filter((l) => l.company_id);
  for (let i = 0; i < links.length; i += 200) await db.insert('company_segments', links.slice(i, i + 200), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  await PS.audit(w.email, 'import.run', 'segment', seg.id, null, { segment: segName, matched: rows.length, created: fresh.length });
  return res.json({ ok: true, segment: segName, matched: rows.length, created: fresh.length, alreadyThere: rows.length - fresh.length });
};
A.segments = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const segs = await db.select('segments', 'select=*&order=name');
  const links = await db.select('company_segments', 'select=segment_id,company_id');
  const ids = [...new Set(links.map((l) => l.company_id))];
  const st = {}; if (ids.length) (await db.select('companies', 'select=id,status&id=in.(' + ids.join(',') + ')')).forEach((c) => { st[c.id] = c.status; });
  return res.json({ segments: segs.map((g) => { const m = links.filter((l) => l.segment_id === g.id); const by = {}; m.forEach((l) => { const k = st[l.company_id] || '?'; by[k] = (by[k] || 0) + 1; });
    return { id: g.id, name: g.name, description: g.description || '', invite_subject: g.invite_subject || '', invite_body: g.invite_body || '', members: m.length, byStatus: by }; }) });
};
A['segment-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), name = clean(b.name, 80);
  if (!name) return res.status(400).json({ error: 'name' });
  const patch = { description: clean(b.description, 300) || null, invite_subject: clean(b.invite_subject, 150) || null, invite_body: clean(b.invite_body, 4000) || null };
  const seg = await segmentByName(name, w.email);
  await db.update('segments', 'id=eq.' + seg.id, patch);
  await PS.audit(w.email, 'segment.save', 'segment', seg.id, null, { name });
  return res.json({ ok: true });
};
// move companies in or out of a segment by hand
A['segment-members'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), ids = (Array.isArray(b.companies) ? b.companies : []).map((x) => clean(x, 60)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  const seg = (await db.select('segments', 'select=id&id=eq.' + clean(b.segment, 60) + '&limit=1'))[0];
  if (!seg || !ids.length) return res.status(400).json({ error: 'segment' });
  if (b.remove) await db.remove('company_segments', 'segment_id=eq.' + seg.id + '&company_id=in.(' + ids.join(',') + ')');
  else await db.insert('company_segments', ids.map((c) => ({ company_id: c, segment_id: seg.id, added_by: w.email })), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- terms (draft until a superadmin publishes)
A.terms = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  return res.json({ terms: await db.select('terms_versions', 'select=*&order=created_at.desc') });
};
A['terms-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req), version = clean(b.version, 40), body = String(b.body || '').slice(0, 60000);
  if (!version || !body.trim()) return res.status(400).json({ error: 'version and text are required' });
  const cur = (await db.select('terms_versions', 'select=status&version=eq.' + encodeURIComponent(version) + '&limit=1'))[0];
  if (cur && cur.status !== 'draft') return res.status(409).json({ error: 'A published version cannot be edited. Save it under a new version name.' });
  await db.insert('terms_versions', [{ version, body, status: 'draft' }], { onConflict: 'version' });
  await PS.audit(w.email, 'terms.save', 'terms', version);
  return res.json({ ok: true });
};
A['terms-publish'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const version = clean(readBody(req).version, 40);
  const t = (await db.select('terms_versions', 'select=status&version=eq.' + encodeURIComponent(version) + '&limit=1'))[0];
  if (!t || t.status !== 'draft') return res.status(404).json({ error: 'draft not found' });
  await db.update('terms_versions', 'status=eq.published', { status: 'retired' });
  await db.update('terms_versions', 'version=eq.' + encodeURIComponent(version), { status: 'published', published_at: new Date().toISOString(), published_by: w.email });
  await PS.audit(w.email, 'terms.publish', 'terms', version);
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- proactive invite: one click per company, always by an admin
A.invite = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.company, 60);
  const t = (await db.select('terms_versions', 'select=version&status=eq.published&limit=1'))[0];
  if (!t) return res.status(409).json({ error: 'Publish the terms before inviting anyone (Invites > Terms).' });
  const co = (await db.select('companies', 'select=*&id=eq.' + id + '&limit=1'))[0];
  if (!co) return res.status(404).json({ error: 'company' });
  if (!co.unleashed_code) return res.status(409).json({ error: 'Link this company to an Unleashed customer first (Customers > Approve).' });
  if (co.status === 'active') return res.status(409).json({ error: 'This company is already active.' });
  const email = clean(b.email || co.contact_email, 160).toLowerCase(), name = clean(b.name || co.contact_name, 120);
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Add the e-mail of the person to invite.' });
  const owner = (await db.select('users', 'select=id,company_id&email=eq.' + encodeURIComponent(email) + '&limit=1'))[0];
  if (owner && owner.company_id !== co.id) return res.status(409).json({ error: 'That e-mail already belongs to another company in the portal.' });
  let uid = owner && owner.id;
  if (!uid) uid = (await db.insert('users', [{ company_id: co.id, email, name: name || null, phone: co.contact_phone || null, role: 'owner', status: 'pending', invited_at: new Date().toISOString(), invited_by: w.email }]))[0].id;
  else await db.update('users', 'id=eq.' + uid, { invited_at: new Date().toISOString(), invited_by: w.email });
  const seg = (await db.select('company_segments', 'select=segment_id&company_id=eq.' + co.id + '&limit=1'))[0];
  const sg = seg ? (await db.select('segments', 'select=invite_subject,invite_body&id=eq.' + seg.segment_id + '&limit=1'))[0] : null;
  const nonce = await SDB.newLink(email, 'invite', 14 * 864e5);
  const subject = (sg && sg.invite_subject) || 'You are invited to the Maxzz Diesel B2B portal';
  const body = (sg && sg.invite_body) ? String(sg.invite_body).split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') : `<p>We opened a wholesale account for <b>${esc(co.name)}</b> in the Maxzz Diesel B2B portal. You will see your own prices and live stock, request quotes and track your orders.</p>`;
  await send(email, subject, 'You are invited', body + '<p style="color:#8a9097;font-size:13px">The link is yours and works for 14 days.</p>', { url: base(req) + '/portal?iv=' + encodeURIComponent(nonce), label: 'Open my account' }, { name, greet: true });
  await db.update('companies', 'id=eq.' + co.id, { status: 'invited' });
  await PS.audit(w.email, 'invite.send', 'company', co.id, null, { email });
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- vouchers
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
A.vouchers = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const rows = await db.select('vouchers', 'select=*,companies(name)&order=created_at.desc&limit=300');
  const red = await db.select('voucher_redemptions', 'select=voucher_id,discount&limit=20000');
  const by = {}; red.forEach((r) => { const x = by[r.voucher_id] || (by[r.voucher_id] = { n: 0, sum: 0 }); x.n++; x.sum += Number(r.discount); });
  return res.json({ vouchers: rows.map((v) => ({ ...v, company_name: v.companies && v.companies.name, uses: (by[v.id] || { n: 0 }).n, discount_total: (by[v.id] || { sum: 0 }).sum, companies: undefined })) });
};
A['voucher-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  const code = clean(b.code, 40).replace(/\s+/g, '').toUpperCase();
  const kind = b.kind === 'fixed' ? 'fixed' : 'percent', value = num(b.value);
  const starts = b.starts_at ? new Date(b.starts_at) : new Date(), expires = b.expires_at ? new Date(b.expires_at) : null;
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: 'Code: 3 to 40 letters, numbers, - or _.' });
  if (!(value > 0) || (kind === 'percent' && value > 100)) return res.status(400).json({ error: kind === 'percent' ? 'Percent must be between 0 and 100.' : 'Value must be above zero.' });
  if (!expires || isNaN(expires) || isNaN(starts)) return res.status(400).json({ error: 'Set the start and the expiry dates.' });
  if (expires <= starts) return res.status(400).json({ error: 'Expiry must be after the start.' });
  let companyId = clean(b.company_id, 60) || null;
  if (clean(b.company_code, 40)) {
    const co = (await db.select('companies', 'select=id&unleashed_code=eq.' + encodeURIComponent(clean(b.company_code, 40)) + '&limit=1'))[0];
    if (!co) return res.status(400).json({ error: 'No portal company with that Unleashed code. Import or approve it first.' });
    companyId = co.id;
  }
  const rec = {
    code, description: clean(b.description, 200) || null, kind, value,
    company_id: companyId,
    min_subtotal: num(b.min_subtotal) > 0 ? num(b.min_subtotal) : null,
    starts_at: starts.toISOString(), expires_at: expires.toISOString(),
    max_uses: num(b.max_uses) > 0 ? Math.floor(num(b.max_uses)) : null,
    max_uses_per_company: num(b.max_uses_per_company) > 0 ? Math.floor(num(b.max_uses_per_company)) : null,
    active: b.active !== false,
  };
  try {
    if (id) { await db.update('vouchers', 'id=eq.' + id, rec); await PS.audit(w.email, 'voucher.update', 'voucher', id, null, { code }); }
    else { const r = await db.insert('vouchers', [{ ...rec, created_by: w.email }]); await PS.audit(w.email, 'voucher.create', 'voucher', r[0].id, null, { code }); }
  } catch (e) { return res.status(409).json({ error: /duplicate|unique/i.test(e.message) ? 'That code already exists.' : 'Could not save.' }); }
  return res.json({ ok: true });
};
A['voucher-toggle'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  await db.update('vouchers', 'id=eq.' + id, { active: !!b.active });
  await PS.audit(w.email, b.active ? 'voucher.on' : 'voucher.off', 'voucher', id);
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- product visibility (hidden = admin-only)
A.hidden = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  return res.json({ hidden: await db.select('hidden_products', 'select=*&order=created_at.desc&limit=2000') });
};
A['hidden-set'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const codes = (Array.isArray(b.codes) ? b.codes : String(b.codes || '').split(/[\s,;]+/)).map((c) => clean(c, 60)).filter(Boolean).slice(0, 500);
  if (!codes.length) return res.status(400).json({ error: 'Add at least one product code.' });
  if (b.hide) await db.insert('hidden_products', codes.map((code) => ({ code, reason: clean(b.reason, 200) || null, hidden_by: w.email })), { onConflict: 'code' });
  else await db.remove('hidden_products', 'code=in.(' + codes.map((c) => '"' + c.replace(/"/g, '') + '"').join(',') + ')');
  await PS.audit(w.email, b.hide ? 'product.hide' : 'product.show', 'product', codes.join(',').slice(0, 200));
  return res.json({ ok: true, n: codes.length });
};

// ---------------------------------------------------------------- behaviour log: summaries for BI
A.events = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const company = clean(req.query.company, 60);
  const q = 'select=at,visitor_id,type,path,code,qty,value,query,device,country,region,city,utm,referrer,company_id,user_id&at=gte.' + since + (company ? '&company_id=eq.' + company : '') + '&order=at.desc&limit=' + (company ? 500 : 5000);
  const rows = await db.select('events', q);
  if (company) return res.json({ timeline: rows.slice(0, 500) });
  const top = (key, n = 15) => { const m = {}; rows.forEach((r) => { const k = r[key]; if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ k, c })); };
  const of = (t) => rows.filter((r) => r.type === t);
  const adds = {}; of('cart_add').forEach((r) => { if (r.code) adds[r.code] = (adds[r.code] || 0) + (r.qty || 1); });
  const src = {}; rows.forEach((r) => { const u = r.utm && r.utm.source; const k = u || (r.referrer ? 'ref:' + r.referrer : 'direct'); src[k] = (src[k] || 0) + 1; });
  return res.json({
    days, total: rows.length, sample: rows.length >= 5000,
    visitors: new Set(rows.map((r) => r.visitor_id)).size,
    by_type: top('type', 20), top_products: top('code'), top_searches: top('query'), top_pages: top('path'),
    top_cart_adds: Object.entries(adds).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ k, c })),
    sources: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ k, c })),
    devices: top('device', 5), regions: top('region', 15),
  });
};

// ---------------------------------------------------------------- dashboard: sales (Unleashed history), portal behavior, next actions
const { cached } = require('../lib/store');
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
async function names() {
  const cat = await cached('catalog/live.json', 60 * 60 * 1000).catch(() => null);
  const m = {}; (Array.isArray(cat) ? cat : []).forEach((r) => { m[r[0]] = { t: String(r[1] || '').split(' / ')[0].slice(0, 70), k: r[3] }; });
  return m;
}
// rule-based next actions; each one says who, why and what to do, ranked by money at stake
function actions(S, B, portal, N) {
  const out = [], nm = (c) => (N[c] && N[c].t) || c;
  const inPortal = (c) => portal[c] && portal[c] !== 'rejected';
  (S.due || []).slice(0, 25).forEach((c) => {
    const items = (c.items || []).slice(0, 4).map((i) => i.code + ' (' + nm(i.code) + ')');
    out.push({ kind: 'reorder', channel: 'call', score: (c.r12 || 0) + (c.total || 0) / 4, title: (c.status === 'overdue' ? 'Overdue: ' : 'Due to reorder: ') + c.n,
      why: 'Buys about every ' + c.med + ' days. Last order ' + c.since + ' days ago. ' + usd(c.r12) + ' in the last 12 months.' + (c.sp ? ' Salesperson: ' + c.sp + '.' : ''),
      todo: items.length ? 'Call or e-mail with the parts they usually buy: ' + items.join(', ') + '.' : 'Call to check what they need next.',
      who: [{ c: c.c, n: c.n }], codes: (c.items || []).map((i) => i.code) });
  });
  (S.declining || []).slice(0, 10).forEach((c) => out.push({ kind: 'declining', channel: 'call', score: (c.p12 - c.r12) * 0.8, title: 'Buying less: ' + c.n,
    why: usd(c.r12) + ' in the last 12 months against ' + usd(c.p12) + ' the year before (' + Math.round((1 - c.r12 / Math.max(1, c.p12)) * 100) + '% down).',
    todo: 'Ask what changed: price, stock, a competitor, or less work. A tier review or a targeted voucher may bring them back.', who: [{ c: c.c, n: c.n }] }));
  const lost = (S.lost || []).filter((c) => c.total >= 1000);
  if (lost.length) out.push({ kind: 'winback', channel: 'campaign', score: lost.reduce((a, c) => a + (c.p12 || 0) + c.total / 6, 0) / 3,
    title: 'Win-back campaign: ' + pl(lost.length, 'customer') + ' who stopped buying or are slipping', why: 'Together they spent ' + usd(lost.reduce((a, c) => a + c.total, 0)) + ' with Maxzz, ' + Math.round(lost.reduce((a, c) => a + c.orders, 0) / lost.length) + ' orders each on average.',
    todo: 'E-mail with a one-time voucher (for example 7% off, 30 days) and a portal invite. Call the 5 largest first.', who: lost.map((c) => ({ c: c.c, n: c.n })) });
  const nw = (S.new_customers || []).filter((c) => c.orders === 1);
  if (nw.length) out.push({ kind: 'second_order', channel: 'campaign', score: nw.length * 800, title: 'Second order push: ' + pl(nw.length, 'new customer') + ' with one order',
    why: 'New in the last 4 months and have not ordered again yet. The second order is where a customer usually sticks.', todo: 'Send a welcome with a portal invite and the parts most bought with what they ordered.', who: nw.map((c) => ({ c: c.c, n: c.n })) });
  const notIn = (S.top_customers || []).filter((c) => c.r12 > 0 && !inPortal(c.c)).slice(0, 25);
  if (notIn.length) out.push({ kind: 'portal_invite', channel: 'campaign', score: notIn.reduce((a, c) => a + c.r12, 0) / 20, title: 'Invite top customers to the portal: ' + notIn.length + ' not in yet',
    why: 'They are among your 40 biggest customers in the last 12 months and still order by phone or e-mail.', todo: 'Import them as a segment and send the portal invite, starting with the ones you talk to most.', who: notIn.map((c) => ({ c: c.c, n: c.n })) });
  (S.rising || []).slice(0, 5).forEach((p) => out.push({ kind: 'rising', channel: 'content', score: (p.r90 || 0) / 2, title: 'Selling more: ' + p.code + ' ' + nm(p.code),
    why: p.q90 + ' units in the last 90 days against ' + p.pq90 + ' in the 90 before.', todo: 'Check stock covers the trend, feature it on the portal home and in an Instagram post or e-mail to customers of that engine.', codes: [p.code] }));
  (S.falling || []).slice(0, 3).forEach((p) => out.push({ kind: 'falling', channel: 'review', score: (p.pr90 || 0) / 3, title: 'Selling less: ' + p.code + ' ' + nm(p.code),
    why: p.q90 + ' units in the last 90 days against ' + p.pq90 + ' in the 90 before.', todo: 'Check price against the market and stock. If it is seasonal, nothing to do.', codes: [p.code] }));
  (B.users || []).filter((u) => u.hot).slice(0, 15).forEach((u) => out.push({ kind: 'portal_intent', channel: 'call', score: 1500 + (u.ca || 0) * 500 + (u.pv || 0) * 50, title: 'Shopping without ordering: ' + (u.company || u.email),
    why: (u.name || u.email) + ' viewed ' + (u.pv || 0) + ' parts' + (u.ca ? ' and added ' + u.ca + ' to the cart' : '') + ' in the portal, with no quote or order.' + (u.queries && u.queries.length ? ' Searched: ' + u.queries.join(', ') + '.' : ''),
    todo: 'Reach out today: help with the parts they looked at' + (u.codes && u.codes.length ? ' (' + u.codes.slice(0, 4).join(', ') + ')' : '') + ', price or stock questions.', who: [{ c: u.code, n: u.company, e: u.email }], codes: u.codes || [] }));
  return out.sort((a, b) => b.score - a.score).slice(0, 40).map((a) => { a.score = Math.round(a.score); return a; });
}
A.dash = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const [S, B, cos, N, ord, qts] = await Promise.all([
    db.rpc('dash_sales'), db.rpc('dash_behavior', { p_days: days }),
    db.select('companies', 'select=unleashed_code,status&unleashed_code=not.is.null'), names(),
    db.select('orders', 'select=total,created_at,status&created_at=gte.' + new Date(Date.now() - days * 864e5).toISOString() + '&limit=2000'),
    db.select('quotes', 'select=created_at&created_at=gte.' + new Date(Date.now() - days * 864e5).toISOString() + '&limit=2000'),
  ]);
  const portal = {}; (cos || []).forEach((c) => { portal[c.unleashed_code] = c.status; });
  const title = (c) => (N[c] ? N[c].t : '');
  ['products', 'rising', 'falling'].forEach((k) => (S[k] || []).forEach((p) => { p.t = title(p.code); p.k = N[p.code] ? N[p.code].k : ''; }));
  (S.due || []).forEach((c) => (c.items || []).forEach((i) => { i.t = title(i.code); }));
  ['top_customers', 'due', 'lost', 'declining', 'new_customers'].forEach((k) => (S[k] || []).forEach((c) => { c.portal = portal[c.c] || null; }));
  ['viewed', 'carted'].forEach((k) => (B[k] || []).forEach((p) => { p.t = title(p.k); }));
  const P = { orders: ord.length, order_value: Math.round(ord.reduce((a, o) => a + Number(o.total || 0), 0)), quotes: qts.length,
    companies: Object.values(portal).filter((s) => s === 'approved' || s === 'active').length, invited: Object.values(portal).filter((s) => s === 'invited').length };
  return res.json({ days, sales: S, behavior: B, portal: P, actions: actions(S, B, portal, N), ai: aiOn(req), at: Date.now() });
};
// AI read of the same numbers: campaigns for groups and one-to-one actions. Off until DASH_AI=1 (it has a cost per run).
// Only business data goes out (company names, codes, totals, parts); no e-mails or phone numbers.
// key: an AI Gateway key if one is set, else the project's own Vercel OIDC token (no key to manage)
const AI_KEY = (req) => process.env.AI_GATEWAY_API_KEY || (req && req.headers['x-vercel-oidc-token']) || process.env.VERCEL_OIDC_TOKEN || '';
const aiOn = (req) => process.env.DASH_AI === '1' && !!AI_KEY(req);
A['dash-ai'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const { readJson, writeJson } = require('../lib/store');
  if (req.method !== 'POST') return res.json({ on: aiOn(req), last: await readJson('portal/dash-ai.json').catch(() => null) });
  if (!originOk(req)) return res.status(405).json({ error: 'method' });
  if (!aiOn(req)) return res.status(409).json({ error: 'AI suggestions are not switched on yet.' });
  const last = await readJson('portal/dash-ai.json').catch(() => null);
  if (last && Date.now() - last.at < 10 * 60 * 1000) return res.json(last); // one run per 10 minutes is plenty
  const [S, B, N] = await Promise.all([db.rpc('dash_sales'), db.rpc('dash_behavior', { p_days: 30 }), names()]);
  const nm = (c) => (N[c] ? N[c].t : '');
  const cut = (a, n, f) => (a || []).slice(0, n).map(f);
  const facts = {
    today: new Date().toISOString().slice(0, 10), kpi: S.kpi, months: (S.months || []).slice(-13), segments: S.segments, status: S.status,
    due: cut(S.due, 20, (c) => ({ customer: c.n, code: c.c, every_days: c.med, days_since: c.since, last12: c.r12, rep: c.sp, usual_parts: (c.items || []).slice(0, 4).map((i) => i.code + ' ' + nm(i.code)) })),
    lost_or_at_risk: cut(S.lost, 15, (c) => ({ customer: c.n, code: c.c, lifetime: c.total, prev12: c.p12, days_since: c.since, orders: c.orders })),
    declining: cut(S.declining, 10, (c) => ({ customer: c.n, last12: c.r12, prev12: c.p12 })),
    new_customers: cut(S.new_customers, 15, (c) => ({ customer: c.n, first: c.first, orders: c.orders, total: c.total, country: c.country })),
    top_products: cut(S.products, 20, (p) => ({ code: p.code, name: nm(p.code), type: N[p.code] ? N[p.code].k : '', rev12: p.r12, units12: p.q12, buyers12: p.cust12 })),
    rising: cut(S.rising, 10, (p) => ({ code: p.code, name: nm(p.code), units90: p.q90, prev90: p.pq90 })),
    falling: cut(S.falling, 8, (p) => ({ code: p.code, name: nm(p.code), units90: p.q90, prev90: p.pq90 })),
    countries: S.countries, reps: S.reps,
    portal_30d: { totals: B.totals, funnel: B.funnel, sources: B.sources, searches: (B.searches || []).slice(0, 15), viewed: cut(B.viewed, 12, (p) => ({ code: p.k, name: nm(p.k), views: p.c })),
      shopping_without_order: (B.users || []).filter((u) => u.hot).slice(0, 10).map((u) => ({ company: u.company, viewed: u.pv, carted: u.ca, parts: u.codes, searched: u.queries })) },
  };
  const prompt = 'You are the sales analyst of Maxzz Diesel, a diesel fuel injection distributor in Florida (Bosch injectors, pumps, nozzles, repair parts, tools) selling B2B to repair shops and rebuilders in the US and Latin America through a sales team and a B2B portal. ' +
    'From the data below, write the actions with the best expected return for the next 2 weeks. Be specific: name customers, parts and numbers from the data, never invent figures. Plain, direct English, no hype, no em dashes. ' +
    'Answer only with JSON: {"summary": "3 to 5 sentences on how the business is doing and why", "one_to_one": [{"customer": "", "code": "", "action": "", "why": "", "channel": "call|email|whatsapp|visit", "priority": 1}], ' +
    '"campaigns": [{"name": "", "audience": "who and how many, from the data", "codes": ["customer codes if known"], "channel": "email|whatsapp|instagram|portal|call", "offer": "", "message": "a short draft of the message", "why": "", "expected": "what success looks like"}], ' +
    '"products": [{"code": "", "action": "", "why": ""}], "watch": ["risks or data gaps worth checking"]}. Up to 10 one_to_one, 5 campaigns, 5 products.\n\nDATA:\n' + JSON.stringify(facts);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + AI_KEY(req), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error('dash-ai', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: r.status === 401 || r.status === 403 ? 'The AI service refused the key. Check AI Gateway in Vercel.' : r.status === 402 ? 'AI Gateway has no credit left this month.' : 'The AI service did not answer. Try again in a minute.' }); }
    const text = String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'The AI answer could not be read. Try again.' });
    const doc = { at: Date.now(), by: w.email, model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', out };
    await writeJson('portal/dash-ai.json', doc);
    await PS.audit(w.email, 'dash.ai', 'dashboard', 'ai').catch(() => {});
    return res.json(doc);
  } finally { clearTimeout(t); }
};
A['dash-customers'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const [rows, cos] = await Promise.all([db.rpc('dash_customers'), db.select('companies', 'select=unleashed_code,status&unleashed_code=not.is.null')]);
  const portal = {}; (cos || []).forEach((c) => { portal[c.unleashed_code] = c.status; });
  (rows || []).forEach((r) => { r.portal = portal[r.c] || null; });
  return res.json({ rows: rows || [] });
};
// one customer, everything we know: sales rhythm and history from Unleashed, portal people, behavior, portal orders and quotes
A.customer = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const code = clean(req.query.code, 60), id = clean(req.query.id, 60);
  if (!code && !id) return res.status(400).json({ error: 'code' });
  const co = (await db.select('companies', 'select=*&' + (id ? 'id=eq.' + encodeURIComponent(id) : 'unleashed_code=eq.' + encodeURIComponent(code)) + '&limit=1'))[0] || null;
  const c = code || (co && co.unleashed_code) || '';
  const [sales, N, users, ev, ord, qts] = await Promise.all([
    c ? db.rpc('dash_customer', { p_code: c }) : null, names(),
    co ? db.select('users', 'select=email,name,phone,status,last_login_at&company_id=eq.' + co.id) : [],
    co ? db.select('events', 'select=at,type,code,query,path,device,city&company_id=eq.' + co.id + '&type=neq.page&order=at.desc&limit=60') : [],
    co ? db.select('orders', 'select=number,status,total,created_at&company_id=eq.' + co.id + '&order=created_at.desc&limit=10') : [],
    co ? db.select('quotes', 'select=number,status,created_at&company_id=eq.' + co.id + '&order=created_at.desc&limit=10') : [],
  ]);
  if (sales) (sales.parts || []).forEach((p) => { p.t = N[p.code] ? N[p.code].t : ''; });
  (ev || []).forEach((e) => { if (e.code && N[e.code]) e.t = N[e.code].t; });
  return res.json({ code: c, company: co && { id: co.id, name: co.name, status: co.status, tier: co.tier, city: co.city, state: co.state, country: co.country, contact_email: co.contact_email, contact_phone: co.contact_phone, salesperson: co.salesperson, created_at: co.created_at },
    sales, users, events: ev, orders: ord, quotes: qts });
};
A['dash-sync'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const out = await require('../lib/sales-sync').run(45 * 1000);
  return res.json(Object.assign({ ok: !out.error }, out));
};

// ---------------------------------------------------------------- loyalty (off until the rules are decided)
A.loyalty = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const s = (await db.select('loyalty_settings', 'select=*&id=eq.1'))[0];
  const rows = await db.select('loyalty_ledger', 'select=company_id,points');
  const bal = {}; rows.forEach((r) => { bal[r.company_id] = (bal[r.company_id] || 0) + r.points; });
  return res.json({ settings: s, companies_with_points: Object.keys(bal).length, points_outstanding: Object.values(bal).reduce((a, b) => a + b, 0) });
};
A['loyalty-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const rec = { enabled: !!b.enabled, points_per_usd: Math.max(0, num(b.points_per_usd) || 1), usd_per_point: Math.max(0, num(b.usd_per_point) || 0.01), expiry_months: num(b.expiry_months) > 0 ? Math.floor(num(b.expiry_months)) : null, updated_by: w.email, updated_at: new Date().toISOString() };
  await db.insert('loyalty_settings', [{ id: 1, ...rec }], { onConflict: 'id' });
  await PS.audit(w.email, 'loyalty.save', 'loyalty', '1', null, rec);
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
