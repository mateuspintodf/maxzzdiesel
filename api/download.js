// POST /api/download
// Gated catalog download: saves the contact in HubSpot with a note, then returns the file URL.
// The file itself stays public; the form is a light ask, and the download never depends on the CRM being up.
const { upsertContact, addNote, esc } = require('../lib/hubspot');
const { EMAIL, clean, readBody } = require('../lib/validate');
const { guard } = require('../lib/guard');

const FILES = { robiel: { url: '/downloads/robiel-electronic-line.pdf', name: 'Robiel Electronic Line catalog' } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const b = readBody(req);
  const g = guard(req, b);
  if (g) return res.status(g[0]).json(g[1].ok ? { ok: true, url: (FILES[b.file] || FILES.robiel).url } : g[1]);
  const f = FILES[clean(b.file, 20)];
  const c = { name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), company: clean(b.company, 120), phone: '' };
  if (!f) return res.status(400).json({ error: 'unknown file' });
  if (!EMAIL.test(c.email)) return res.status(400).json({ error: 'email' });
  if (process.env.HUBSPOT_TOKEN) {
    try {
      const id = await upsertContact(c);
      await addNote(`<p><strong>Downloaded: ${esc(f.name)}</strong> from the website${b.lang ? ' (' + esc(clean(b.lang, 5)) + ')' : ''}.</p><p>${esc(c.name)} · ${esc(c.email)}${c.company ? ' · ' + esc(c.company) : ''}</p>`, [{ id, type: 202 }]);
    } catch (e) { console.error(e); }
  }
  return res.status(200).json({ ok: true, url: f.url });
};
