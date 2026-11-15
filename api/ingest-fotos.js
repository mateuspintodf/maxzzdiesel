// TEMPORARY: copies new product photos listed in data/ingest.json into the public Blob store. Remove after use.
const { put } = require('@vercel/blob');
const photos = require('../data/photos.json');
const list = require('../data/ingest.json');
module.exports = async (req, res) => {
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const batch = list.slice(offset, offset + limit);
  const out = { total: list.length, offset, failed: [], count: 0 };
  let i = 0;
  async function worker() {
    while (i < batch.length) {
      const s = batch[i++]; const p = photos[s];
      try {
        const r = await fetch(p.url);
        if (!r.ok) throw new Error('src ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        await put('p/' + s + '.' + p.ext, buf, { access: 'public', token: process.env.FOTOS_READ_WRITE_TOKEN, addRandomSuffix: false, allowOverwrite: true, contentType: 'image/webp', cacheControlMaxAge: 31536000 });
        out.count++;
      } catch (e) { out.failed.push(s + ': ' + e.message); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  out.next = offset + limit < list.length ? offset + limit : null;
  res.status(200).json(out);
};
