// POST /api/track  beacon for the behaviour log. First-party only, no cookies of its own: the browser sends a random visitor id.
// Writes are best effort and never block the page. Kept 12 months (api/cron-customers.js calls purge_old_events).
const db = require('../lib/db');
const PS = require('../lib/portal-store');
const SDB = require('../lib/sessions-db');
const { clean, readBody } = require('../lib/validate');

const TYPES = new Set(['page', 'product', 'search', 'cart_add', 'cart_remove', 'cart_view', 'checkout', 'order', 'quote', 'login', 'voucher', 'filter', 'click']);
const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const device = (ua) => (/ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop');
const dec = (v) => { try { return v ? decodeURIComponent(v) : null; } catch { return null; } };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  const o = req.headers.origin || ''; if (o && !ALLOWED.some((re) => re.test(o))) return res.status(403).end();
  if (!PS.on()) return res.status(204).end();
  try {
    if (await SDB.limited(req, 'track', 240, 10 * 60 * 1000)) return res.status(429).end();
    const b = readBody(req), list = (Array.isArray(b.events) ? b.events : [b]).slice(0, 20);
    const vid = clean(b.visitor, 40); if (!/^[a-z0-9-]{8,40}$/i.test(vid)) return res.status(400).end();
    let uid = null, cid = null;
    const s = await SDB.lookup(req, 'customer').catch(() => null);
    if (s) { const u = (await db.select('users', 'select=id,company_id&email=eq.' + encodeURIComponent(s.email) + '&limit=1'))[0]; if (u) { uid = u.id; cid = u.company_id; } }
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawl|spider|headless|preview/i.test(ua)) return res.status(204).end();
    const geo = { country: clean(req.headers['x-vercel-ip-country'], 4) || null, region: clean(dec(req.headers['x-vercel-ip-country-region']), 60) || null, city: clean(dec(req.headers['x-vercel-ip-city']), 80) || null };
    const utm = b.utm && typeof b.utm === 'object' ? Object.fromEntries(['source', 'medium', 'campaign', 'term', 'content'].filter((k) => b.utm[k]).map((k) => [k, clean(b.utm[k], 80)])) : null;
    const rows = list.filter((e) => e && TYPES.has(e.type)).map((e) => ({
      visitor_id: vid, session_id: clean(b.session, 40) || null, user_id: uid, company_id: cid, type: e.type,
      path: clean(e.path, 200) || null, code: clean(e.code, 60) || null,
      qty: Number.isFinite(+e.qty) ? Math.min(99999, Math.max(0, Math.floor(+e.qty))) : null,
      value: Number.isFinite(+e.value) ? Math.round(+e.value * 100) / 100 : null,
      query: clean(e.query, 120) || null, props: e.props && typeof e.props === 'object' ? JSON.parse(JSON.stringify(e.props).slice(0, 800)) : {},
      utm: utm && Object.keys(utm).length ? utm : null, referrer: clean(b.referrer, 120) || null, device: device(ua), ...geo,
    }));
    if (rows.length) await db.insert('events', rows);
    return res.status(204).end();
  } catch (e) { console.error('track', e.message); return res.status(204).end(); }
};
