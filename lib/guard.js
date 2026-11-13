// Basic abuse protection for the public form endpoints (quote, account).
// Origin allow-list, honeypot, minimum fill time and a best-effort per-IP rate limit.
const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const hits = new Map(); // per serverless instance; the Vercel firewall rule is the real limit
const WINDOW = 10 * 60 * 1000, MAX = 8;

function ip(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(); }

// returns null when the request may go on, or [status, body] to send back
function guard(req, b) {
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED.some((re) => re.test(origin))) return [403, { error: 'origin' }];
  if (b && b.hp) return [200, { ok: true }];                     // honeypot filled: silently drop
  if (b && typeof b.t === 'number' && b.t < 2500) return [200, { ok: true }]; // sent faster than a person can
  const key = ip(req), now = Date.now();
  const list = (hits.get(key) || []).filter((x) => now - x < WINDOW);
  if (list.length >= MAX) return [429, { error: 'too many requests' }];
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return null;
}
module.exports = { guard };
