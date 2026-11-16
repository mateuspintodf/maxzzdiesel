// Private check that the database and the secrets are wired up. Needs the CRON_SECRET; reveals no values.
const db = require('../lib/db');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const cs = process.env.CRON_SECRET || '';
  if (!cs || req.headers.authorization !== 'Bearer ' + cs) return res.status(401).json({ error: 'auth' });
  const out = { supabaseUrl: !!process.env.SUPABASE_URL, serviceKey: !!process.env.SUPABASE_SERVICE_KEY, cronSecret: true, portalSecret: String(process.env.PORTAL_SECRET || '').length >= 32 };
  try {
    const seq = await db.select('sequences', 'select=name,value');
    out.db = 'ok'; out.sequences = seq.length;
  } catch (e) { out.db = 'error'; out.error = String(e.message).slice(0, 160); }
  return res.status(out.db === 'ok' ? 200 : 503).json(out);
};
