// Scheduled (Vercel Cron, every 5 minutes): starts the e-mail campaigns that are due and keeps sending the ones in progress.
const E = require('../lib/email-engine');
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    const base = process.env.SITE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://www.maxzzdiesel.com' : 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));
    const out = await E.tick(45000, base);
    if (out.length) console.log('cron-email', JSON.stringify(out));
    return res.status(200).json({ ok: true, campaigns: out });
  } catch (e) { console.error('cron-email', e.message); return res.status(500).json({ error: 'failed' }); }
};
