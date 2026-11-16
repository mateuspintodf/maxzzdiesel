// Daily: refreshes tier, payment terms and stop-credit of every active portal company from Unleashed (the source of truth),
// so a price tier or a credit hold changed there takes effect in the portal within a day. Database mode only.
const db = require('../lib/db');
const PS = require('../lib/portal-store');
const { ul, configured } = require('../lib/unleashed');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!PS.on() || !configured()) return res.json({ skipped: true });
  const cos = await db.select('companies', 'select=id,unleashed_guid,tier,payment_terms,stop_credit&status=eq.active&unleashed_guid=not.is.null');
  let changed = 0, failed = 0;
  for (const c of cos) {
    try {
      const d = await ul('Customers/' + c.unleashed_guid, '', { timeoutMs: 15000 });
      const x = d && (d.Items ? d.Items[0] : d);
      if (!x || !x.CustomerCode) { failed++; continue; }
      const patch = { tier: x.SellPriceTier || null, payment_terms: x.PaymentTerm || null, stop_credit: !!x.StopCredit, tier_synced_at: new Date().toISOString() };
      if (patch.tier !== c.tier || patch.payment_terms !== c.payment_terms || patch.stop_credit !== c.stop_credit) changed++;
      await db.update('companies', 'id=eq.' + c.id, patch);
    } catch (e) { failed++; console.error('customer sync', c.id, e.message); }
  }
  if (failed) console.error('customer sync: ' + failed + ' of ' + cos.length + ' failed');
  return res.json({ ok: true, companies: cos.length, changed, failed });
};
