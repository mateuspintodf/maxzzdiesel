// Portal data in Supabase, behind the PORTAL_DB=1 switch. With the switch off the portal keeps using the private Blob
// files exactly as before. The rest of the portal sees the same shapes it always did (users by e-mail, accounts by id),
// so this file is the only place that knows about tables.
const crypto = require('crypto');
const db = require('./db');

const on = () => process.env.PORTAL_DB === '1' && db.configured();
const CO_OUT = { active: 'approved', pending: 'pending', rejected: 'rejected' };
const CO_IN = { approved: 'active', pending: 'pending', rejected: 'rejected' };
const iso = (ms) => (ms ? new Date(ms).toISOString() : undefined);
const ms = (s) => (s ? Date.parse(s) : 0);
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

function accountOut(c, ship) {
  return { id: c.id, company: c.name, country: c.country || '', state: c.state || '', city: c.city || '', type: c.customer_type || '', customerNumber: c.claimed_customer_number || '',
    notes: c.notes || '', status: CO_OUT[c.status] || c.status, customerCode: c.unleashed_code || undefined, customerGuid: c.unleashed_guid || undefined,
    customerName: c.unleashed_name || undefined, tier: c.tier || '', terms: c.payment_terms || '', stopCredit: !!c.stop_credit, approvedBy: c.approved_by || undefined,
    approvedAt: ms(c.approved_at) || undefined, rejectedBy: c.status === 'rejected' ? c.approved_by || undefined : undefined, reason: c.reject_reason || '', created: ms(c.created_at), ship: ship || null };
}
function userOut(u) { return { email: String(u.email).toLowerCase(), name: u.name || '', phone: u.phone || '', role: u.role, account: u.company_id, status: u.status, created: ms(u.created_at), id: u.id }; }
const shipOut = (a) => (a ? { name: a.name || '', street: a.street || '', city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || '' } : null);

// the whole picture, in the shape the portal used to read from db.json (a few hundred rows at most)
async function loadDb() {
  const [cos, us, ads] = await Promise.all([db.select('companies', 'select=*&order=created_at.desc'), db.select('users', 'select=*'),
    db.select('addresses', 'select=*&kind=eq.shipping&is_default=eq.true')]);
  const ship = {}; ads.forEach((a) => { ship[a.company_id] = shipOut(a); });
  const out = { users: {}, accounts: {} };
  cos.forEach((c) => { out.accounts[c.id] = accountOut(c, ship[c.id]); });
  us.forEach((u) => { out.users[String(u.email).toLowerCase()] = userOut(u); });
  return out;
}
// one user and its account, for the hot path (every request)
async function loadOne(email) {
  const us = await db.select('users', 'select=*&email=eq.' + encodeURIComponent(email) + '&limit=1');
  if (!us.length) return { user: null, account: null };
  const u = userOut(us[0]);
  const cs = await db.select('companies', 'select=*&id=eq.' + u.account + '&limit=1');
  if (!cs.length) return { user: u, account: null };
  const ads = await db.select('addresses', 'select=*&company_id=eq.' + u.account + '&kind=eq.shipping&is_default=eq.true&limit=1');
  return { user: u, account: accountOut(cs[0], shipOut(ads[0])) };
}

