// TEMPORARY: copies the mirrored product photos (data/photos.json) into the public Blob store. Remove after migration.
const { put } = require('@vercel/blob');
const photos = require('../data/photos.json');
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
module.exports = async (req, res) => {
  const keys = Object.keys(photos).sort();
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const batch = keys.slice(offset, offset + limit);
  const out = { total: keys.length, offset, done: [], failed: [] };
  let i = 0;
  async function worker() {
    while (i < batch.length) {
      const s = batch[i++]; const p = photos[s];
      try {
        const r = await fetch(p.url);
        if (!r.ok) throw new Error('src ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const b = await put('p/' + s + '.' + p.ext, buf, { access: 'public', token: process.env.FOTOS_READ_WRITE_TOKEN, addRandomSuffix: false, allowOverwrite: true, contentType: TYPES[p.ext] || 'application/octet-stream', cacheControlMaxAge: 31536000 });
        out.done.push(b.url);
      } catch (e) { out.failed.push(s + ': ' + e.message); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  out.next = offset + limit < keys.length ? offset + limit : null;
  out.sample = out.done[0] || null; delete out.done; out.count = batch.length - out.failed.length;
  res.status(200).json(out);
};
