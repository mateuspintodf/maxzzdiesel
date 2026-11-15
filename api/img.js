// Serves product photos at /img/p/<seo-slug>.<ext>. Source of truth: the public Blob store (p/<slug>.<ext>);
// falls back to the original CDN URL listed in data/photos.json if the blob is missing.
const photos = require('../data/photos.json');
const BLOB = 'https://bdznwjpmjxyavudx.public.blob.vercel-storage.com/p/';
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
module.exports = async (req, res) => {
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
