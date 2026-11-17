// POST /api/account
// Wholesale account request from the site (footer form and the quote page). It is the same access request as the B2B portal:
// it lands in the portal approval queue, opens a prospect in Unleashed (production) and creates the HubSpot contact, note and task.
const { EMAIL, clean, readBody } = require('../lib/validate');
const { guard } = require('../lib/guard');
const portal = require('./portal');
const attrib = require('../lib/attribution');

const FREE = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|msn|proton|protonmail|uol|bol|terra|ig)\./i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const b = readBody(req);
  const g = guard(req, b);
  if (g) return res.status(g[0]).json(g[1]);
  const email = clean(b.email, 160).toLowerCase(), name = clean(b.name, 120);
  if (!name || !EMAIL.test(email) || clean(b.phone, 40).replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'missing fields' });
  const dom = email.split('@')[1] || '';
  const company = clean(b.company, 160) || (dom && !FREE.test(dom) ? dom.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : name + ' (company to confirm)');
  await attrib.save('access', email, '', b.attribution, req);
  req.body = Object.assign({}, b, { name, email, company, hp: '' });
  req.query = Object.assign({}, req.query, { a: 'request' });
  return portal(req, res);
};
