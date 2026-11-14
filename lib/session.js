// Portal sessions and login links, signed with PORTAL_SECRET (HMAC-SHA256). No passwords are stored anywhere.
const crypto = require('crypto');
const COOKIE = 'mx_portal';
const SESSION_DAYS = 30;

// PORTAL_SECRET when set; otherwise a key derived from the Unleashed API key, which is already a server-only secret.
function secret() {
  // the environment name is mixed in, so a session made on a preview URL never works in production
  const env = process.env.VERCEL_ENV || 'dev';
  const s = process.env.PORTAL_SECRET;
  if (s && s.length >= 32) return crypto.createHash('sha256').update(env + '|' + s).digest('hex');
  const k = process.env.UNLEASHED_API_KEY;
  if (!k) throw new Error('no signing secret');
  return crypto.createHash('sha256').update('maxzz-portal-session|' + env + '|' + k).digest('hex');
}
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}
// login link: 20 minutes, single purpose
function loginToken(email) { return sign({ k: 'login', e: email, exp: Date.now() + 20 * 60 * 1000, n: crypto.randomBytes(6).toString('hex') }); }
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSession(res, email) {
  const tok = sign({ k: 's', e: email, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}
function clearSession(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); }
function sessionEmail(req) { const p = verify(readCookie(req, COOKIE)); return p && p.k === 's' ? p.e : null; }

module.exports = { loginToken, verify, setSession, clearSession, sessionEmail };
