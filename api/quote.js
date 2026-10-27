// POST /api/quote
// Creates or updates the contact in HubSpot, opens a deal "Quote request QR-..." and attaches the parts list as a note.
const { hs, upsertContact, addNote, addTask, OWNER, esc } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const b = readBody(req);
  if (b.hp) return res.status(200).json({ ok: true });            // honeypot: silently drop bots
  const c = b.customer || {};
  const customer = { name: clean(c.name, 120), company: clean(c.company, 160), email: clean(c.email, 160).toLowerCase(), phone: clean(c.phone, 40), type: clean(c.type, 80), notes: clean(c.notes, 2000) };
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 300).map((l) => ({ pn: clean(l.pn, 80), name: clean(l.name, 240), qty: Math.max(1, Math.min(99999, parseInt(l.qty, 10) || 1)) }));
  const number = clean(b.number, 40) || ('QR-' + Date.now());
  if (!customer.name || !customer.company || !EMAIL.test(customer.email) || customer.phone.replace(/\D/g, '').length < 7 || !lines.length) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (!process.env.HUBSPOT_TOKEN) return res.status(503).json({ error: 'crm not configured' });
  try {
    const contactId = await upsertContact(Object.assign({}, customer, { source: 'Website quote request' }));
    const units = lines.reduce((s, l) => s + l.qty, 0);
    const latam = /latin/i.test(customer.type);
    const text = lines.map((l, i) => `${i + 1}. ${l.pn} | ${l.name} | qty ${l.qty}`).join('\n');
    const deal = await hs('/crm/v3/objects/deals', 'POST', {
      properties: {
        dealname: `Quote request ${number} · ${customer.company}`,
        hubspot_owner_id: OWNER(),
        pipeline: latam ? (process.env.HUBSPOT_PIPELINE_LATAM || '71274341') : (process.env.HUBSPOT_PIPELINE || '71230012'),
        dealstage: latam ? (process.env.HUBSPOT_DEALSTAGE_LATAM || '137586015') : (process.env.HUBSPOT_DEALSTAGE || '137533774'),
        description: `${lines.length} lines, ${units} units. Business: ${customer.type}.\n\n${text}${customer.notes ? '\n\nNotes: ' + customer.notes : ''}`.slice(0, 65000)
      },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }]
    });
    const rows = lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.pn)}</td><td>${esc(l.name)}</td><td style="text-align:right">${l.qty}</td></tr>`).join('');
    const html = `<p><strong>Quote request ${esc(number)}</strong> from the website.</p>` +
      `<p>${esc(customer.name)} · ${esc(customer.company)} · ${esc(customer.email)} · ${esc(customer.phone)} · ${esc(customer.type)}</p>` +
      `<table><thead><tr><th>#</th><th>Part number</th><th>Description</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table>` +
      (customer.notes ? `<p><strong>Notes:</strong> ${esc(customer.notes)}</p>` : '');
    await addNote(html, [{ id: deal.id, type: 214 }, { id: contactId, type: 202 }]);
    await addTask(`Reply to quote ${number} · ${customer.company}`, `${lines.length} lines, ${units} units. ${customer.name} · ${customer.email} · ${customer.phone}`, [{ id: deal.id, type: 216 }, { id: contactId, type: 204 }], 2);
    return res.status(200).json({ ok: true, id: number });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'crm error' });
  }
};
