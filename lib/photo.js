// Which photo a part has, in the order the portal uses: the bench photo (4:3, made for the store) and then the
// Unleashed one. The bench list lives in js/portal-app.js (one place to maintain); it is read from there.
const fs = require('fs');
const path = require('path');
const photos = require('../data/photos.json');
const BLOB = 'https://bdznwjpmjxyavudx.public.blob.vercel-storage.com/p/';
let BENCH = null;
function bench() {
  if (BENCH) return BENCH;
  const m = {};
  try {
    const s = fs.readFileSync(path.join(process.cwd(), 'js', 'portal-app.js'), 'utf8'), a = s.indexOf('var BENCH = {'), b = a < 0 ? -1 : s.indexOf('\n  };', a);
    if (b > a) { const re = /'([^']+)':\s*'\/img\/p\/([^']+?)\.(?:webp|png|jpg)'/g, seg = s.slice(a, b); let x; while ((x = re.exec(seg))) if (photos[x[2]]) m[x[1]] = x[2]; }
  } catch (e) { console.error('bench photos', e.message); }
  if (!Object.keys(m).length) Object.keys(photos).forEach((slug) => { if (photos[slug].code) m[photos[slug].code] = slug; }); // older list, one part per photo
  return (BENCH = m);
}
// the addresses to try for one part, best first; items = portal/products.json items (Unleashed photo in .img)
function sources(code, items) {
  const out = [], slug = bench()[code], p = slug && photos[slug];
  if (p) { out.push(BLOB + slug + '.' + p.ext); if (/^https:\/\//.test(p.url || '')) out.push(p.url); }
  const u = items && items[code] && items[code].img; if (u && /^https:\/\//.test(u)) out.push(u);
  return out;
}
const has = (code, items) => sources(code, items).length > 0;
module.exports = { bench, sources, has };
