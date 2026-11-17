// Lead attribution: stores where a lead came from (UTM, click ids, referrer, landing page) in lead_attribution.
// Best effort. It never throws and never blocks the request that called it.
const db = require('./db');
const { clean } = require('./validate');

function touch(t) {
  if (!t || typeof t !== 'object') return null;
  const o = {};
  ['source', 'medium', 'campaign', 'term', 'content', 'gclid', 'fbclid', 'msclkid', 'ttclid', 'ref', 'landing'].forEach((k) => { const v = clean(t[k], 300); if (v) o[k] = v; });
  const ts = Number(t.t || t.ts); if (ts > 0) o.t = Math.round(ts);
  return Object.keys(o).length ? o : null;
}

async function save(kind, email, ref, attribution, req) {
  try {
    const a = attribution && typeof attribution === 'object' ? attribution : {};
    const first = touch(a.first), last = touch(a.last);
    const h = (req && req.headers) || {};
    const device = /mobile|android|iphone/i.test(String(h['user-agent'] || '')) ? 'mobile' : 'desktop';
    const row = { kind: clean(kind, 20), email: clean(email, 160).toLowerCase() || null, ref: clean(ref, 60) || null, first, last, device, country: clean(h['x-vercel-ip-country'], 4) || null };
    await db.insert('lead_attribution', row);
  } catch (e) { /* never block the lead */ }
}

module.exports = { save, touch };
