// Product photos.
// /img/p/<seo-slug>.<ext>  the photo as stored (public Blob store p/<slug>.<ext>, or the original address in data/photos.json).
// /api/img?c=<part>&s=xs|s|m|l  the photo of one part inside a fixed 4:3 box, as JPEG. Made for e-mail: every picture has
// the same shape, so the product grids never break, and JPEG opens in every mail program (the store photos are WebP).
// A part without photo gets a plain grey box of the same shape. Only parts of our own lists are served.
const photos = require('../data/photos.json');
const BLOB = 'https://bdznwjpmjxyavudx.public.blob.vercel-storage.com/p/';
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
const SIZES = { xs: [144, 108], s: [280, 210], m: [400, 300], l: [640, 480], xl: [1248, 936] };
const BG = '#f4f5f6';
const empty = (w, h) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 400 300"><rect width="400" height="300" fill="${BG}"/><g fill="none" stroke="#c3c8ce" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="150" y="110" width="100" height="80" rx="12"/><circle cx="182" cy="140" r="9"/><path d="M158 182l30-28 22 20 14-12 22 20"/></g></svg>`);
async function boxed(req, res) {
  const code = String(req.query.c || '').slice(0, 80), [w, h] = SIZES[req.query.s] || SIZES.m;
  const PH = require('../lib/photo'), { cached } = require('../lib/store');
  let items = null; if (!PH.bench()[code]) { const prod = await cached('portal/products.json', 10 * 60 * 1000).catch(() => null); items = prod && prod.items; }
  const src = PH.sources(code, items);
  let sharp; try { sharp = require('sharp'); } catch (e) { sharp = null; }
  if (!sharp) { if (src[0]) { res.setHeader('Cache-Control', 'public, max-age=300'); return res.redirect(302, src[0]); } return res.status(404).end('not found'); }
  let buf = null;
  for (const u of src) { try { const r = await fetch(u); if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); break; } } catch (e) { /* next address */ } }
  try {
    const img = buf ? sharp(buf, { failOn: 'none' }).rotate().resize(w, h, { fit: req.query.s === 'xl' ? 'cover' : 'contain', background: BG }).flatten({ background: BG }) : sharp(empty(w, h));
    const out = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', buf ? 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400' : 'public, max-age=3600, s-maxage=3600');
    return res.status(200).send(out);
  } catch (e) {
    console.error('img box', code, e.message);
    if (src[0]) { res.setHeader('Cache-Control', 'public, max-age=300'); return res.redirect(302, src[0]); }
    return res.status(502).end('bad gateway');
  }
}
module.exports = async (req, res) => {
  if (req.query && req.query.c) return boxed(req, res);
  const s = String((req.query && req.query.s) || '').replace(/\.(webp|png|jpg)$/, '');
  const p = photos[s];
  if (!p) return res.status(404).end('not found');
  try {
    let r = await fetch(BLOB + s + '.' + p.ext);
    if (!r.ok) r = await fetch(p.url);
    if (!r.ok) return res.status(502).end('bad gateway');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', TYPES[p.ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) { return res.status(502).end('bad gateway'); }
};
