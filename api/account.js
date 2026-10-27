// POST /api/account
// Wholesale account request from the home page: creates or updates the contact in HubSpot and adds a note.
const { upsertContact, addNote, addTask, esc } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const b = readBody(req);
  if (b.hp) return res.status(200).json({ ok: true });
  const c = { name: clean(b.name, 120), phone: clean(b.phone, 40), email: clean(b.email, 160).toLowerCase(), type: clean(b.type, 80), company: '' };
  if (!c.name || !EMAIL.test(c.email) || c.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'missing fields' });
  if (!process.env.HUBSPOT_TOKEN) return res.status(503).json({ error: 'crm not configured' });
  try {
    const id = await upsertContact(c);
    await addNote(`<p><strong>Wholesale account request</strong> from the website.</p><p>${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)} · ${esc(c.type)}</p>`, [{ id, type: 202 }]);
    await addTask(`New wholesale account request · ${c.name}`, `${c.email} · ${c.phone} · ${c.type}`, [{ id, type: 204 }], 4);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'crm error' });
  }
};
