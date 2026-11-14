// Private JSON documents in Vercel Blob (portal data that must never be public).
const { put, head, get } = require('@vercel/blob');
const OPTS = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' };

async function readJson(name) {
  const h = await head(name).catch(() => null);
  if (!h) return null;
  const r = await get(h.url + '?v=' + encodeURIComponent(h.etag || Date.now()), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch (e) { return null; }
}
async function writeJson(name, data) { await put(name, JSON.stringify(data), OPTS); }

// small in-memory cache per function instance
const memo = {};
async function cached(name, ttlMs) {
  const m = memo[name];
  if (m && Date.now() - m.at < ttlMs) return m.data;
  const data = await readJson(name);
  memo[name] = { at: Date.now(), data };
  return data;
}

module.exports = { readJson, writeJson, cached };
