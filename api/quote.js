// POST /api/quote
// Creates or updates the contact in HubSpot, opens a deal "Quote request QR-..." and attaches the parts list as a note.
const { upsertContact, esc } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');
const { guard } = require('../lib/guard');
const { createSalesQuote } = require('../lib/unleashed-quote');
const { nextNumber, readJson, writeJson } = require('../lib/store');
const { authenticate } = require('../lib/auth');
const crypto = require('crypto');
const attrib = require('../lib/attribution');
const PS = require('../lib/portal-store');
const dbm = require('../lib/db');
const { send } = require('../lib/mail');
const { notifyTeam } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const b = readBody(req);
  const g = guard(req, b);
  if (g) return res.status(g[0]).json(g[1]);
  const c = b.customer || {};
  const customer = { name: clean(c.name, 120), company: clean(c.company, 160), email: clean(c.email, 160).toLowerCase(), phone: clean(c.phone, 40), type: clean(c.type, 80), notes: clean(c.notes, 2000) };
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 300).map((l) => ({ pn: clean(l.pn, 80), name: clean(l.name, 240), qty: Math.max(1, Math.min(99999, parseInt(l.qty, 10) || 1)) }));
  const store = /B2B store/.test(clean(b.source, 300));
  let number = store ? (PS.on() ? await PS.nextNumber('quote') : await nextNumber('quote')) : (clean(b.number, 40) || ('QR-' + Date.now()));
  const s = b.shipping || {};
  const ship = { street: clean(s.street, 160), country: clean(s.country, 60), state: clean(s.state, 60), city: clean(s.city, 80), zip: clean(s.zip, 20), method: clean(s.method, 60), needBy: clean(s.needBy, 20), po: clean(s.po, 60) };
  const b2b = b.b2b === true;
  await attrib.save('quote', customer.email, number, b.attribution, req);
  if (EMAIL.test(customer.email)) await require('../lib/visitors').tagVisitor(clean(b.visitor, 40), customer.email);
  const source = clean(b.source, 300);
  const shipText = [ship.street, ship.city, ship.state, ship.zip, ship.country].filter(Boolean).join(', ');
  const extra = [shipText && ('Ship to: ' + shipText), ship.method && ('Delivery: ' + ship.method), ship.needBy && ('Needed by: ' + ship.needBy),
    ship.po && ('PO / reference: ' + ship.po), b2b && 'Wants early access to the B2B ordering platform', source && ('Source: ' + source)].filter(Boolean);
  // signed-in store users already have a verified e-mail and contact on file: phone is optional for them
  const auth = store ? await authenticate(req) : null;
  const who = auth ? auth.email : null;
  if (who) customer.email = who; // a signed-in person sends as themselves, whatever the form says
  const phoneOk = customer.phone.replace(/\D/g, '').length >= 7 || (!customer.phone && who && who === customer.email);
  if (!customer.name || !customer.company || !EMAIL.test(customer.email) || !phoneOk || !lines.length) {
    return res.status(400).json({ error: 'missing fields' });
  }
  // asked to receive promotions and news: kept with where the consent came from
  if (b.optin === true && dbm.configured()) await dbm.insert('email_optins', [{ email: customer.email, source: store ? 'store quote' : 'website quote' }], { onConflict: 'email', ignoreDuplicates: true }).catch((e) => console.error('optin', e.message));
  // quotes also go to Unleashed as a Draft sales quote: store quotes when PORTAL_QUOTES_LIVE=1, website quotes when
  // SITE_QUOTES_UNLEASHED=1. Never blocks the request; HubSpot always gets the full quote.
  const ulq = await createSalesQuote(req, { number, customer, lines, notes: customer.notes, ship }, { site: !store });
  console.log('unleashed parked order', store ? 'store' : 'site', ulq.ok ? 'created ' + (ulq.number || '') : (ulq.skipped ? 'skipped ' + (ulq.reason || 'off') : 'failed ' + (ulq.error || '')));
  if (ulq.ok) { extra.push('Unleashed parked sales order: ' + (ulq.number || ulq.guid) + ' on ' + ulq.code + ' (' + (store ? 'store' : 'website') + ' ref ' + number + ')'); if (store && ulq.number) number = ulq.number; }
  // signed-in users keep a history of their quote requests in the store
  if (who) {
    const key = 'portal/quotes/' + crypto.createHash('sha256').update(who).digest('hex').slice(0, 24) + '.json';
    if (PS.on()) { try { await PS.saveQuote(auth.account && auth.account.id, auth.user && auth.user.id, who, { id: number, ship: shipText, po: ship.po, needBy: ship.needBy, notes: customer.notes, ulGuid: ulq.guid || null, lines }); } catch (e) { console.error('quote history', e.message); } }
    else try { const list = (await readJson(key)) || []; list.unshift({ id: number, created: Date.now(), status: 'Sent', ulGuid: ulq.guid || null, po: ship.po, needBy: ship.needBy, ship: shipText, notes: customer.notes, lines }); await writeJson(key, list.slice(0, 200)); } catch (e) { console.error('quote history', e.message); }
  }
  // every website quote is also kept in the portal database (Supabase) before HubSpot, so a CRM failure never loses it
  let kept = !!who;
  if (!who && dbm.configured()) {
    try {
      await PS.saveQuote(null, null, customer.email, { id: number, ship: shipText, po: ship.po, needBy: ship.needBy, ulGuid: ulq.guid || null, lines,
        notes: [[customer.name, customer.company, customer.phone, customer.type].filter(Boolean).join(' · '), ship.method && ('Delivery: ' + ship.method), b2b && 'Asked for B2B access', source && ('Source: ' + source), customer.notes].filter(Boolean).join('\n') });
      kept = true;
    } catch (e) { console.error('quote db', e.message); }
  }
  // Max Control is the CRM: the quote is saved above, becomes a deal from the Unleashed order, and the team gets the e-mail below.
  // HubSpot only receives the contact, best effort, so marketing keeps the person; a HubSpot failure never blocks the quote.
  const units = lines.reduce((s, l) => s + l.qty, 0);
  if (process.env.HUBSPOT_TOKEN) { try { await upsertContact(Object.assign({}, customer, { source: store ? 'B2B store quote' : 'Website quote request' })); } catch (e) { console.error('hubspot contact', e.message); } }
  try {
    // alert to the sales team with direct links to the deal and the contact
    await notifyTeam(`New quote request ${number} · ${customer.company}`, (store ? 'New B2B store quote' : 'New quote request from the website'),
      [['Quote', number], ['Customer', [customer.name, customer.company].filter(Boolean).join(' · ')], ['Email', customer.email], ['Phone', customer.phone],
        ['Ship to', shipText], ['Parts', `${lines.length} lines, ${units} units`], ['Unleashed', ulq.ok ? 'Parked sales order ' + (ulq.number || ulq.guid) + ' on ' + ulq.code + (ulq.matched ? ' (existing customer)' : '') : (ulq.error ? 'Not created: ' + ulq.error : '')], ['B2B access', b2b ? 'Asked for B2B portal access' : '']],
      [{ label: 'Open Deals in Max Control', url: 'https://www.maxzzdiesel.com/admin?tab=crm' }, { label: 'Quotes & orders', url: 'https://www.maxzzdiesel.com/admin?tab=pipe' }],
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1d2126">${lines.slice(0, 40).map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eef0f2;font-size:13px"><b>${esc(l.pn)}</b> · ${esc(l.name)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eef0f2;font-size:13px">x${l.qty}</td></tr>`).join('')}</table>`);
    // confirmation to the customer: number, status, every line; never blocks the answer
    try {
      const row = (l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eef0f2;font-size:14px"><b style="font-family:Menlo,Consolas,monospace;font-size:13px;color:#1d2126">${esc(l.pn)}</b><br><span style="color:#5f6670">${esc(l.name)}</span></td><td align="right" width="70" style="padding:8px 0 8px 16px;border-bottom:1px solid #eef0f2;font-size:14px;white-space:nowrap;vertical-align:top;color:#1d2126">Qty <b>${l.qty}</b></td></tr>`;
      const facts = [['Quote number', number], ['Status', 'Received, in review'], ship.po && ['PO / reference', ship.po], ship.needBy && ['Needed by', ship.needBy], shipText && ['Deliver to', shipText]].filter(Boolean)
        .map((f) => `<tr><td style="padding:3px 0;color:#8a9097;font-size:13px;width:130px">${esc(f[0])}</td><td style="padding:3px 0;font-size:14px;color:#1d2126">${esc(f[1])}</td></tr>`).join('');
      const body = `<p>We received your quote request. Our sales team replies with price, stock and lead time within one business day.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px">${facts}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1d2126">${lines.map(row).join('')}</table>
<p style="margin:10px 0 0;font-size:13px;color:#8a9097">${lines.length} ${lines.length === 1 ? 'part' : 'parts'}, ${units} ${units === 1 ? 'unit' : 'units'}. Not an order: prices and availability are confirmed in writing by our sales team.</p>${customer.notes ? `<p style="margin:14px 0 0"><b>Your notes:</b> ${esc(customer.notes)}</p>` : ''}`;
      const host = /^https:\/\/(www\.)?maxzzdiesel\.com$/.test(req.headers.origin || '') ? req.headers.origin : 'https://www.maxzzdiesel.com';
      await send(customer.email, 'Quote request ' + number + ' received', 'We received your quote request', body,
        who ? { url: host + '/portal#/orders', label: 'Follow it in My orders and quotes' } : null, { name: customer.name, greet: true });
    } catch (e) { console.error('quote mail', e.message); }
  } catch (e) {
    console.error('quote notify', e.message);
    if (!kept) return res.status(502).json({ error: 'could not save the quote' });
  }
  return res.status(200).json({ ok: true, id: number });
};