function companyRow(a) {
  return { name: a.company, country: a.country || null, state: a.state || null, city: a.city || null, customer_type: a.type || null, notes: a.notes || null,
    claimed_customer_number: a.customerNumber || null, status: CO_IN[a.status] || 'pending', unleashed_code: a.customerCode || null,
    unleashed_guid: isUuid(a.customerGuid) ? a.customerGuid : null, unleashed_name: a.customerName || null, tier: a.tier || null, payment_terms: a.terms || null,
    stop_credit: !!a.stopCredit, approved_by: a.approvedBy || a.rejectedBy || null, approved_at: iso(a.approvedAt) || null, reject_reason: a.reason || null,
    tier_synced_at: new Date().toISOString() };
}
// a new access request: company + user + the request itself
async function createRequest(f) {
  const co = (await db.insert('companies', [Object.assign(companyRow({ company: f.company, country: f.country, state: f.state, city: f.city, type: f.type, notes: f.notes,
    customerNumber: f.customerNumber, status: 'pending' }), { source: 'access_request', tier_synced_at: null })]))[0];
  const old = await db.select('users', 'select=id&email=eq.' + encodeURIComponent(f.email) + '&limit=1');
  let user;
  if (old.length) user = (await db.update('users', 'id=eq.' + old[0].id, { company_id: co.id, name: f.name, phone: f.phone, status: 'pending', role: 'owner' }))[0];
  else user = (await db.insert('users', [{ company_id: co.id, email: f.email, name: f.name, phone: f.phone, role: 'owner', status: 'pending' }]))[0];
  await db.insert('access_requests', [{ company_id: co.id, user_id: user.id, form: f }]);
  return co.id;
}
async function saveAccount(a) { await db.update('companies', 'id=eq.' + a.id, companyRow(a)); }
async function setUsersStatus(accountId, from, status) {
  const q = 'company_id=eq.' + accountId + (from ? '&status=in.(' + from.join(',') + ')' : '');
  await db.update('users', q, { status });
}
async function audit(admin, action, entity, entityId, before, after) {
  try { await db.insert('audit_log', [{ admin_email: admin, action, entity, entity_id: String(entityId || ''), before: before || null, after: after || null }]); } catch (e) { console.error('audit', e.message); }
}

// numbering (atomic in the database)
async function nextNumber(kind) { const n = await db.rpc('next_number', { seq: kind === 'order' ? 'MXO' : 'MXQ' }); return (kind === 'order' ? 'MXO-' : 'MXQ-') + n; }

// orders
function orderOut(o, lines, hist) {
  return { id: o.id, number: o.unleashed_number || o.number, storeNumber: o.unleashed_number ? o.number : undefined, idem: o.idem_key, created: ms(o.created_at), by: o.by || '', po: o.po || '', notes: o.notes || '', ship: o.ship || {},
    lines: lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: Number(l.price), total: Math.round(l.qty * Number(l.price) * 100) / 100 })),
    subtotal: Number(o.subtotal), total: Number(o.total), status: o.status, live: !!o.live, guid: o.live ? o.id : undefined, unleashedNumber: o.unleashed_number || undefined,
    checked: ms(o.checked_at), history: hist.map((h) => ({ s: h.status, at: ms(h.at) })) };
}
async function listOrders(accountId) {
  const os = await db.select('orders', 'select=*&company_id=eq.' + accountId + '&order=created_at.desc&limit=500');
  if (!os.length) return [];
  const ids = os.map((o) => o.id).join(',');
  const [ls, hs] = await Promise.all([db.select('order_lines', 'select=*&order_id=in.(' + ids + ')&order=line_no'), db.select('order_status_history', 'select=*&order_id=in.(' + ids + ')&order=at')]);
  const by = (arr, k) => { const m = {}; arr.forEach((x) => { (m[x[k]] = m[x[k]] || []).push(x); }); return m; };
  const L = by(ls, 'order_id'), H = by(hs, 'order_id');
  const users = {}; (await db.select('users', 'select=id,email&company_id=eq.' + accountId)).forEach((u) => { users[u.id] = String(u.email).toLowerCase(); });
  return os.map((o) => orderOut(Object.assign({}, o, { by: users[o.placed_by] || '' }), L[o.id] || [], H[o.id] || []));
}
async function findOrderByIdem(accountId, idem) {
  const r = await db.select('orders', 'select=id&company_id=eq.' + accountId + '&idem_key=eq.' + encodeURIComponent(idem) + '&limit=1');
  if (!r.length) return null;
  return (await listOrders(accountId)).find((o) => o.id === r[0].id) || null;
}
// The order id is generated before Unleashed is called and is also the Sales Order Guid, so a retry can never create two.
async function saveOrder(accountId, userId, o, extra) {
  extra = extra || {};
  const row = { id: o.id, number: o.number, company_id: accountId, placed_by: userId || null, idem_key: o.idem || o.id, status: o.status, live: !!o.live, unleashed_number: o.unleashedNumber || null,
    po: o.po || null, notes: o.notes || null, ship: o.ship || {}, subtotal: o.subtotal, total: o.total, tier_at_order: extra.tier || null, stop_credit_at_order: extra.stopCredit == null ? null : !!extra.stopCredit };
  await db.insert('orders', [row], { onConflict: 'id' });
  const had = await db.select('order_lines', 'select=id&order_id=eq.' + o.id + '&limit=1');
  if (!had.length) await db.insert('order_lines', o.lines.map((l, i) => ({ order_id: o.id, line_no: i + 1, code: l.code, name: l.name || null, qty: l.qty, price: l.price })));
  await db.insert('order_status_history', [{ order_id: o.id, status: o.status }]);
}
async function updateOrderStatus(orderId, status, unleashedNumber) {
  await db.update('orders', 'id=eq.' + orderId, Object.assign({ status, checked_at: new Date().toISOString() }, unleashedNumber ? { unleashed_number: unleashedNumber } : {}));
  await db.insert('order_status_history', [{ order_id: orderId, status }]);
}

