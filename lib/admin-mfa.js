// Second sign-in step for the admin: authenticator app (TOTP, RFC 6238), passkeys (WebAuthn) and recovery codes.
// The person picks the method. Secrets never leave the server in clear: the TOTP secret is stored encrypted
// (AES-256-GCM, key derived from PORTAL_SECRET), recovery codes and trusted-device tokens only as sha256.
const crypto = require('crypto');
const db = require('./db');

const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
const enc = (email) => encodeURIComponent(String(email).toLowerCase());

// ---- encryption of the TOTP secret
function key() {
  const s = process.env.PORTAL_SECRET || '';
  if (s.length < 16) throw new Error('PORTAL_SECRET is missing');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(s), Buffer.from('maxzz-admin-mfa'), Buffer.from('totp-secret'), 32));
}
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const out = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), out.toString('base64url')].join('.');
}
function open(box) {
  const p = String(box || '').split('.'); if (p[0] !== 'v1' || p.length !== 4) return null;
  try { const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(p[1], 'base64url')); d.setAuthTag(Buffer.from(p[2], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(p[3], 'base64url')), d.final()]).toString('utf8'); } catch (e) { return null; }
}

// ---- TOTP
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32decode(s) { let bits = 0, val = 0; const out = []; for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function hotp(secret, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(b).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
// accepts the code of the current 30 s window and one window on each side (clock drift)
function totpOk(secret, code, now) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6) return false;
  const t = Math.floor((now || Date.now()) / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(hotp(secret, t + d)), Buffer.from(code)));
}
const newSecret = () => b32encode(crypto.randomBytes(20));
const otpauth = (secret, email) => 'otpauth://totp/' + encodeURIComponent('Maxzz Admin:' + email) + '?secret=' + secret + '&issuer=' + encodeURIComponent('Maxzz Admin') + '&algorithm=SHA1&digits=6&period=30';

// ---- recovery codes: 8 codes of 10 characters, shown once, kept as hashes
function newRecovery() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = Array.from({ length: 8 }, () => { const r = crypto.randomBytes(10); let s = ''; for (const b of r) s += A[b % A.length]; return s.slice(0, 5) + '-' + s.slice(5); });
  return { codes, hashes: codes.map((c) => sha(c.replace(/-/g, ''))) };
}

// ---- state per admin
async function state(email) {
  const m = (await db.select('admin_mfa', 'select=*&email=eq.' + enc(email) + '&limit=1'))[0] || null;
  const pk = await db.select('admin_passkeys', 'select=id,name,created_at,last_used_at,transports&email=eq.' + enc(email) + '&order=created_at.asc');
  return { row: m, totp: !!(m && m.totp_on && m.totp_enc), passkeys: pk, recoveryLeft: m && Array.isArray(m.recovery) ? m.recovery.length : 0 };
}
async function saveRow(email, patch) {
  const cur = (await db.select('admin_mfa', 'select=email&email=eq.' + enc(email) + '&limit=1'))[0];
  if (cur) return db.update('admin_mfa', 'email=eq.' + enc(email), Object.assign({ updated_at: iso(Date.now()) }, patch));
  return db.insert('admin_mfa', [Object.assign({ email: String(email).toLowerCase() }, patch)]);
}
async function useRecovery(email, code) {
  const m = (await db.select('admin_mfa', 'select=recovery&email=eq.' + enc(email) + '&limit=1'))[0];
  const h = sha(String(code || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (!m || !Array.isArray(m.recovery) || !m.recovery.includes(h)) return false;
  await db.update('admin_mfa', 'email=eq.' + enc(email), { recovery: m.recovery.filter((x) => x !== h), updated_at: iso(Date.now()) });
  return true;
}

// ---- trusted computer: 30 days, cookie bound to one admin
const TRUST = 'mx_admin_trust', TRUST_MS = 30 * 864e5;
function readCookie(req, name) { const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '=')); return m ? decodeURIComponent(m.slice(name.length + 1)) : null; }
async function trusted(req, email) {
  const t = readCookie(req, TRUST); if (!t || t.length > 100) return false;
  const r = (await db.select('admin_trusted', 'select=email,expires_at&token_hash=eq.' + sha(t) + '&limit=1'))[0];
  return !!(r && r.email === String(email).toLowerCase() && Date.parse(r.expires_at) > Date.now());
}
async function trust(req, res, email) {
  const t = crypto.randomBytes(32).toString('base64url');
  await db.insert('admin_trusted', [{ token_hash: sha(t), email: String(email).toLowerCase(), expires_at: iso(Date.now() + TRUST_MS), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) || null }]);
  return `${TRUST}=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRUST_MS / 1000}`;
}
async function forgetTrusted(email) { await db.remove('admin_trusted', 'email=eq.' + enc(email)); }

// ---- WebAuthn relying party from the host: one passkey works on www and apex; previews get their own
function rp(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  const id = /(^|\.)maxzzdiesel\.com$/.test(host) ? 'maxzzdiesel.com' : host;
  return { id, origin: (host === 'localhost' ? 'http://' + host + ':' + (String(req.headers.host || '').split(':')[1] || '') : 'https://' + host).replace(/:$/, ''), name: 'Maxzz Admin' };
}

module.exports = { seal, open, newSecret, otpauth, totpOk, hotp, newRecovery, state, saveRow, useRecovery, trusted, trust, forgetTrusted, rp, sha };
