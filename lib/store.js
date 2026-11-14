// Private JSON documents in Vercel Blob (portal data that must never be public).
const { put, head, get } = require('@vercel/blob');
const OPTS = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' };

// Returns null only when the document does not exist. Any other failure throws, so callers never
// mistake an outage for an empty document and overwrite real data.
async function readJson(name) {
  let h;
  try { h = await head(name); } catch (e) {
    if (e && (e.name === 'BlobNotFoundError' || /not.?found|does not exist/i.test(e.message || ''))) return null;
    throw e;
  }
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) throw new Error('blob read failed: ' + name);
  return JSON.parse(await new Response(r.stream).text());
}
async function writeJson(name, data) { await put(name, JSON.stringify(data), OPTS); }

// small in-memory cache per function instance
const memo = {};
async function cached(name, ttlMs) {
  const m = memo[name];
  if (m && Date.now() - m.at < ttlMs) return m.data;
  try {
    const data = await readJson(name);
    memo[name] = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (m) return m.data; // serve the last good copy during an outage
    throw e;
  }
}

module.exports = { readJson, writeJson, cached };

// Sequential document numbers (MXO-10001 orders, MXQ-10001 quotes). Low volume, so a read-increment-write
// on one small blob is enough; a random suffix is added only if the counter cannot be read.
async function nextNumber(kind) {
  const name = 'portal/seq.json', prefix = kind === 'order' ? 'MXO-' : 'MXQ-';
  try {
    const s = (await readJson(name)) || { order: 10000, quote: 10000 };
    s[kind] = (s[kind] || 10000) + 1;
    await writeJson(name, s);
    return prefix + s[kind];
  } catch (e) {
    return prefix + Date.now().toString(36).toUpperCase();
  }
}
module.exports.nextNumber = nextNumber;
