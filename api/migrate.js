// One-time, repeatable move of the portal data from the private Blob files into Supabase.
// POST with the CRON_SECRET. Default is a dry run that only counts; add ?apply=1 to write. Safe to run again: records are
// matched on their old id, so nothing is duplicated. It reads the Blob files and never changes or deletes them.
const crypto = require('crypto');
const db = require('../lib/db');
const { readJson } = require('../lib/store');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const iso = (ms) => (ms ? new Date(ms).toISOString() : undefined);
const CO = { pending: 'pending', approved: 'active', rejected: 'rejected' };
const ROLES = ['owner', 'buyer', 'viewer'];
const hash = (email) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const cs = process.env.CRON_SECRET || '';
  // POST by hand, or GET from the Vercel cron (which sends the same CRON_SECRET)
  if (!['POST', 'GET'].includes(req.method) || !cs || req.headers.authorization !== 'Bearer ' + cs) return res.status(401).json({ error: 'auth' });
  const apply = req.query.apply === '1';
  const out = { apply, companies: 0, users: 0, addresses: 0, orders: 0, orderLines: 0, quotes: 0, quoteLines: 0, skipped: [] };
  try {
    const old = (await readJson('portal/db.json')) || { users: {}, accounts: {} };
    const accounts = Object.values(old.accounts || {}), users = Object.values(old.users || {});

    // companies
    const coRows = accounts.map((a) => ({
      legacy_id: a.id, name: a.company || '(no name)', unleashed_code: a.customerCode || null, unleashed_guid: isUuid(a.customerGuid) ? a.customerGuid : null,
      tier: a.tier || null, payment_terms: a.terms || null, stop_credit: !!a.stopCredit, status: CO[a.status] || 'pending', source: 'access_request',
      country: a.country || null, state: a.state || null, city: a.city || null, notes: a.notes || null,
      approved_by: a.approvedBy || null, approved_at: iso(a.approvedAt), created_at: iso(a.created),
    }));
    out.companies = coRows.length;
    const idOf = {}; // legacy account id -> company uuid
    if (apply && coRows.length) {
      const got = await db.insert('companies', coRows, { onConflict: 'legacy_id' });
      got.forEach((c) => { idOf[c.legacy_id] = c.id; });
    } else if (coRows.length) {
      (await db.select('companies', 'select=id,legacy_id&legacy_id=not.is.null')).forEach((c) => { idOf[c.legacy_id] = c.id; });
    }

    // users and shipping addresses
    const usRows = users.filter((u) => u.account && (idOf[u.account] || !apply)).map((u) => ({
      company_id: idOf[u.account], email: String(u.email).toLowerCase(), name: u.name || null, phone: u.phone || null,
      role: ROLES.includes(u.role) ? u.role : 'buyer', status: ['pending', 'approved', 'rejected'].includes(u.status) ? u.status : 'pending', created_at: iso(u.created),
    }));
    out.users = usRows.length;
    const userId = {}; // email -> user uuid
    if (apply && usRows.length) (await db.insert('users', usRows, { onConflict: 'email' })).forEach((u) => { userId[String(u.email).toLowerCase()] = u.id; });
    else (await db.select('users', 'select=id,email')).forEach((u) => { userId[String(u.email).toLowerCase()] = u.id; });

    const adRows = accounts.filter((a) => a.ship && (a.ship.street || a.ship.city) && idOf[a.id]).map((a) => ({
      company_id: idOf[a.id], kind: 'shipping', label: 'Default', name: a.ship.name || null, street: a.ship.street || null, city: a.ship.city || null,
      state: a.ship.state || null, zip: a.ship.zip || null, country: a.ship.country || null, is_default: true, origin: 'portal',
    }));
    out.addresses = adRows.length;
    if (apply && adRows.length) {
      const have = new Set((await db.select('addresses', 'select=company_id&origin=eq.portal&is_default=eq.true')).map((r) => r.company_id));
      const fresh = adRows.filter((r) => !have.has(r.company_id));
      if (fresh.length) await db.insert('addresses', fresh);
    }

    // orders (one Blob file per account)
    for (const a of accounts) {
      const list = (await readJson('portal/orders/' + a.id + '.json')) || [];
      if (!list.length) continue;
      if (!idOf[a.id]) { out.skipped.push('orders ' + a.id); continue; }
      const rows = list.map((o) => ({
        id: isUuid(o.guid) ? o.guid : undefined, legacy_id: o.id, number: o.number, company_id: idOf[a.id], placed_by: userId[String(o.by || '').toLowerCase()] || null,
        idem_key: o.idem || o.id, status: o.status || 'Received', live: !!o.live, unleashed_number: o.unleashedNumber || null, po: o.po || null, notes: o.notes || null,
        ship: o.ship || {}, subtotal: o.subtotal || 0, total: o.total || 0, tier_at_order: a.tier || null, created_at: iso(o.created),
      }));
      out.orders += rows.length;
      if (!apply) { out.orderLines += list.reduce((s, o) => s + (o.lines || []).length, 0); continue; }
      // rows with and without an explicit id cannot share one insert
      const withId = rows.filter((r) => r.id), noId = rows.filter((r) => !r.id).map((r) => { const c = Object.assign({}, r); delete c.id; return c; });
      const saved = [].concat(withId.length ? await db.insert('orders', withId, { onConflict: 'legacy_id' }) : [], noId.length ? await db.insert('orders', noId, { onConflict: 'legacy_id' }) : []);
      const byLegacy = {}; saved.forEach((r) => { byLegacy[r.legacy_id] = r.id; });
      for (const o of list) {
        const oid = byLegacy[o.id]; if (!oid) continue;
        const had = await db.select('order_lines', 'select=id&order_id=eq.' + oid + '&limit=1');
        if (had.length) continue; // already moved
        const lines = (o.lines || []).map((l, i) => ({ order_id: oid, line_no: i + 1, code: l.code, name: l.name || null, qty: l.qty, price: l.price }));
        if (lines.length) { await db.insert('order_lines', lines); out.orderLines += lines.length; }
        const hist = (o.history || []).map((h) => ({ order_id: oid, status: h.s, at: iso(h.at) }));
        if (hist.length) await db.insert('order_status_history', hist);
      }
    }

    // quotes (one Blob file per signed-in person)
    for (const u of users) {
      const email = String(u.email).toLowerCase();
      const list = (await readJson('portal/quotes/' + hash(u.email) + '.json')) || (await readJson('portal/quotes/' + hash(email) + '.json')) || [];
      if (!list.length) continue;
      const rows = list.map((q) => ({
        legacy_id: q.id, number: q.id, company_id: idOf[u.account] || null, requested_by: userId[email] || null, contact_email: email,
        status: q.ulStatus || q.status || 'Received', notes: q.notes || null, ship: { text: q.ship || '', po: q.po || '', needBy: q.needBy || '' }, created_at: iso(q.created),
      }));
      out.quotes += rows.length;
      if (!apply) { out.quoteLines += list.reduce((s, q) => s + (q.lines || []).length, 0); continue; }
      const saved = await db.insert('quotes', rows, { onConflict: 'legacy_id' });
      const byLegacy = {}; saved.forEach((r) => { byLegacy[r.legacy_id] = r.id; });
      for (const q of list) {
        const qid = byLegacy[q.id]; if (!qid) continue;
        if ((await db.select('quote_lines', 'select=id&quote_id=eq.' + qid + '&limit=1')).length) continue;
        const lines = (q.lines || []).map((l, i) => ({ quote_id: qid, line_no: i + 1, code: l.pn || l.code, name: l.name || null, qty: l.qty }));
        if (lines.length) { await db.insert('quote_lines', lines); out.quoteLines += lines.length; }
      }
    }

    // numbering continues from where the Blob counter stopped
    const seq = await readJson('portal/seq.json');
    if (seq && apply) {
      await db.update('sequences', 'name=eq.MXO', { value: seq.order || 10000 });
      await db.update('sequences', 'name=eq.MXQ', { value: seq.quote || 10000 });
    }
    out.sequences = seq ? { MXO: seq.order || 10000, MXQ: seq.quote || 10000 } : null;
    console.log('migrate result', JSON.stringify(out));
    return res.json(out);
  } catch (e) {
    console.error('migrate', e.message);
    return res.status(500).json(Object.assign(out, { error: String(e.message).slice(0, 200) }));
  }
};