// quotes of a signed-in person
async function listQuotes(userId) {
  const qs = await db.select('quotes', 'select=*&requested_by=eq.' + userId + '&order=created_at.desc&limit=200');
  if (!qs.length) return [];
  const ls = await db.select('quote_lines', 'select=*&quote_id=in.(' + qs.map((q) => q.id).join(',') + ')&order=line_no');
  return qs.map((q) => ({ id: q.number, created: ms(q.created_at), status: 'Sent', ulStatus: q.status !== 'Received' && q.status !== 'Sent' ? q.status : undefined, ulGuid: (q.ship || {}).ulGuid || undefined, checked: ms(q.checked_at), po: (q.ship || {}).po, needBy: (q.ship || {}).needBy,
    ship: (q.ship || {}).text, notes: q.notes || '', lines: ls.filter((l) => l.quote_id === q.id).map((l) => ({ pn: l.code, name: l.name, qty: l.qty })) }));
}
async function saveQuote(companyId, userId, email, q) {
  const row = (await db.insert('quotes', [{ number: q.id, company_id: companyId || null, requested_by: userId || null, contact_email: email, status: 'Sent', notes: q.notes || null,
    ship: { text: q.ship || '', po: q.po || '', needBy: q.needBy || '', ulGuid: q.ulGuid || null }, unleashed_number: null }], { onConflict: 'number' }))[0];
  const had = await db.select('quote_lines', 'select=id&quote_id=eq.' + row.id + '&limit=1');
  if (!had.length) await db.insert('quote_lines', q.lines.map((l, i) => ({ quote_id: row.id, line_no: i + 1, code: l.pn || l.code, name: l.name || null, qty: l.qty })));
}

async function orderLive(orderId, unleashedNumber, status) {
  await db.update('orders', 'id=eq.' + orderId, { live: true, unleashed_number: unleashedNumber || null, status: status || 'Parked' });
  await db.insert('order_status_history', [{ order_id: orderId, status: status || 'Parked' }]);
}
async function dropOrder(orderId) { await db.remove('orders', 'id=eq.' + orderId); }
async function updateQuoteStatus(number, status) { await db.update('quotes', 'number=eq.' + encodeURIComponent(number), { status, checked_at: new Date().toISOString() }); }
// same order id for the same (company, idempotency key): a retry reuses the Unleashed Guid, so it can never create a second order
function orderIdFor(accountId, idem) {
  const h = crypto.createHash('sha256').update('mx-order|' + accountId + '|' + idem).digest('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
}

module.exports = { orderLive, dropOrder, updateQuoteStatus, orderIdFor, on, loadDb, loadOne, createRequest, saveAccount, setUsersStatus, audit, nextNumber, listOrders, findOrderByIdem, saveOrder, updateOrderStatus, listQuotes, saveQuote, isUuid, crypto };
