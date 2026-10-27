// Hotmart webhook (v2): an approved DTA course sale becomes a HubSpot contact,
// a "course kit offer" deal owned by Leise and a follow-up task.
// Set HOTMART_HOTTOK in Vercel to the token shown in Hotmart > Tools > Webhook.
const { hs, upsertContact, addNote, addTask, OWNER, esc } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');

// Robiel kit that matches each course family (first match wins).
const KITS = [
  [/piezo/i, '323.50.091', 'Robiel kit for Bosch Piezo injectors'],
  [/denso/i, '323.50.083', 'Robiel kit for Denso and Continental injectors'],
  [/continental|siemens/i, '323.50.083', 'Robiel kit for Denso and Continental injectors'],
  [/isx|cummins|xpi/i, '323.50.38', 'Robiel kit for Cummins XPI injectors'],
  [/cat|caterpillar|c15|c7|c9|eui/i, '323.50.212', 'Robiel kit for Caterpillar injectors'],
  [/bosch|crin/i, '323.50.102', 'Robiel kit for Bosch CRIN injectors']
];
const APPROVED = /PURCHASE_APPROVED|PURCHASE_COMPLETE/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const token = req.headers['x-hotmart-hottok'];
  const b = readBody(req);
  if (!process.env.HOTMART_HOTTOK || (token || b.hottok) !== process.env.HOTMART_HOTTOK) return res.status(401).json({ error: 'token' });
  if (!process.env.HUBSPOT_TOKEN) return res.status(503).json({ error: 'crm not configured' });
  const event = clean(b.event, 60);
  if (!APPROVED.test(event)) return res.status(200).json({ ok: true, skipped: event });
  const d = b.data || {};
  const buyer = d.buyer || {};
  const product = d.product || {};
  const purchase = d.purchase || {};
  const email = clean(buyer.email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(200).json({ ok: true, skipped: 'no email' });
  const course = clean(product.name, 160) || 'DTA course';
  const tx = clean(purchase.transaction, 60);
  const kit = (KITS.find(([re]) => re.test(course)) || [null, '', 'Course kit']);
  try {
    const contactId = await upsertContact({ name: clean(buyer.name, 120), email, phone: clean(buyer.checkout_phone || buyer.phone, 40), source: 'Hotmart DTA' });
    const deal = await hs('/crm/v3/objects/deals', 'POST', {
      properties: {
        dealname: `DTA kit offer · ${course} · ${clean(buyer.name, 80) || email}`,
        pipeline: process.env.HUBSPOT_PIPELINE || '71230012',
        dealstage: process.env.HUBSPOT_DEALSTAGE || '137533774',
        hubspot_owner_id: OWNER(),
        description: `Bought ${course} on Hotmart${tx ? ' (' + tx + ')' : ''}. Suggested kit: ${kit[1]} ${kit[2]}.`
      },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }]
    });
    await addNote(`<p><strong>Diesel Tech Academy purchase</strong> on Hotmart.</p><p>Course: ${esc(course)}${tx ? ' · Transaction ' + esc(tx) : ''}</p><p>Suggested kit: ${esc(kit[1])} ${esc(kit[2])}</p>`, [{ id: deal.id, type: 214 }, { id: contactId, type: 202 }]);
    await addTask(`Send course kit offer · ${course}`, `${clean(buyer.name, 120)} · ${email}. Suggested kit: ${kit[1]} ${kit[2]}.`, [{ id: deal.id, type: 216 }, { id: contactId, type: 204 }], 24);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'crm error' });
  }
};
