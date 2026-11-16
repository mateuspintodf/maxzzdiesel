// Server-side sessions kept in Supabase (table sessions). The cookie holds a random value; only its sha256 is stored,
// so a database leak cannot be replayed. Every request checks the row: revoked, idle and absolute expiry.
// Customer: 30 days idle (sliding), 90 days absolute. Admin: 1 hour idle, 8 hours absolute.
const crypto = require('crypto');
const db = require('./db');

const RULES = { customer: { idle: 30 * 864e5, abs: 90 * 864e5, cookie: 'mx_portal' }, admin: { idle: 3600e3, abs: 8 * 3600e3, cookie: 'mx_admin' } };
const PREFIX = 'db.';
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64) || null;

async function create(req, res, kind, email, userId) {
  const r = RULES[kind], now = Date.now(), tok = crypto.randomBytes(32).toString('base64url');
  await db.insert('sessions', [{ token_hash: hash(tok), kind, email, user_id: userId || null, idle_expires_at: iso(now + r.idle), abs_expires_at: iso(now + r.abs),
    ip: ipOf(req), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) || null }]);
  const maxAge = Math.floor((kind === 'admin' ? r.abs : r.abs) / 1000);
  res.setHeader('Set-Cookie', `${r.cookie}=${PREFIX}${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearCookie(res, kind) { res.setHeader('Set-Cookie', `${RULES[kind].cookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); }

// returns { id, email, userId, kind } for a live session of that kind, or null
async function lookup(req, kind) {
  const raw = readCookie(req, RULES[kind].cookie);
  if (!raw || raw.indexOf(PREFIX) !== 0 || raw.length > 200) return null;
  const rows = await db.select('sessions', 'select=*&token_hash=eq.' + hash(raw.slice(PREFIX.length)) + '&kind=eq.' + kind + '&limit=1');
  const s = rows[0], now = Date.now();
  if (!s || s.revoked_at || Date.parse(s.idle_expires_at) < now || Date.parse(s.abs_expires_at) < now) return null;
  // slide the idle window, at most once a minute to keep writes low
  if (now - Date.parse(s.last_seen_at) > 60e3) {
    const idle = Math.min(now + RULES[kind].idle, Date.parse(s.abs_expires_at));
    db.update('sessions', 'id=eq.' + s.id, { last_seen_at: iso(now), idle_expires_at: iso(idle) }).catch(() => {});
  }
  return { id: s.id, email: String(s.email).toLowerCase(), userId: s.user_id, kind };
}
async function end(req, res, kind) {
  const raw = readCookie(req, RULES[kind].cookie);
  if (raw && raw.indexOf(PREFIX) === 0) await db.update('sessions', 'token_hash=eq.' + hash(raw.slice(PREFIX.length)), { revoked_at: iso(Date.now()), revoked_by: 'self' }).catch(() => {});
  clearCookie(res, kind);
}
// an admin cuts a person off: every open session of that e-mail dies now
async function revokeEmail(email, by, kind) {
  await db.update('sessions', 'email=eq.' + encodeURIComponent(email) + '&revoked_at=is.null' + (kind ? '&kind=eq.' + kind : ''), { revoked_at: iso(Date.now()), revoked_by: by || 'admin' });
}

// ---- sign-in links: random nonce, consumed only by a confirmation POST (mail scanners that open links cannot use it)
async function newLink(email, kind, ttlMs) {
  const nonce = crypto.randomBytes(24).toString('base64url');
  await db.insert('login_links', [{ nonce: hash(nonce), email, kind: kind || 'customer', expires_at: iso(Date.now() + (ttlMs || 20 * 60e3)) }]);
  return nonce;
}
async function peekLink(nonce) {
  if (!nonce || nonce.length > 100) return null;
  const r = (await db.select('login_links', 'select=*&nonce=eq.' + hash(nonce) + '&limit=1'))[0];
  return r && !r.used_at && Date.parse(r.expires_at) > Date.now() ? { email: String(r.email).toLowerCase(), kind: r.kind } : null;
}
// atomic single use: the update only matches while used_at is still null
async function useLink(nonce) {
  if (!nonce || nonce.length > 100) return null;
  const r = await db.update('login_links', 'nonce=eq.' + hash(nonce) + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(iso(Date.now())), { used_at: iso(Date.now()) });
  return r && r[0] ? { email: String(r[0].email).toLowerCase(), kind: r[0].kind } : null;
}

// ---- persistent rate limit
async function limited(req, key, max, windowMs) {
  const k = key + '|' + ipOf(req), since = iso(Date.now() - windowMs);
  const rows = await db.select('rate_hits', 'select=id&key=eq.' + encodeURIComponent(k) + '&at=gte.' + encodeURIComponent(since) + '&limit=' + max);
  if (rows.length >= max) return true;
  await db.insert('rate_hits', [{ key: k }]);
  return false;
}

module.exports = { create, lookup, end, clearCookie, revokeEmail, newLink, peekLink, useLink, limited, PREFIX, RULES, readCookie };
