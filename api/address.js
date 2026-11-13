// POST /api/address
// Street address autocomplete through Google Places API (New). The key stays on the server (GOOGLE_PLACES_KEY).
//   { q, session, regions?, near? }  -> { items: [{ id, main, sub }] }
//   { id, session }                  -> { street, city, state, zip, country }
// Without the key it answers 503 and the quote form keeps working with manual entry.
const { clean, readBody } = require('../lib/validate');

const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const hits = new Map();
const WINDOW = 10 * 60 * 1000, MAX = 120; // typing makes several calls per address
const REGION = /^[A-Z]{2}$/;

function ip(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(); }
function limited(req) {
  const key = ip(req), now = Date.now();
  const list = (hits.get(key) || []).filter((x) => now - x < WINDOW);
  if (list.length >= MAX) return true;
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const origin = req.headers.origin || '';
  if (!ALLOWED.some((re) => re.test(origin))) return res.status(403).json({ error: 'origin' });
  const KEY = process.env.GOOGLE_PLACES_KEY;
  if (!KEY) return res.status(503).json({ error: 'not configured' });
  if (limited(req)) return res.status(429).json({ error: 'too many requests' });

  const b = readBody(req);
  const session = clean(b.session, 64).replace(/[^A-Za-z0-9-]/g, '');
  try {
    if (b.id) {
      const id = clean(b.id, 300).replace(/[^A-Za-z0-9_-]/g, '');
      const r = await fetch('https://places.googleapis.com/v1/places/' + id + (session ? '?sessionToken=' + session : ''), {
        headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'addressComponents' }
      });
      if (!r.ok) return res.status(502).json({ error: 'lookup failed' });
      const x = await r.json();
      const get = (t, short) => { const c = (x.addressComponents || []).find((a) => (a.types || []).includes(t)); return c ? (short ? c.shortText : c.longText) || '' : ''; };
      const street = [get('street_number'), get('route', true)].filter(Boolean).join(' ');
      return res.json({
        street, sub: get('subpremise'),
        city: get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_2'),
        state: get('administrative_area_level_1', true), zip: get('postal_code'), country: get('country', true)
      });
    }
    const q = clean(b.q, 160);
    if (q.length < 3) return res.json({ items: [] });
    const body = { input: q, languageCode: 'en', includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'] };
    if (session) body.sessionToken = session;
    const regions = (Array.isArray(b.regions) ? b.regions : []).map((s) => String(s).toUpperCase()).filter((s) => REGION.test(s)).slice(0, 15);
    if (regions.length) body.includedRegionCodes = regions;
    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY }, body: JSON.stringify(body)
    });
    if (!r.ok) return res.status(502).json({ error: 'lookup failed' });
    const x = await r.json();
    const items = (x.suggestions || []).map((s) => s.placePrediction).filter(Boolean).slice(0, 5).map((p) => ({
      id: p.placeId, main: p.structuredFormat?.mainText?.text || p.text?.text || '', sub: p.structuredFormat?.secondaryText?.text || ''
    }));
    return res.json({ items });
  } catch (e) {
    return res.status(502).json({ error: 'lookup failed' });
  }
};
