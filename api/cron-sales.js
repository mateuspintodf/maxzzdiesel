// Scheduled (Vercel Cron, every 5 minutes (near real time with the ERP)): sales history from Unleashed into Supabase for the admin dashboard. See lib/sales-sync.js.
const { run } = require('../lib/sales-sync');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    const out = await run(240 * 1000);
    console.log('cron-sales', JSON.stringify(out));
    return res.status(out.error ? 503 : 200).json(out);
  } catch (e) {
    console.error('cron-sales', e.message);
    return res.status(500).json({ error: 'sync failed' });
  }
};
