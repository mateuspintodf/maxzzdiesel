// GET /img/p/<seo-name>.<ext>  (rewritten to /api/img?s=<seo-name>)
// Serves product photos from our own domain with a descriptive file name.
// The Vercel CDN caches each file for a year; the origin copy is fetched once per region.
const photos = require('../data/photos.json');
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

module.exports = async (req, res) => {
  const s = String((req.query && req.query.s) || '').replace(/\.(webp|png|jpg)$/, '');
  const p = photos[s];
  if (!p) return res.status(404).end('not found');
  try {
    const r = await fetch(p.url);
    if (!r.ok) return res.status(502).end('bad gateway');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', TYPES[p.ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).end('bad gateway');
  }
};
