// Shared state for the social media approval page (/agenda). Protected by middleware.js (DASH_PASSWORD).
// One private JSON blob per collection: agenda/<collection>.json = { <docId>: {...fields} }
// GET  /api/agenda?c=fila            -> { docs: {...} }
// POST /api/agenda {c, id, op, data} -> op 'set' replaces, 'update' merges
const { put, get, head } = require('@vercel/blob');

const COLS = new Set(['aprovacoes', 'fila', 'historico', 'stories']);
const ID = /^[A-Za-z0-9_\-.:@+]{1,120}$/;

async function readCol(c) {
  // head() hits the metadata API (always fresh); the cache-busting query makes get() skip stale CDN copies.
  const h = await head(`agenda/${c}.json`).catch((e) => {
    if (e && /not ?found/i.test(String(e.name) + ' ' + String(e.message))) return null;
    throw e;
  });
  if (!h) return { docs: {}, etag: null };
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return { docs: {}, etag: h.etag || null };
  const text = await new Response(r.stream).text();
  let docs = {};
  try { docs = JSON.parse(text) || {}; } catch (e) {}
  return { docs, etag: h.etag || null };
}

async function writeCol(c, docs, etag) {
  const opts = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' };
  if (etag) opts.ifMatch = etag;
  await put(`agenda/${c}.json`, JSON.stringify(docs), opts);
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const c = String((req.query && req.query.c) || '');
      if (!COLS.has(c)) return res.status(400).json({ error: 'bad collection' });
      const { docs } = await readCol(c);
      return res.status(200).json({ docs });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const { c, id, op, data } = b || {};
      if (!COLS.has(c) || !ID.test(id || '') || !['set', 'update'].includes(op) || !data || typeof data !== 'object') {
        return res.status(400).json({ error: 'bad request' });
      }
      if (JSON.stringify(data).length > 20000) return res.status(413).json({ error: 'too large' });
      for (let i = 0; i < 4; i++) {
        const { docs, etag } = await readCol(c);
        docs[id] = op === 'set' ? data : { ...(docs[id] || {}), ...data };
        try { await writeCol(c, docs, etag); return res.status(200).json({ ok: true }); }
        catch (e) {
          console.error('agenda write retry', e && e.name, e && e.message);
          if (!(e && /precondition|etag|412/i.test(String(e.name) + ' ' + String(e.message)))) throw e;
          await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
        }
      }
      return res.status(409).json({ error: 'busy, try again' });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('agenda error', e && e.name, e && e.message);
    return res.status(500).json({ error: 'storage error' });
  }
};
