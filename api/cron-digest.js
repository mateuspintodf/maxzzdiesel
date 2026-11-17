// Scheduled (Vercel Cron): the managers' morning briefing (7:00) and evening report (18:00), Florida time. Vercel Cron runs in UTC,
// so each is scheduled at both possible UTC hours and the one that is not 7:00 / 18:00 in New York is skipped here.
// E-mail goes to the team only (DIGEST_TO, default the two managers); never to customers.
const { build, hourNY } = require('../lib/digest');
const { send } = require('../lib/mail');

const TO = () => (process.env.DIGEST_TO || 'michael@maxzzdiesel.com,marketing@maxzzdiesel.com').split(/[,\s;]+/).filter((e) => /@maxzzdiesel\.com$/i.test(e));
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  const when = req.query.when === 'pm' ? 'pm' : 'am', now = new Date();
  if (hourNY(now) !== (when === 'am' ? 7 : 18)) return res.status(200).json({ skipped: 'not the local hour' });
  try {
    const b = await build(when, now), to = TO();
    if (!to.length) return res.status(200).json({ skipped: 'no recipients' });
    const base = process.env.SITE_URL || 'https://www.maxzzdiesel.com';
    const r = await send(to, b.subject, b.title, b.html, { url: base + '/admin', label: 'Open the admin' }, { internal: true, team: true });
    console.log('cron-digest', when, JSON.stringify({ sent: !!r.sent, ai: b.ai }));
    return res.status(200).json({ ok: true, when, sent: !!r.sent, ai: b.ai });
  } catch (e) { console.error('cron-digest', e.message); return res.status(500).json({ error: 'digest failed' }); }
};
