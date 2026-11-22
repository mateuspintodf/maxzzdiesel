// Admin API, separate from the customer portal: own cookie (mx_admin), own session rules (1 h idle, 8 h absolute),
// own people table (admins). Works only with PORTAL_DB=1. /api/admin?a=<action>
const crypto = require('crypto');
const db = require('../lib/db');
const PS = require('../lib/portal-store');
const SDB = require('../lib/sessions-db');
const MFA = require('../lib/admin-mfa');
const { ul, configured } = require('../lib/unleashed');
const { send, esc, layout, customerMailOn, internalTo, pilotTo } = require('../lib/mail');
const mailMode = () => (customerMailOn() ? true : String(process.env.CUSTOMER_MAIL || '').toLowerCase() === 'pilot' ? 'pilot' : false);
const MAIL_OFF = 'Customer e-mails are off or in pilot mode and this address is not in the pilot list. Nothing was sent.';
const { EMAIL, clean, readBody } = require('../lib/validate');

const ALLOWED = [/^https:\/\/(www\.)?maxzzdiesel\.com$/, /^https:\/\/(admin\.)?maxzzdiesel\.com$/, /^https:\/\/maxzzdiesel(-[a-z0-9-]+)?\.vercel\.app$/];
const originOk = (req) => { const o = req.headers.origin || ''; return !o || ALLOWED.some((re) => re.test(o)); };
const envAdmins = () => String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
const base = (req) => process.env.SITE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://www.maxzzdiesel.com' : 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));

// who may sign in: the admins table, plus the old PORTAL_ADMINS variable as a bootstrap (as superadmins)
async function adminRole(email) {
  const r = await db.select('admins', 'select=role,active&email=eq.' + encodeURIComponent(email) + '&limit=1');
  if (r[0]) return r[0].active ? r[0].role : null;
  return envAdmins().includes(email) ? 'superadmin' : null;
}
async function who(req, res) {
  const s = await SDB.lookup(req, 'admin');
  const role = s && (await adminRole(s.email));
  if (!role) { res.status(401).json({ error: 'login' }); return null; }
  if (!s.mfaAt) { res.status(401).json({ error: 'mfa' }); return null; } // signed in by e-mail, second step still missing
  return { email: s.email, role, sid: s.id };
}
// a session that passed the e-mail link, with or without the second step (only the sign-in steps accept it)
async function whoPending(req, res) {
  const s = await SDB.lookup(req, 'admin');
  const role = s && (await adminRole(s.email));
  if (!role) { res.status(401).json({ error: 'login' }); return null; }
  return { email: s.email, role, sid: s.id, verified: !!s.mfaAt, challenge: s.challenge, challengeAt: s.challengeAt };
}
const can = (w, ...roles) => w.role === 'superadmin' || roles.includes(w.role);

const A = {};
// a PostgREST in() list of text values, quoted and URL-encoded (part codes can carry #, +, &, spaces, commas)
const inList = (vals) => 'in.(' + vals.map((v) => encodeURIComponent('"' + String(v).replace(/["\\]/g, '') + '"')).join(',') + ')';

A.login = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (await SDB.limited(req, 'admin-login', 5, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  if (await adminRole(email)) {
    const nonce = await SDB.newLink(email, 'admin');
    const me = (await db.select('admins', 'select=first_name,name&email=eq.' + encodeURIComponent(email) + '&limit=1').catch(() => []))[0] || {};
    const nm = String(me.first_name || me.name || '').trim();
    await send(email, 'Your Maxzz admin sign-in link', 'Sign in to Maxzz admin',
      '<p>Click the button below to sign in. The link works once and expires in 20 minutes. Once you are in, the session ends after 1 hour without activity.</p><p style="margin:14px 0 0;color:#6b6b74;font-size:13px">If you did not ask for this, you can ignore this e-mail. Nobody can sign in without it.</p>',
      { url: base(req) + '/admin?lt=' + encodeURIComponent(nonce), label: 'Click to sign in' }, nm ? { name: nm, team: true } : { greet: true, team: true });
  }
  return res.json({ ok: true }); // same answer for everyone
};
A.confirm = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  if (await SDB.limited(req, 'admin-confirm', 20, 15 * 60 * 1000)) return res.status(429).json({ error: 'too many requests' });
  const link = await SDB.useLink(clean(readBody(req).t, 100));
  if (!link || link.kind !== 'admin' || !(await adminRole(link.email))) return res.status(400).json({ error: 'link' });
  // a computer the person chose to trust in the last 30 days skips the second step
  const skip = await MFA.trusted(req, link.email).catch(() => false);
  await SDB.create(req, res, 'admin', link.email, null, skip ? { mfa_at: new Date().toISOString() } : {});
  await PS.audit(link.email, 'admin.login', 'admin', link.email, null, { second_step: skip ? 'trusted computer' : 'pending' });
  return res.json({ ok: true });
};
// ---------------------------------------------------------------- second sign-in step (authenticator app, passkey, recovery code)
const WA = () => require('@simplewebauthn/server');
const nowIso = () => new Date().toISOString();
const origins = (req) => { const r = MFA.rp(req); return r.id === 'maxzzdiesel.com' ? ['https://www.maxzzdiesel.com', 'https://maxzzdiesel.com'] : [r.origin]; };
async function passed(req, res, w, method, wantTrust) {
  await db.update('sessions', 'id=eq.' + w.sid, { mfa_at: nowIso(), mfa_challenge: null, mfa_challenge_at: null });
  if (wantTrust) res.setHeader('Set-Cookie', await MFA.trust(req, res, w.email));
  await PS.audit(w.email, 'admin.second_step', 'admin', w.email, null, { method, trusted: !!wantTrust });
}
async function freshRecovery(email) { const r = MFA.newRecovery(); await MFA.saveRow(email, { recovery: r.hashes }); return r.codes; }
const tooMany = (req, email) => SDB.limited(req, 'admin-mfa|' + email, 6, 15 * 60 * 1000);
// adding or changing a method: allowed while setting up the first one, or once fully signed in
const canEnroll = (w, st) => w.verified || (!st.totp && !st.passkeys.length);

A.mfa = async (req, res) => {
  const w = await whoPending(req, res); if (!w) return;
  const st = await MFA.state(w.email);
  return res.json({ email: w.email, verified: w.verified, totp: st.totp, passkeys: st.passkeys.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })), recoveryLeft: st.recoveryLeft, need: st.totp || st.passkeys.length ? 'verify' : 'setup' });
};
A['mfa-totp-start'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoPending(req, res); if (!w) return;
  const st = await MFA.state(w.email); if (!canEnroll(w, st)) return res.status(403).json({ error: 'Sign in with your current method first.' });
  const secret = MFA.newSecret(), uri = MFA.otpauth(secret, w.email);
  await MFA.saveRow(w.email, { totp_pending_enc: MFA.seal(secret) });
  const qr = await require('qrcode').toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d2126', light: '#ffffff' } });
  return res.json({ ok: true, secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr });
};
A['mfa-totp-confirm'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoPending(req, res); if (!w) return;
  if (await tooMany(req, w.email)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const b = readBody(req), st = await MFA.state(w.email); if (!canEnroll(w, st)) return res.status(403).json({ error: 'Sign in with your current method first.' });
  const secret = st.row && MFA.open(st.row.totp_pending_enc);
  if (!secret) return res.status(400).json({ error: 'Start again: the setup expired.' });
  if (!MFA.totpOk(secret, b.code)) return res.status(400).json({ error: 'That code did not match. Check the time on your phone and try the newest code.' });
  await MFA.saveRow(w.email, { totp_enc: MFA.seal(secret), totp_pending_enc: null, totp_on: true });
  const codes = st.recoveryLeft ? null : await freshRecovery(w.email);
  if (!w.verified) await passed(req, res, w, 'authenticator (setup)', !!b.trust);
  else await PS.audit(w.email, 'admin.mfa_totp_on', 'admin', w.email);
  return res.json({ ok: true, recovery: codes });
};
A['mfa-verify'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoPending(req, res); if (!w) return;
  if (await tooMany(req, w.email)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const b = readBody(req), st = await MFA.state(w.email);
  if (b.method === 'recovery') {
    if (!(await MFA.useRecovery(w.email, b.code))) return res.status(400).json({ error: 'That recovery code is not valid or was already used.' });
    await passed(req, res, w, 'recovery code', !!b.trust);
    return res.json({ ok: true, recoveryLeft: Math.max(0, st.recoveryLeft - 1) });
  }
  const secret = st.totp && MFA.open(st.row.totp_enc);
  if (!secret || !MFA.totpOk(secret, b.code)) return res.status(400).json({ error: 'That code did not match. Use the newest code in your app.' });
  await passed(req, res, w, 'authenticator', !!b.trust);
  return res.json({ ok: true });
};
A['mfa-passkey-options'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoPending(req, res); if (!w) return;
  const b = readBody(req), st = await MFA.state(w.email), rp = MFA.rp(req), wa = WA();
  let opts;
  if (b.mode === 'register') {
    if (!canEnroll(w, st)) return res.status(403).json({ error: 'Sign in with your current method first.' });
    opts = await wa.generateRegistrationOptions({ rpName: rp.name, rpID: rp.id, userName: w.email, userDisplayName: w.email, userID: Buffer.from(MFA.sha(w.email).slice(0, 32)), attestationType: 'none',
      excludeCredentials: st.passkeys.map((p) => ({ id: p.id, transports: p.transports || undefined })), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } });
  } else {
    if (!st.passkeys.length) return res.status(400).json({ error: 'No passkey on this account yet.' });
    opts = await wa.generateAuthenticationOptions({ rpID: rp.id, userVerification: 'preferred', allowCredentials: st.passkeys.map((p) => ({ id: p.id, transports: p.transports || undefined })) });
  }
  await db.update('sessions', 'id=eq.' + w.sid, { mfa_challenge: opts.challenge, mfa_challenge_at: nowIso() });
  return res.json({ ok: true, options: opts });
};
A['mfa-passkey-finish'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await whoPending(req, res); if (!w) return;
  if (await tooMany(req, w.email)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
  const b = readBody(req), rp = MFA.rp(req), wa = WA();
  if (!w.challenge || Date.now() - Date.parse(w.challengeAt) > 5 * 60e3) return res.status(400).json({ error: 'The request expired. Try again.' });
  await db.update('sessions', 'id=eq.' + w.sid, { mfa_challenge: null, mfa_challenge_at: null }); // one use
  const st = await MFA.state(w.email);
  try {
    if (b.mode === 'register') {
      if (!canEnroll(w, st)) return res.status(403).json({ error: 'Sign in with your current method first.' });
      const v = await wa.verifyRegistrationResponse({ response: b.response, expectedChallenge: w.challenge, expectedOrigin: origins(req), expectedRPID: rp.id, requireUserVerification: false });
      if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: 'The passkey could not be checked. Try again.' });
      const c = v.registrationInfo.credential;
      await db.insert('admin_passkeys', [{ id: c.id, email: w.email, public_key: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter || 0, transports: c.transports || null, name: clean(b.name, 60) || 'Passkey' }]);
      const codes = st.recoveryLeft ? null : await freshRecovery(w.email);
      if (!w.verified) await passed(req, res, w, 'passkey (setup)', !!b.trust);
      else await PS.audit(w.email, 'admin.mfa_passkey_on', 'admin', w.email, null, { name: clean(b.name, 60) || 'Passkey' });
      return res.json({ ok: true, recovery: codes });
    }
    const pk = st.passkeys.find((p) => p.id === String((b.response || {}).id || ''));
    const row = pk && (await db.select('admin_passkeys', 'select=*&id=eq.' + encodeURIComponent(pk.id) + '&limit=1'))[0];
    if (!row) return res.status(400).json({ error: 'That passkey is not on this account.' });
    const v = await wa.verifyAuthenticationResponse({ response: b.response, expectedChallenge: w.challenge, expectedOrigin: origins(req), expectedRPID: rp.id, requireUserVerification: false,
      credential: { id: row.id, publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')), counter: Number(row.counter) || 0, transports: row.transports || undefined } });
    if (!v.verified) return res.status(400).json({ error: 'The passkey could not be checked. Try again.' });
    await db.update('admin_passkeys', 'id=eq.' + encodeURIComponent(row.id), { counter: v.authenticationInfo.newCounter || 0, last_used_at: nowIso() });
    await passed(req, res, w, 'passkey', !!b.trust);
    return res.json({ ok: true });
  } catch (e) { console.error('passkey', e.message); return res.status(400).json({ error: 'The passkey could not be checked. Try again.' }); }
};
// managing your own methods (fully signed in)
A['mfa-manage'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  const b = readBody(req), st = await MFA.state(w.email), methods = (st.totp ? 1 : 0) + st.passkeys.length;
  if (b.op === 'recovery') { const codes = await freshRecovery(w.email); await PS.audit(w.email, 'admin.mfa_recovery_new', 'admin', w.email); return res.json({ ok: true, recovery: codes }); }
  if (b.op === 'forget-computers') { await MFA.forgetTrusted(w.email); await PS.audit(w.email, 'admin.mfa_trust_cleared', 'admin', w.email); return res.json({ ok: true }); }
  if (b.op === 'remove-passkey') {
    if (methods < 2) return res.status(409).json({ error: 'Add another method before removing your last one.' });
    await db.remove('admin_passkeys', 'id=eq.' + encodeURIComponent(String(b.id || '')) + '&email=eq.' + encodeURIComponent(w.email));
    await PS.audit(w.email, 'admin.mfa_passkey_off', 'admin', w.email); return res.json({ ok: true });
  }
  if (b.op === 'remove-totp') {
    if (methods < 2) return res.status(409).json({ error: 'Add another method before removing your last one.' });
    await MFA.saveRow(w.email, { totp_enc: null, totp_on: false, totp_pending_enc: null });
    await PS.audit(w.email, 'admin.mfa_totp_off', 'admin', w.email); return res.json({ ok: true });
  }
  if (b.op === 'rename-passkey') { await db.update('admin_passkeys', 'id=eq.' + encodeURIComponent(String(b.id || '')) + '&email=eq.' + encodeURIComponent(w.email), { name: clean(b.name, 60) || 'Passkey' }); return res.json({ ok: true }); }
  return res.status(400).json({ error: 'op' });
};
// a superadmin clears someone's second step (lost phone): they set it up again at the next sign-in
A['mfa-reset'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin can do this.' });
  const email = clean(readBody(req).email, 160).toLowerCase(); if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  await db.remove('admin_mfa', 'email=eq.' + encodeURIComponent(email)); await db.remove('admin_passkeys', 'email=eq.' + encodeURIComponent(email)); await MFA.forgetTrusted(email);
  await SDB.revokeEmail(email, w.email, 'admin');
  await PS.audit(w.email, 'admin.mfa_reset', 'admin', email);
  return res.json({ ok: true });
};

A.logout = async (req, res) => { if (req.method !== 'POST') return res.status(405).json({ error: 'method' }); await SDB.end(req, res, 'admin'); return res.json({ ok: true }); };
const TEAM_PH = (() => { try { return require('../lib/team-photos.json'); } catch (e) { return {}; } })(); // starter photos, a photo saved in the admin wins
A.me = async (req, res) => { const w = await who(req, res); if (!w) return; const a = (await db.select('admins', 'select=salesperson,name,first_name,last_name,phone,photo,screens&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0] || {}; return res.json(Object.assign({}, w, { mailOn: mailMode(), salesperson: a.salesperson || null, name: a.name || null, first_name: a.first_name || null, last_name: a.last_name || null, phone: a.phone || null, photo: a.photo || TEAM_PH[w.email] || null, screens: w.role === 'superadmin' ? null : (Array.isArray(a.screens) ? a.screens : null) })); };

// companies with their people, newest first, pending on top
A.list = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const d = await PS.loadDb();
  const users = Object.values(d.users);
  const rank = (s) => (s === 'pending' ? 0 : 1);
  const accounts = Object.values(d.accounts).map((a) => Object.assign({}, a, { users: users.filter((u) => u.account === a.id).map((u) => ({ email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status })) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || b.created - a.created);
  const live = await db.select('sessions', 'select=email,kind,last_seen_at&revoked_at=is.null&idle_expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&abs_expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
  const open = {}; live.filter((x) => x.kind === 'customer').forEach((x) => { const e = String(x.email).toLowerCase(); open[e] = (open[e] || 0) + 1; });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ accounts, openSessions: open, ordersLive: process.env.PORTAL_ORDERS_LIVE === '1' });
};
A.lookup = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const code = clean(req.query.code, 40);
  if (!code) return res.status(400).json({ error: 'code' });
  const q = /^[A-Za-z0-9._ -]+$/.test(code) ? 'customerCode=' + encodeURIComponent(code) : 'customer=' + encodeURIComponent(code);
  // Unleashed signs the decoded query: a name with spaces, & or @ gets 403 when the encoded form is signed
  const qq = q + '&pageSize=10'; let data;
  try { data = await ul('Customers', qq, { timeoutMs: 30000, sign: decodeURIComponent(qq) }); }
  catch (e) { try { data = await ul('Customers', qq, { timeoutMs: 30000 }); } catch (e2) { console.error('admin lookup', e2.message); return res.status(502).json({ error: 'Unleashed did not answer the search. Try the customer code instead of the name.' }); } }
  return res.json({ customers: (data.Items || []).slice(0, 10).map((c) => ({ code: c.CustomerCode, name: c.CustomerName, tier: c.SellPriceTier || '', guid: c.Guid, stopCredit: !!c.StopCredit, terms: c.PaymentTerm || '' })) });
};
A.approve = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), c = b.customer || {};
  const d = await PS.loadDb();
  const acc = d.accounts[clean(b.account, 60)];
  if (!acc) return res.status(404).json({ error: 'account' });
  if (!c.code || !c.guid) return res.status(400).json({ error: 'pick the Unleashed customer first' });
  let cust = null;
  if (configured()) {
    const guid = clean(c.guid, 60);
    if (!/^[0-9a-f-]{36}$/i.test(guid)) return res.status(400).json({ error: 'customer' });
    const data = await ul('Customers/' + guid, '', { timeoutMs: 30000 });
    cust = data && (data.Items ? data.Items[0] : data);
    if (!cust || !cust.CustomerCode) return res.status(404).json({ error: 'Unleashed customer not found' });
  }
  const code = cust ? cust.CustomerCode : clean(c.code, 40);
  const other = Object.values(d.accounts).find((a) => a.id !== acc.id && a.status === 'approved' && a.customerCode === code);
  if (other) return res.status(409).json({ error: 'Customer ' + code + ' is already linked to ' + other.company + '.' });
  Object.assign(acc, { status: 'approved', customerCode: code, customerGuid: cust ? cust.Guid : clean(c.guid, 60), customerName: cust ? cust.CustomerName : clean(c.name, 160), tier: cust ? (cust.SellPriceTier || '') : clean(c.tier, 60),
    terms: cust ? (cust.PaymentTerm || '') : '', stopCredit: cust ? !!cust.StopCredit : false, approvedBy: w.email, approvedAt: Date.now() });
  try { await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, ['pending', 'rejected'], 'approved'); }
  catch (e) { console.error('admin approve', e.message); return res.status(409).json({ error: 'Could not save. The customer code may already be linked.' }); }
  await PS.audit(w.email, 'company.approve', 'company', acc.id, null, { code, tier: acc.tier });
  const people = Object.values(d.users).filter((u) => u.account === acc.id);
  for (const u of people) await send(u.email, 'Your Maxzz B2B portal access is ready', 'Welcome to the Maxzz B2B portal',
    `<p>Your account for <b>${esc(acc.company)}</b> is approved. You can now see your prices and stock, place orders and track them.</p>`,
    { url: base(req) + '/portal', label: 'Open the portal' }, { name: u.name, greet: true }).catch((e) => console.error('mail', e.message));
  return res.json({ ok: true });
};
A.reject = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), d = await PS.loadDb();
  const acc = d.accounts[clean(b.account, 60)];
  if (!acc) return res.status(404).json({ error: 'account' });
  acc.status = 'rejected'; acc.rejectedBy = w.email; acc.reason = clean(b.reason, 400);
  await PS.saveAccount(acc); await PS.setUsersStatus(acc.id, null, 'rejected');
  const people = Object.values(d.users).filter((u) => u.account === acc.id);
  for (const u of people) await SDB.revokeEmail(u.email, w.email, 'customer').catch(() => {});
  await PS.audit(w.email, 'company.reject', 'company', acc.id, null, { reason: acc.reason });
  if (b.notify) for (const u of people) await send(u.email, 'About your Maxzz B2B portal request', 'About your request',
    `<p>We could not open a portal account for ${esc(acc.company)} at this time.${acc.reason ? ' ' + esc(acc.reason) : ''}</p><p>You can still request quotes at maxzzdiesel.com/quote or reply to this e-mail.</p>`, null, { name: u.name, greet: true }).catch(() => {});
  return res.json({ ok: true });
};
// ends every open customer session of one person
A.revoke = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const email = clean(readBody(req).email, 160).toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'email' });
  await SDB.revokeEmail(email, w.email, 'customer');
  await PS.audit(w.email, 'session.revoke', 'user', email);
  return res.json({ ok: true });
};
// Invites tab: companies that are not active yet (prospects added by hand or imported), with the contact to invite
A.prospects = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const cos = await db.select('companies', 'select=*&status=in.(prospect,ready,invited)&order=created_at.desc&limit=500');
  const us = cos.length ? await db.select('users', 'select=email,name,phone,company_id,status&company_id=in.(' + cos.map((c) => c.id).join(',') + ')') : [];
  return res.json({ prospects: cos.map((c) => ({ id: c.id, company: c.name, status: c.status, source: c.source, code: c.unleashed_code || '', city: c.city || '', state: c.state || '', country: c.country || '',
    contact: [c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · '),
    users: us.filter((u) => u.company_id === c.id).map((u) => ({ email: u.email, name: u.name, phone: u.phone, status: u.status })) })) });
};
// remove prospects from the admin: only companies that never got portal access (no people who signed in, no orders or quotes).
// Their segment links and pending invite users go too. Nothing changes in Unleashed.
A['company-remove'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const ids = (Array.isArray(readBody(req).ids) ? readBody(req).ids : []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'ids' });
  const cos = await db.select('companies', 'select=id,name,status&id=in.(' + ids.join(',') + ')');
  const [us, ord, qts, vch, nts] = await Promise.all([db.select('users', 'select=company_id,last_login_at&company_id=in.(' + ids.join(',') + ')'), db.select('orders', 'select=company_id&company_id=in.(' + ids.join(',') + ')&limit=1000'), db.select('quotes', 'select=company_id&company_id=in.(' + ids.join(',') + ')&limit=1000'), db.select('vouchers', 'select=company_id&company_id=in.(' + ids.join(',') + ')&limit=1000').catch(() => []), db.select('customer_notes', 'select=company_id&company_id=in.(' + ids.join(',') + ')&limit=1000').catch(() => [])]);
  const removed = [], kept = [];
  for (const c of cos) {
    const busy = !['prospect', 'invited', 'ready', 'rejected', 'pending'].includes(c.status) || us.some((u) => u.company_id === c.id && u.last_login_at) || ord.some((o) => o.company_id === c.id) || qts.some((q) => q.company_id === c.id) || vch.some((v) => v.company_id === c.id) || nts.some((n) => n.company_id === c.id);
    if (busy) { kept.push(c.name); continue; }
    try {
      await db.remove('company_segments', 'company_id=eq.' + c.id);
      await db.remove('users', 'company_id=eq.' + c.id + '&last_login_at=is.null');
      await db.remove('companies', 'id=eq.' + c.id);
      removed.push(c.name);
    } catch (e) { kept.push(c.name); console.error('company remove', e.message); }
  }
  await PS.audit(w.email, 'company.remove', 'company', String(removed.length), null, { removed: removed.slice(0, 50), kept: kept.slice(0, 50) });
  return res.json({ ok: true, removed: removed.length, kept });
};
// Manual inclusion: a customer that is not in Unleashed yet (or that the team wants to invite first). Creates the company as a prospect
// and, when an e-mail is given, its contact (pending: it only gets in after the team approves and links it to Unleashed).
A.addprospect = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const f = { company: clean(b.company, 160), name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 40), city: clean(b.city, 80), state: clean(b.state, 60), country: clean(b.country, 60), notes: clean(b.notes, 800) };
  if (!f.company) return res.status(400).json({ error: 'Company name is required.' });
  if (f.email && !EMAIL.test(f.email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  if (f.email && (await db.select('users', 'select=id&email=eq.' + encodeURIComponent(f.email) + '&limit=1')).length) return res.status(409).json({ error: 'That e-mail already belongs to a portal user.' });
  const co = (await db.insert('companies', [{ name: f.company, city: f.city || null, state: f.state || null, country: f.country || null, notes: f.notes || null, status: 'prospect', source: 'manual' }]))[0];
  if (f.email) await db.insert('users', [{ company_id: co.id, email: f.email, name: f.name || null, phone: f.phone || null, role: 'owner', status: 'pending' }]);
  await PS.audit(w.email, 'prospect.add', 'company', co.id, null, { company: f.company });
  return res.json({ ok: true, id: co.id });
};
// ---- admin people and roles (superadmin only). PORTAL_ADMINS stays as a read-only bootstrap list of superadmins.
const ROLES = ['superadmin', 'sales', 'marketing'];
A.admins = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const rows = await db.select('admins', 'select=email,name,first_name,last_name,phone,photo,role,active,salesperson,screens,created_at,created_by&order=created_at');
  const inTable = new Set(rows.map((r) => String(r.email).toLowerCase()));
  const boot = envAdmins().filter((e) => !inTable.has(e)).map((e) => ({ email: e, name: '', role: 'superadmin', active: true, bootstrap: true }));
  const sps = [...new Set((await db.selectAll('ul_customers', 'select=salesperson&salesperson=not.is.null').catch(() => [])).map((x) => x.salesperson))].sort();
  const mf = {}; (await db.select('admin_mfa', 'select=email,totp_on').catch(() => [])).forEach((m) => { mf[m.email] = { totp: !!m.totp_on, pk: 0 }; });
  (await db.select('admin_passkeys', 'select=email').catch(() => [])).forEach((p) => { (mf[p.email] = mf[p.email] || { totp: false, pk: 0 }).pk++; });
  const last = {}; (await db.select('audit_log', 'select=admin_email,at&action=eq.admin.login&order=at.desc&limit=300').catch(() => [])).forEach((x) => { const e = String(x.admin_email || '').toLowerCase(); if (e && !last[e]) last[e] = x.at; });
  return res.json({ admins: rows.map((r) => Object.assign(r, { email: String(r.email).toLowerCase() })).map((r) => Object.assign(r, { photo: r.photo || TEAM_PH[r.email] || null })).concat(boot).map((r) => Object.assign(r, { mfa: mf[r.email] || { totp: false, pk: 0 }, last_login: last[r.email] || null })), roles: ROLES, salespeople: sps, screens: SCREENS });
};
A['profile-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  const b = readBody(req);
  const row = (await db.select('admins', 'select=email&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0];
  if (!row) return res.status(400).json({ error: 'Your login comes from a server setting, so it has no profile row. Ask a superadmin to add you under Admin users.' });
  const fn = clean(b.first_name, 60), ln = clean(b.last_name, 60), ph = clean(b.phone, 40);
  const patch = { first_name: fn || null, last_name: ln || null, phone: ph || null, name: [fn, ln].filter(Boolean).join(' ') || null, updated_at: new Date().toISOString() };
  if (typeof b.photo === 'string') {
    if (b.photo !== '' && !(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) && b.photo.length <= 90000)) return res.status(400).json({ error: 'The photo is too big or not a JPG, PNG or WebP image.' });
    patch.photo = b.photo || null;
  }
  await db.update('admins', 'email=eq.' + encodeURIComponent(w.email), patch);
  await PS.audit(w.email, 'admin.profile', 'admin', w.email, null, { name: patch.name });
  return res.json({ ok: true });
};
A['admin-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const email = clean(b.email, 160).toLowerCase(), role = clean(b.role, 20), active = b.active !== false;
  const fn = clean(b.first_name, 60), ln = clean(b.last_name, 60), ph = clean(b.phone, 40), name = clean(b.name, 120) || [fn, ln].filter(Boolean).join(' ');
  const photo = typeof b.photo === 'string' ? (b.photo === '' ? '' : /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) && b.photo.length <= 90000 ? b.photo : null) : undefined;
  if (photo === null) return res.status(400).json({ error: 'The photo is too big or not a JPG, PNG or WebP image.' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role' });
  if (email === w.email && (!active || role !== 'superadmin')) return res.status(400).json({ error: 'You cannot remove your own superadmin access.' });
  const scr = b.screens === undefined ? undefined : (Array.isArray(b.screens) ? [...new Set(b.screens.map((x) => String(x)).filter((x) => SCREENS.includes(x)))] : null);
  const before = (await db.select('admins', 'select=*&email=eq.' + encodeURIComponent(email) + '&limit=1'))[0] || null;
  await db.insert('admins', [{ email, role, name: name || null, first_name: fn || null, last_name: ln || null, phone: ph || null, ...(photo === undefined ? {} : { photo: photo || null }), ...(scr === undefined ? {} : { screens: role === 'superadmin' ? null : scr }), active, salesperson: clean(b.salesperson, 120) || null, created_by: before ? before.created_by : w.email, updated_at: new Date().toISOString() }], { onConflict: 'email' });
  if (!active || (before && before.role !== role)) await SDB.revokeEmail(email, w.email, 'admin').catch(() => {}); // new rights start at the next sign-in
  await PS.audit(w.email, before ? 'admin.update' : 'admin.create', 'admin', email, before && { role: before.role, active: before.active }, { role, active });
  scrMemo.delete(email);
  return res.json({ ok: true });
};
// invite one or more people by e-mail: they get the admin role you pick and an e-mail pointing at the admin sign-in
A['admin-invite'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req), role = clean(b.role, 20);
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Pick a role.' });
  const list = [...new Set(String(b.emails || '').toLowerCase().split(/[\s,;]+/).filter(Boolean))].slice(0, 20);
  if (!list.length) return res.status(400).json({ error: 'Type at least one e-mail address.' });
  const bad = list.filter((e) => !EMAIL.test(e));
  if (bad.length) return res.status(400).json({ error: 'These do not look like e-mail addresses: ' + bad.join(', ') });
  const scr = role === 'superadmin' || b.screens == null ? undefined : (Array.isArray(b.screens) ? [...new Set(b.screens.map((x) => String(x)).filter((x) => SCREENS.includes(x)))] : undefined);
  const sp = clean(b.salesperson, 120) || null, out = { invited: [], skipped: [], mailed: 0 };
  const me = (await db.select('admins', 'select=name,first_name&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0] || {};
  const by = String(me.first_name || me.name || w.email).trim();
  for (const email of list) {
    if (await adminRole(email)) { out.skipped.push(email); continue; }
    await db.insert('admins', [{ email, role, active: true, salesperson: sp, ...(scr === undefined ? {} : { screens: scr }), created_by: w.email, updated_at: new Date().toISOString() }], { onConflict: 'email' });
    await PS.audit(w.email, 'admin.create', 'admin', email, null, { role, active: true, invited: true });
    scrMemo.delete(email);
    out.invited.push(email);
    const r = await send(email, 'You were invited to the Maxzz admin', 'You are invited', '<p>' + esc(by) + ' added you to the Maxzz admin as <b>' + esc(role) + '</b>.</p><p>Open the admin, type this e-mail address and we send you a sign-in link. No password needed.</p>', { url: base(req) + '/admin', label: 'Open the admin' }, { greet: true, team: true }).catch(() => ({}));
    if (r && r.sent) out.mailed++;
  }
  return res.json(Object.assign({ ok: true }, out));
};
// ---------------------------------------------------------------- Unleashed import into segments
const addrOf = (c) => { const a = (c.Addresses || []).find((x) => /physical|street/i.test(x.AddressType || '')) || (c.Addresses || [])[0] || {}; return { city: a.City || '', state: a.Region || '', country: a.Country || '' }; };
async function allCustomers() {
  const out = [], seen = new Set();
  for (let page = 1; page <= 20; page++) {
    // Unleashed pages by path (Customers/2); a pageNumber in the query is ignored and returns page 1 again
    const d = await ul('Customers/' + page, 'pageSize=500', { timeoutMs: 40000 });
    (d.Items || []).forEach((c) => { if (!seen.has(c.Guid)) { seen.add(c.Guid); out.push(c); } });
    if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
  }
  return out;
}
// codes of customers with at least one sales order since a date (used by the "bought in the last N months" filter)
async function buyersSince(months) {
  const since = new Date(Date.now() - months * 30.44 * 864e5).toISOString().slice(0, 10), codes = new Set();
  for (let page = 1; page <= 40; page++) {
    const d = await ul('SalesOrders/' + page, 'orderStatus=Completed,Placed,Parked,Backordered&startDate=' + since + '&pageSize=200', { timeoutMs: 40000 });
    (d.Items || []).forEach((o) => { if (o.Customer && o.Customer.CustomerCode) codes.add(o.Customer.CustomerCode); });
    if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
  }
  return codes;
}
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
async function selectCustomers(f) {
  f = f || {};
  let rows = (await allCustomers()).filter((c) => c.CustomerCode && !c.Obsolete);
  const tiers = list(f.tiers), types = list(f.types), countries = list(f.countries), states = list(f.states), q = String(f.name || '').trim().toLowerCase();
  if (tiers.length) rows = rows.filter((c) => tiers.includes(String(c.SellPriceTier || '').toLowerCase()));
  if (types.length) rows = rows.filter((c) => types.includes(String(c.CustomerType || '').toLowerCase()));
  if (countries.length) rows = rows.filter((c) => countries.includes(addrOf(c).country.toLowerCase()));
  if (states.length) rows = rows.filter((c) => states.includes(addrOf(c).state.toLowerCase()));
  if (q) rows = rows.filter((c) => (c.CustomerName + ' ' + c.CustomerCode).toLowerCase().includes(q));
  if (f.hasEmail) rows = rows.filter((c) => EMAIL.test(String(c.Email || '').trim()));
  const m = parseInt(f.boughtWithinMonths, 10);
  if (m > 0) { const buyers = await buyersSince(Math.min(m, 120)); rows = rows.filter((c) => buyers.has(c.CustomerCode)); }
  const nb = parseInt(f.notBoughtWithinMonths, 10);
  if (nb > 0) { const buyers = await buyersSince(Math.min(nb, 120)); rows = rows.filter((c) => !buyers.has(c.CustomerCode)); }
  return rows;
}
const facet = (rows, fn) => { const m = {}; rows.forEach((c) => { const k = fn(c) || '(none)'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 40); };
A['import-preview'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const rows = await selectCustomers(readBody(req).filters);
  const have = new Set((await db.select('companies', 'select=unleashed_code&unleashed_code=not.is.null')).map((r) => r.unleashed_code));
  return res.json({ total: rows.length, alreadyInPortal: rows.filter((c) => have.has(c.CustomerCode)).length, withEmail: rows.filter((c) => EMAIL.test(String(c.Email || '').trim())).length,
    tiers: facet(rows, (c) => c.SellPriceTier), types: facet(rows, (c) => c.CustomerType), countries: facet(rows, (c) => addrOf(c).country),
    sample: rows.slice(0, 15).map((c) => ({ code: c.CustomerCode, name: c.CustomerName, tier: c.SellPriceTier || '', type: c.CustomerType || '', email: c.Email || '', city: addrOf(c).city, country: addrOf(c).country })) });
};
async function segmentByName(name, by) {
  const e = encodeURIComponent(name);
  const f = (await db.select('segments', 'select=*&name=eq.' + e + '&limit=1'))[0];
  return f || (await db.insert('segments', [{ name, created_by: by }]))[0];
}
A.import = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  const b = readBody(req), segName = clean(b.segment, 80);
  if (!segName) return res.status(400).json({ error: 'Give the segment a name (for example Rebuilders).' });
  const rows = await selectCustomers(b.filters);
  if (!rows.length) return res.status(400).json({ error: 'No customer matches these filters.' });
  const seg = await segmentByName(segName, w.email);
  await db.update('segments', 'id=eq.' + seg.id, { rules: b.filters || {} });
  const existing = {}; (await db.select('companies', 'select=id,unleashed_code&unleashed_code=not.is.null')).forEach((r) => { existing[r.unleashed_code] = r.id; });
  const fresh = rows.filter((c) => !existing[c.CustomerCode]);
  for (let i = 0; i < fresh.length; i += 100) {
    const made = await db.insert('companies', fresh.slice(i, i + 100).map((c) => { const a = addrOf(c); return { name: c.CustomerName || c.CustomerCode, unleashed_code: c.CustomerCode, unleashed_guid: /^[0-9a-f-]{36}$/i.test(c.Guid || '') ? c.Guid : null,
      tier: c.SellPriceTier || null, payment_terms: c.PaymentTerm || null, stop_credit: !!c.StopCredit, customer_type: c.CustomerType || null, city: a.city || null, state: a.state || null, country: a.country || null,
      status: 'prospect', source: 'unleashed_import', contact_email: String(c.Email || '').trim().toLowerCase() || null, contact_name: [c.ContactFirstName, c.ContactLastName].filter(Boolean).join(' ') || null, contact_phone: c.PhoneNumber || null, tier_synced_at: new Date().toISOString() }; }));
    made.forEach((m) => { existing[m.unleashed_code] = m.id; });
  }
  const links = rows.map((c) => ({ company_id: existing[c.CustomerCode], segment_id: seg.id, added_by: w.email })).filter((l) => l.company_id);
  for (let i = 0; i < links.length; i += 200) await db.insert('company_segments', links.slice(i, i + 200), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  await PS.audit(w.email, 'import.run', 'segment', seg.id, null, { segment: segName, matched: rows.length, created: fresh.length });
  return res.json({ ok: true, segment: segName, matched: rows.length, created: fresh.length, alreadyThere: rows.length - fresh.length });
};
A.segments = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const segs = await db.select('segments', 'select=*&order=name');
  const links = await db.selectAll('company_segments', 'select=segment_id,company_id');
  const ids = [...new Set(links.map((l) => l.company_id))];
  const st = {}; for (let i = 0; i < ids.length; i += 150) (await db.select('companies', 'select=id,status&id=in.(' + ids.slice(i, i + 150).join(',') + ')')).forEach((c) => { st[c.id] = c.status; });
  return res.json({ segments: segs.map((g) => { const m = links.filter((l) => l.segment_id === g.id); const by = {}; m.forEach((l) => { const k = st[l.company_id] || '?'; by[k] = (by[k] || 0) + 1; });
    return { id: g.id, name: g.name, description: g.description || '', invite_subject: g.invite_subject || '', invite_body: g.invite_body || '', members: m.length, byStatus: by }; }) });
};
A['segment-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), name = clean(b.name, 80);
  if (!name) return res.status(400).json({ error: 'name' });
  const patch = { description: clean(b.description, 300) || null, invite_subject: clean(b.invite_subject, 150) || null, invite_body: clean(b.invite_body, 4000) || null };
  const seg = await segmentByName(name, w.email);
  await db.update('segments', 'id=eq.' + seg.id, patch);
  await PS.audit(w.email, 'segment.save', 'segment', seg.id, null, { name });
  return res.json({ ok: true });
};
// move companies in or out of a segment by hand
A['segment-members'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), ids = (Array.isArray(b.companies) ? b.companies : []).map((x) => clean(x, 60)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  const seg = (await db.select('segments', 'select=id,name&id=eq.' + clean(b.segment, 60) + '&limit=1'))[0];
  if (seg && b.remove && b.all) { await db.remove('company_segments', 'segment_id=eq.' + seg.id); await PS.audit(w.email, 'segment.clear', 'segment', seg.id, null, { name: seg.name }); return res.json({ ok: true }); }
  if (!seg || !ids.length) return res.status(400).json({ error: 'segment' });
  if (b.remove) await db.remove('company_segments', 'segment_id=eq.' + seg.id + '&company_id=in.(' + ids.join(',') + ')');
  else await db.insert('company_segments', ids.map((c) => ({ company_id: c, segment_id: seg.id, added_by: w.email })), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  return res.json({ ok: true });
};

// delete a segment: the companies stay (as prospects or customers), only the grouping and its invite text go
A['segment-delete'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const id = clean(readBody(req).id, 60);
  const seg = (await db.select('segments', 'select=id,name&id=eq.' + id + '&limit=1'))[0];
  if (!seg) return res.status(404).json({ error: 'segment' });
  await db.remove('company_segments', 'segment_id=eq.' + seg.id);
  await db.remove('segments', 'id=eq.' + seg.id);
  await PS.audit(w.email, 'segment.delete', 'segment', seg.id, null, { name: seg.name });
  return res.json({ ok: true });
};
// CSV into a segment: each row is matched by Unleashed customer code, then by e-mail (Unleashed, portal people, companies).
// A row that matches nothing but has a company name becomes a prospect added by hand. Rows are parsed in the page.
A['segment-import'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), name = clean(b.name, 80), segId = clean(b.segment, 60);
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000).map((r) => ({ code: clean(r.code, 60).toUpperCase(), email: clean(r.email, 160).toLowerCase(), company: clean(r.company, 120), contact: clean(r.contact, 120), phone: clean(r.phone, 40), city: clean(r.city, 80), state: clean(r.state, 40) })).filter((r) => r.code || r.email || r.company);
  if (!rows.length) return res.status(400).json({ error: 'No usable rows. The file needs a column with the customer code, the e-mail or the company name.' });
  let seg = segId ? (await db.select('segments', 'select=id,name&id=eq.' + segId + '&limit=1'))[0] : null;
  if (!seg && !name) return res.status(400).json({ error: 'Give the segment a name.' });
  if (!seg) seg = await segmentByName(name, w.email);
  const [ul, cos, us] = await Promise.all([db.selectAll('ul_customers', 'select=*'), db.selectAll('companies', 'select=id,unleashed_code,contact_email,name'), db.selectAll('users', 'select=company_id,email')]);
  const ulByCode = {}, ulByMail = {}, coByCode = {}, coByMail = {}, coByName = {};
  ul.forEach((c) => { ulByCode[String(c.code).toUpperCase()] = c; if (c.email) String(c.email).split(/[;,\s]+/).forEach((e) => { if (e) ulByMail[e.toLowerCase()] = c; }); });
  cos.forEach((c) => { if (c.unleashed_code) coByCode[String(c.unleashed_code).toUpperCase()] = c.id; if (c.contact_email) coByMail[c.contact_email.toLowerCase()] = c.id; coByName[String(c.name || '').toLowerCase()] = c.id; });
  us.forEach((u) => { if (u.email) coByMail[u.email.toLowerCase()] = u.company_id; });
  // match first, then create in bulk (one insert per 200 companies) so a large file does not time out
  const ids = new Set(), out = { matched: 0, created: 0, unmatched: [] }, needUl = new Map(), needNew = new Map(), later = [];
  for (const r of rows) {
    let id = (r.code && coByCode[r.code]) || (r.email && coByMail[r.email]) || null;
    const u = !id ? ((r.code && ulByCode[r.code]) || (r.email && ulByMail[r.email]) || null) : null;
    if (!id && u && coByCode[String(u.code).toUpperCase()]) id = coByCode[String(u.code).toUpperCase()];
    if (!id && !u && r.company && coByName[r.company.toLowerCase()]) id = coByName[r.company.toLowerCase()];
    if (id) { ids.add(id); out.matched++; continue; }
    if (u) { const k = String(u.code).toUpperCase(); if (!needUl.has(k)) needUl.set(k, { u, r }); later.push(['ul', k]); out.matched++; continue; }
    if (r.company && (!r.email || EMAIL.test(r.email))) { const k = r.company.toLowerCase(); if (!needNew.has(k)) needNew.set(k, r); later.push(['new', k]); out.matched++; continue; }
    if (out.unmatched.length < 50) out.unmatched.push(r.code || r.email || r.company);
  }
  const ulList = [...needUl.values()], newList = [...needNew.entries()];
  for (let i = 0; i < ulList.length; i += 200) {
    const made = await db.insert('companies', ulList.slice(i, i + 200).map(({ u, r }) => ({ name: u.name || u.code, unleashed_code: u.code, unleashed_guid: u.guid, tier: u.tier, payment_terms: u.payment_terms, stop_credit: !!u.stop_credit, customer_type: u.type,
      city: u.city, state: u.state, country: u.country, salesperson: u.salesperson, status: 'prospect', source: 'csv_import', contact_email: r.email || u.email, contact_name: r.contact || u.contact_name, contact_phone: r.phone || u.phone, tier_synced_at: new Date().toISOString() })));
    made.forEach((m) => { coByCode[String(m.unleashed_code).toUpperCase()] = m.id; }); out.created += made.length;
  }
  for (let i = 0; i < newList.length; i += 200) {
    const part = newList.slice(i, i + 200);
    const made = await db.insert('companies', part.map(([, r]) => ({ name: r.company, status: 'prospect', source: 'csv_import', contact_email: r.email || null, contact_name: r.contact || null, contact_phone: r.phone || null, city: r.city || null, state: r.state || null })));
    made.forEach((m) => { coByName[String(m.name).toLowerCase()] = m.id; }); out.created += made.length;
  }
  later.forEach(([t, k]) => { const id = t === 'ul' ? coByCode[k] : coByName[k]; if (id) ids.add(id); });
  const links = [...ids].map((c) => ({ company_id: c, segment_id: seg.id, added_by: w.email }));
  for (let i = 0; i < links.length; i += 200) await db.insert('company_segments', links.slice(i, i + 200), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  await PS.audit(w.email, 'segment.import', 'segment', seg.id, null, { name: seg.name, rows: rows.length, members: ids.size, created: out.created });
  return res.json({ ok: true, id: seg.id, rows: rows.length, members: ids.size, created: out.created, unmatched: out.unmatched, unmatchedCount: rows.length - out.matched });
};

// ---------------------------------------------------------------- terms (draft until a superadmin publishes)
A.terms = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  return res.json({ terms: await db.select('terms_versions', 'select=*&order=created_at.desc') });
};
A['terms-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req), version = clean(b.version, 40), body = String(b.body || '').slice(0, 60000);
  if (!version || !body.trim()) return res.status(400).json({ error: 'version and text are required' });
  const cur = (await db.select('terms_versions', 'select=status&version=eq.' + encodeURIComponent(version) + '&limit=1'))[0];
  if (cur && cur.status !== 'draft') return res.status(409).json({ error: 'A published version cannot be edited. Save it under a new version name.' });
  await db.insert('terms_versions', [{ version, body, status: 'draft' }], { onConflict: 'version' });
  await PS.audit(w.email, 'terms.save', 'terms', version);
  return res.json({ ok: true });
};
A['terms-publish'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const version = clean(readBody(req).version, 40);
  const t = (await db.select('terms_versions', 'select=status&version=eq.' + encodeURIComponent(version) + '&limit=1'))[0];
  if (!t || t.status !== 'draft') return res.status(404).json({ error: 'draft not found' });
  await db.update('terms_versions', 'status=eq.published', { status: 'retired' });
  await db.update('terms_versions', 'version=eq.' + encodeURIComponent(version), { status: 'published', published_at: new Date().toISOString(), published_by: w.email });
  await PS.audit(w.email, 'terms.publish', 'terms', version);
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- proactive invite: one click per company, always by an admin
// tokens in the invite text, filled per company
// {{token}} or {{token|fallback}}: the fallback is used when the customer has no value for it. {{link}} is left for inviteHtml.
function fillTokens(t, v) { return String(t || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, (m, k, fb) => (k === 'link' ? m : v[k] != null && v[k] !== '' ? String(v[k]) : (fb || '').trim())); }
function tokenVals(co, name) {
  const nm = String(name || co.contact_name || '').trim();
  return { first_name: nm.split(/\s+/)[0] || '', contact_name: nm, company: co.name || '', customer_code: co.unleashed_code || '', tier: co.tier || '', salesperson: co.salesperson || '', city: co.city || '', state: co.state || '', country: co.country || '' };
}
// ready texts the team can start from (English: the portal is in English for now)
const STARTERS = [
  { k: 'standard', name: 'Invite to the portal', subject: '{{company}}, your Maxzz Diesel B2B account is ready', title: 'Your wholesale account is ready', cta: 'Open my account',
    body: 'We opened the Maxzz Diesel B2B portal for {{company}}. It is the same account you already have with us ({{customer_code}}), with your prices and payment terms, now online.\n\nIn the portal you can:\n• see your own price on the injectors, pumps and nozzles we stock\n• check live stock before you call\n• send a quote request in a few clicks\n• follow your portal orders and quotes in one place\n\nOrdering by phone or e-mail still works. {{salesperson|Our team}} is your contact for anything you need, just reply to this e-mail.' },
  { k: 'winback', name: 'We miss you (customers who stopped buying)', subject: '{{first_name|Hello}}, it has been a while', title: 'It has been a while', cta: 'See my prices',
    body: 'We have not seen an order from {{company}} in some time and wanted to make it easier to come back.\n\nYour account {{customer_code}} is now in the Maxzz Diesel B2B portal, with your prices, live stock and quote requests online. You can check availability for your next job in a minute, without waiting for a call back.\n\nIf something went wrong on your last order, tell us. {{salesperson|Our team}} will take care of it personally.' },
  { k: 'new', name: 'First contact (never bought)', subject: 'Wholesale diesel injection parts for {{company}}', title: 'Welcome to Maxzz Diesel', cta: 'Create my access',
    body: 'Maxzz Diesel supplies new and remanufactured diesel injectors, pumps and nozzles to repair shops and rebuilders across the US and Latin America.\n\nWe opened a wholesale account for {{company}} in our B2B portal so you can see trade prices, stock and lead times before you buy.\n\nAny question, reply to this e-mail and {{salesperson|our team}} will get back to you the same day.' },
];
const DEF_TPL = { subject: STARTERS[0].subject, title: STARTERS[0].title, body: STARTERS[0].body, cta: STARTERS[0].cta };
function inviteHtml(tpl, vals, url) {
  const body = fillTokens(tpl.body || DEF_TPL.body, vals).split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>').replace(/\{\{\s*link\s*\}\}/g, '<a href="' + esc(url) + '" style="color:#d32a37">' + esc(url) + '</a>') + '</p>').join('');
  return { subject: fillTokens(tpl.subject || DEF_TPL.subject, vals), title: fillTokens(tpl.title || DEF_TPL.title, vals), body: body + '<p style="color:#8a9097;font-size:13px">The link is yours and works for 14 days.</p>', cta: { url, label: fillTokens(tpl.cta || DEF_TPL.cta, vals) } };
}
async function segTemplate(coId, segId) {
  let id = segId;
  if (!id) { const l = (await db.select('company_segments', 'select=segment_id&company_id=eq.' + coId + '&limit=1'))[0]; id = l && l.segment_id; }
  const g = id ? (await db.select('segments', 'select=invite_subject,invite_title,invite_body,invite_cta&id=eq.' + id + '&limit=1'))[0] : null;
  return { subject: g && g.invite_subject, title: g && g.invite_title, body: g && g.invite_body, cta: g && g.invite_cta };
}
// one invite: creates or refreshes the person, makes a personal 14-day sign-in link and sends the segment's e-mail
async function inviteOne(req, w, co, email, name, segId) {
  if (!co.unleashed_code) return { error: 'Not linked to an Unleashed customer.' };
  if (co.status === 'active') return { error: 'Already active.' };
  email = clean(email || co.contact_email, 160).toLowerCase(); name = clean(name || co.contact_name, 120);
  if (!EMAIL.test(email)) return { error: 'No e-mail to invite.' };
  if (!customerMailOn() && !internalTo(email) && !pilotTo(email)) return { error: mailMode() === 'pilot' ? 'Not on the pilot list. Nothing was sent.' : MAIL_OFF };
  const owner = (await db.select('users', 'select=id,company_id&email=eq.' + encodeURIComponent(email) + '&limit=1'))[0];
  if (owner && owner.company_id !== co.id) return { error: 'That e-mail belongs to another company.' };
  let uid = owner && owner.id;
  if (!uid) uid = (await db.insert('users', [{ company_id: co.id, email, name: name || null, phone: co.contact_phone || null, role: 'owner', status: 'pending', invited_at: new Date().toISOString(), invited_by: w.email }]))[0].id;
  else await db.update('users', 'id=eq.' + uid, { invited_at: new Date().toISOString(), invited_by: w.email });
  const nonce = await SDB.newLink(email, 'invite', 14 * 864e5);
  const m = inviteHtml(await segTemplate(co.id, segId), tokenVals(co, name), base(req) + '/portal?iv=' + encodeURIComponent(nonce));
  const r = await send(email, m.subject, m.title, m.body, m.cta, { name, greet: true });
  if (!r || !r.sent) return { error: r && r.blocked ? MAIL_OFF : 'The e-mail service did not accept it. Nothing was sent; try again later.' };
  await db.update('companies', 'id=eq.' + co.id, { status: 'invited' });
  await PS.audit(w.email, 'invite.send', 'company', co.id, null, { email, segment: segId || null });
  return { ok: true, email, sent: !!(r && r.sent) };
}
A.invite = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.company, 60);
  const t = (await db.select('terms_versions', 'select=version&status=eq.published&limit=1'))[0];
  if (!t) return res.status(409).json({ error: 'Publish the terms before inviting anyone (Settings > Terms of use).' });
  const co = (await db.select('companies', 'select=*&id=eq.' + id + '&limit=1'))[0];
  if (!co) return res.status(404).json({ error: 'company' });
  const r = await inviteOne(req, w, co, b.email, b.name, clean(b.segment, 60) || null);
  if (r.error) return res.status(409).json(r);
  return res.json(r);
};

// ---------------------------------------------------------------- Unleashed customer directory, segments from a selection, bulk invites
A.dir = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const [rows, segs, st, tg, cs] = await Promise.all([db.rpc('dir_customers'), db.select('segments', 'select=id,name&order=name'), db.select('sales_sync', 'select=customers_at&id=eq.1'), db.selectAll('customer_tags', 'select=code,tag').catch(() => []), db.selectAll('customer_segments', 'select=code,segment,status,confidence,evidence').catch(() => [])]);
  const T = {}; tg.forEach((x) => { (T[x.code] = T[x.code] || []).push(x.tag); });
  const G = {}; cs.forEach((x) => { G[x.code] = x; });
  (rows || []).forEach((r) => { if (T[r.c]) r.tags = T[r.c]; const g = G[r.c]; if (g) { r.sg = g.segment; r.sgs = g.status; r.sgc = g.confidence; r.sge = g.evidence; } });
  return res.json({ rows: rows || [], segments: segs, synced: st[0] && st[0].customers_at });
};
A['dir-sync'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  return res.json({ ok: true, n: await require('../lib/sales-sync').syncCustomers() });
};
A['segment-create'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), name = clean(b.name, 80);
  const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 3000);
  if (!name) return res.status(400).json({ error: 'Give the segment a name.' });
  if (!codes.length) return res.status(400).json({ error: 'Select at least one customer.' });
  const seg = await segmentByName(name, w.email);
  await db.update('segments', 'id=eq.' + seg.id, { description: clean(b.description, 300) || null, rules: b.rules && typeof b.rules === 'object' ? b.rules : {} });
  const existing = {}; (await db.selectAll('companies', 'select=id,unleashed_code&unleashed_code=not.is.null')).forEach((r) => { existing[r.unleashed_code] = r.id; });
  const missing = codes.filter((c) => !existing[c]);
  for (let i = 0; i < missing.length; i += 150) {
    const ul = await db.select('ul_customers', 'select=*&code=' + inList(missing.slice(i, i + 150)));
    if (!ul.length) continue;
    const made = await db.insert('companies', ul.map((c) => ({ name: c.name || c.code, unleashed_code: c.code, unleashed_guid: c.guid, tier: c.tier, payment_terms: c.payment_terms, stop_credit: !!c.stop_credit, customer_type: c.type,
      city: c.city, state: c.state, country: c.country, salesperson: c.salesperson, status: 'prospect', source: 'unleashed_import', contact_email: c.email, contact_name: c.contact_name, contact_phone: c.phone, tier_synced_at: new Date().toISOString() })));
    made.forEach((m) => { existing[m.unleashed_code] = m.id; });
  }
  const links = codes.map((c) => ({ company_id: existing[c], segment_id: seg.id, added_by: w.email })).filter((l) => l.company_id);
  for (let i = 0; i < links.length; i += 200) await db.insert('company_segments', links.slice(i, i + 200), { onConflict: 'company_id,segment_id', ignoreDuplicates: true });
  await PS.audit(w.email, 'segment.create', 'segment', seg.id, null, { name, members: links.length, created: missing.length });
  return res.json({ ok: true, id: seg.id, members: links.length, created: missing.length });
};
// company segment (Distributor, Rebuilder, Reseller...): set by hand, or confirm what the rules and the web research suggested
const CUST_SEGS = ['Reseller', 'Rebuilder', 'Reseller/Rebuilder', 'Other'];
A['cseg-set'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 3000);
  if (!codes.length) return res.status(400).json({ error: 'codes' });
  const now = new Date().toISOString();
  if (b.segment) {
    if (CUST_SEGS.indexOf(b.segment) < 0) return res.status(400).json({ error: 'segment' });
    for (let i = 0; i < codes.length; i += 200) await db.insert('customer_segments', codes.slice(i, i + 200).map((code) => ({ code, segment: b.segment, status: 'confirmed', source: 'manual', confidence: null, evidence: null, confirmed_by: w.email, confirmed_at: now })), { onConflict: 'code' });
  } else for (let i = 0; i < codes.length; i += 150) await db.update('customer_segments', 'status=eq.suggested&code=' + inList(codes.slice(i, i + 150)), { status: 'confirmed', confirmed_by: w.email, confirmed_at: now });
  await PS.audit(w.email, 'company.segment', 'company', null, null, { segment: b.segment || 'confirmed suggestions', n: codes.length });
  return res.json({ ok: true });
};
// free tags on a customer (by Unleashed code), used as filters in the customer list
A['tags-set'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), codes = (Array.isArray(b.codes) ? b.codes : [b.code]).map((c) => clean(c, 60)).filter(Boolean).slice(0, 3000);
  const tag = clean(b.tag, 40).replace(/\s+/g, ' ').trim();
  if (!codes.length || !tag) return res.status(400).json({ error: 'tag' });
  if (b.remove) for (let i = 0; i < codes.length; i += 150) await db.remove('customer_tags', 'tag=eq.' + encodeURIComponent(tag) + '&code=' + inList(codes.slice(i, i + 150)));
  else for (let i = 0; i < codes.length; i += 500) await db.insert('customer_tags', codes.slice(i, i + 500).map((code) => ({ code, tag, added_by: w.email })), { onConflict: 'code,tag', ignoreDuplicates: true });
  return res.json({ ok: true });
};
// one segment: members and the invite template
A.segment = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const id = clean(req.query.id, 60);
  const g = (await db.select('segments', 'select=*&id=eq.' + id + '&limit=1'))[0];
  if (!g) return res.status(404).json({ error: 'segment' });
  const links = await db.selectAll('company_segments', 'select=company_id,at&segment_id=eq.' + id);
  const ids = links.map((l) => l.company_id), cos = [], users = [];
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150).join(',');
    cos.push(...(await db.select('companies', 'select=id,name,unleashed_code,status,tier,city,state,country,contact_email,contact_name,salesperson&id=in.(' + part + ')')));
    users.push(...(await db.select('users', 'select=company_id,email,name,status,invited_at,last_login_at&company_id=in.(' + part + ')')));
  }
  const terms = (await db.select('terms_versions', 'select=version&status=eq.published&limit=1'))[0];
  return res.json({ segment: { id: g.id, name: g.name, description: g.description || '', rules: g.rules || null, subject: g.invite_subject || '', title: g.invite_title || '', body: g.invite_body || '', cta: g.invite_cta || '' }, defaults: DEF_TPL, starters: STARTERS, termsPublished: !!terms, mailOn: mailMode(),
    members: cos.map((c) => { const u = users.filter((x) => x.company_id === c.id); const inv = u.map((x) => x.invited_at).filter(Boolean).sort().pop() || null;
      return { id: c.id, n: c.name, c: c.unleashed_code, status: c.status, tier: c.tier, city: c.city, state: c.state, country: c.country, email: (u[0] && u[0].email) || c.contact_email || '', contact: (u[0] && u[0].name) || c.contact_name || '', sp: c.salesperson, invited_at: inv, people: u.length, last_login: u.map((x) => x.last_login_at).filter(Boolean).sort().pop() || null }; }) });
};
A['segment-template'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  await db.update('segments', 'id=eq.' + id, { invite_subject: clean(b.subject, 150) || null, invite_title: clean(b.title, 120) || null, invite_body: String(b.body || '').slice(0, 4000) || null, invite_cta: clean(b.cta, 40) || null, ...(b.name ? { name: clean(b.name, 80) } : {}) });
  await PS.audit(w.email, 'segment.template', 'segment', id);
  return res.json({ ok: true });
};
A['invite-preview'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  const b = readBody(req);
  const co = b.company ? (await db.select('companies', 'select=*&id=eq.' + clean(b.company, 60) + '&limit=1'))[0] : null;
  const vals = co ? tokenVals(co, b.name) : { first_name: 'John', contact_name: 'John Smith', company: 'Sample Diesel LLC', customer_code: 'SAMPLE', tier: 'Tier 2', salesperson: 'Michael', city: 'Miami', state: 'FL', country: 'United States' };
  const m = inviteHtml({ subject: b.subject, title: b.title, body: b.body, cta: b.cta }, vals, base(req) + '/portal?iv=PERSONAL-LINK');
  return res.json({ subject: m.subject, to: co ? (co.contact_email || '') : 'john@sample.com', html: layout(m.title, m.body, m.cta, { name: vals.contact_name, greet: true }) });
};
// a batch of invites from a segment (the page sends 10 at a time and shows the progress)
A['segment-invite'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const t = (await db.select('terms_versions', 'select=version&status=eq.published&limit=1'))[0];
  if (!t) return res.status(409).json({ error: 'Publish the terms of use before inviting anyone.' });
  const b = readBody(req), seg = clean(b.segment, 60), ids = (Array.isArray(b.companies) ? b.companies : []).map((x) => clean(x, 60)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10);
  const cos = ids.length ? await db.select('companies', 'select=*&id=in.(' + ids.join(',') + ')') : [];
  const out = [];
  for (const co of cos) { try { out.push(Object.assign({ id: co.id, n: co.name }, await inviteOne(req, w, co, (b.emails || {})[co.id], null, seg))); } catch (e) { out.push({ id: co.id, n: co.name, error: 'Failed: ' + e.message.slice(0, 80) }); } }
  return res.json({ ok: true, results: out });
};

// ---------------------------------------------------------------- vouchers
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
A.vouchers = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const rows = await db.select('vouchers', 'select=*,companies(name)&order=created_at.desc&limit=300');
  const red = await db.selectAll('voucher_redemptions', 'select=voucher_id,discount');
  const by = {}; red.forEach((r) => { const x = by[r.voucher_id] || (by[r.voucher_id] = { n: 0, sum: 0 }); x.n++; x.sum += Number(r.discount); });
  return res.json({ vouchers: rows.map((v) => ({ ...v, company_name: v.companies && v.companies.name, uses: (by[v.id] || { n: 0 }).n, discount_total: (by[v.id] || { sum: 0 }).sum, companies: undefined })) });
};
A['voucher-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  const code = clean(b.code, 40).replace(/\s+/g, '').toUpperCase();
  const kind = b.kind === 'fixed' ? 'fixed' : 'percent', value = num(b.value);
  const starts = b.starts_at ? new Date(b.starts_at) : new Date(), expires = b.expires_at ? new Date(b.expires_at) : null;
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: 'Code: 3 to 40 letters, numbers, - or _.' });
  if (!(value > 0) || (kind === 'percent' && value > 100)) return res.status(400).json({ error: kind === 'percent' ? 'Percent must be between 0 and 100.' : 'Value must be above zero.' });
  if (!expires || isNaN(expires) || isNaN(starts)) return res.status(400).json({ error: 'Set the start and the expiry dates.' });
  if (expires <= starts) return res.status(400).json({ error: 'Expiry must be after the start.' });
  // above 15% (or a fixed amount over 15% of the minimum order) only a superadmin can create the voucher
  const CAP = Number(process.env.VOUCHER_MAX_PCT) > 0 ? Number(process.env.VOUCHER_MAX_PCT) : 15;
  if (w.role !== 'superadmin') {
    if (kind === 'percent' && value > CAP) return res.status(403).json({ error: 'Vouchers above ' + CAP + '% need a superadmin. Ask Michael or Leise.' });
    if (kind === 'fixed' && !(num(b.min_subtotal) > 0 && value <= num(b.min_subtotal) * CAP / 100)) return res.status(403).json({ error: 'A fixed voucher needs a minimum order, and the amount can be at most ' + CAP + '% of it (e.g. $' + Math.ceil(value * 100 / CAP) + ' minimum for $' + value + ' off). Above that, ask a superadmin.' });
  }
  let companyId = clean(b.company_id, 60) || null;
  if (w.role !== 'superadmin' && !clean(b.company_id, 60) && !clean(b.company_code, 40) && !(num(b.max_uses) > 0)) return res.status(400).json({ error: 'A voucher for every customer needs a total use limit (for example 50). Or pick one company.' });
  if (clean(b.company_code, 40)) {
    const co = (await db.select('companies', 'select=id&unleashed_code=eq.' + encodeURIComponent(clean(b.company_code, 40)) + '&limit=1'))[0];
    if (!co) return res.status(400).json({ error: 'No portal company with that Unleashed code. Import or approve it first.' });
    companyId = co.id;
  }
  const rec = {
    code, description: clean(b.description, 200) || null, kind, value,
    company_id: companyId,
    min_subtotal: num(b.min_subtotal) > 0 ? num(b.min_subtotal) : null,
    starts_at: starts.toISOString(), expires_at: expires.toISOString(),
    max_uses: num(b.max_uses) > 0 ? Math.floor(num(b.max_uses)) : null,
    max_uses_per_company: num(b.max_uses_per_company) > 0 ? Math.floor(num(b.max_uses_per_company)) : null,
    ...(b.active === undefined && id ? {} : { active: b.active !== false }),
  };
  try {
    if (id) { await db.update('vouchers', 'id=eq.' + id, rec); await PS.audit(w.email, 'voucher.update', 'voucher', id, null, { code }); }
    else { const r = await db.insert('vouchers', [{ ...rec, created_by: w.email }]); await PS.audit(w.email, 'voucher.create', 'voucher', r[0].id, null, { code }); }
  } catch (e) { return res.status(409).json({ error: /duplicate|unique/i.test(e.message) ? 'That code already exists.' : 'Could not save.' }); }
  return res.json({ ok: true });
};
A['voucher-toggle'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  await db.update('vouchers', 'id=eq.' + id, { active: !!b.active });
  await PS.audit(w.email, b.active ? 'voucher.on' : 'voucher.off', 'voucher', id);
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- product visibility (hidden = admin-only)
A.hidden = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  return res.json({ hidden: await db.selectAll('hidden_products', 'select=*&order=created_at.desc') });
};
A['hidden-set'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const codes = [...new Set((Array.isArray(b.codes) ? b.codes : String(b.codes || '').split(/[\s,;]+/)).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 8000);
  if (!codes.length) return res.status(400).json({ error: 'Add at least one product code.' });
  if (b.hide && codes.length > 2500) return res.status(400).json({ error: 'Hide at most 2,500 parts at a time. Filter by brand or category first.' });
  for (let i = 0; i < codes.length; i += 200) {
    const part = codes.slice(i, i + 200);
    if (b.hide) await db.insert('hidden_products', part.map((code) => ({ code, reason: clean(b.reason, 200) || null, hidden_by: w.email })), { onConflict: 'code' });
    else await db.remove('hidden_products', 'code=' + inList(part));
  }
  await PS.audit(w.email, b.hide ? 'product.hide' : 'product.show', 'product', codes.join(',').slice(0, 200), null, { n: codes.length, reason: clean(b.reason, 200) || null });
  return res.json({ ok: true, n: codes.length });
};

// real parts for the campaign preview: photo, default list price and stock
A['campaign-sample'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const codes = String(req.query.codes || '').split('|').map((c) => clean(c, 60)).filter(Boolean).slice(0, 4);
  const [prod, stock] = await Promise.all([cached('portal/products.json', 10 * 60 * 1000), cached('portal/stock.json', 10 * 60 * 1000)]);
  const out = {};
  codes.forEach((c) => { const p = prod && prod.items && prod.items[c]; out[c] = { img: p && p.img && /^https:\/\//.test(p.img) ? p.img : null, price: p && p.d > 0 ? Math.round(p.d * 100) / 100 : null, stock: stock && stock.qty ? (stock.qty[c] ?? 0) : null }; });
  return res.json({ items: out });
};
// the standard hidden list: a saved snapshot the team can go back to after a bulk change
A['hidden-standard'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  if (b.op === 'save') {
    const cur = await db.selectAll('hidden_products', 'select=code,reason');
    if (!cur.length) return res.status(409).json({ error: 'Nothing is hidden now, so there is no list to save.' });
    await db.remove('hidden_standard', 'code=not.is.null');
    for (let i = 0; i < cur.length; i += 500) await db.insert('hidden_standard', cur.slice(i, i + 500).map((r) => ({ code: r.code, reason: r.reason, saved_by: w.email })));
    await PS.audit(w.email, 'product.standard.save', 'product', String(cur.length));
    return res.json({ ok: true, n: cur.length });
  }
  if (b.op === 'restore') {
    // safe order: hide the standard parts first, then show the ones that are not in it (never a moment with the wrong parts visible)
    const std = await db.selectAll('hidden_standard', 'select=code,reason');
    if (!std.length) return res.status(409).json({ error: 'The standard list is empty. Save one first.' });
    for (let i = 0; i < std.length; i += 500) await db.insert('hidden_products', std.slice(i, i + 500).map((r) => ({ code: r.code, reason: r.reason, hidden_by: w.email })), { onConflict: 'code' });
    const keep = new Set(std.map((r) => r.code)), extra = (await db.selectAll('hidden_products', 'select=code')).map((r) => r.code).filter((c) => !keep.has(c));
    for (let i = 0; i < extra.length; i += 150) await db.remove('hidden_products', 'code=' + inList(extra.slice(i, i + 150)));
    await PS.audit(w.email, 'product.standard.restore', 'product', String(std.length));
    return res.json({ ok: true, n: std.length });
  }
  return res.status(400).json({ error: 'op' });
};
// the whole catalog for the visibility screen: every product with its classification, hidden flag, stock and 12-month sales
A['catalog-all'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const { readJson } = require('../lib/store');
  const [live, hid, stock, sales, std] = await Promise.all([readJson('catalog/live.json').catch(() => null), db.selectAll('hidden_products', 'select=code,reason,hidden_by,created_at'), readJson('portal/stock.json').catch(() => null), db.rpc('product_sales_12m').catch(() => ({})), db.selectAll('hidden_standard', 'select=code,saved_by,saved_at').catch(() => [])]);
  let rows = Array.isArray(live) && live.length ? live : JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'data', 'catalog.json'), 'utf8'));
  const FIX = require('../lib/catalog-fix'), fixed = await FIX.overrides(true), links = {};
  rows = await FIX.apply(rows);
  (await db.selectAll('product_links', 'select=code,related_code,pos&order=pos').catch(() => [])).forEach((x) => { (links[x.code] = links[x.code] || []).push(x.related_code); });
  const H = {}; hid.forEach((h) => { H[h.code] = [h.reason || '', h.hidden_by || '', h.created_at]; });
  const Q = (stock && stock.qty) || {};
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ rows: rows.map((r) => [r[0], r[1], r[3], r[4] || '', r[5] || '', r[6] || '', Q[r[0]] != null ? Number(Q[r[0]]) : null, (sales || {})[r[0]] || null, H[r[0]] || null]),
    fixed: Object.keys(fixed), links,
    standard: { n: std.length, by: std[0] ? std[0].saved_by : null, at: std[0] ? std[0].saved_at : null }, hiddenNotInCatalog: hid.filter((h) => !rows.some((r) => r[0] === h.code)).map((h) => h.code), stockAt: stock && stock.at });
};
A['behavior-companies'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  return res.json({ days, rows: (await db.rpc('dash_behavior_companies', { p_days: days })) || [] });
};
// raw event stream with filters (type, company, text), newest first
A['behavior-stream'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30)), type = clean(req.query.type, 20), cid = clean(req.query.company, 60), signed = req.query.signed === '1';
  let q = 'select=at,type,code,query,path,device,city,region,country,utm,referrer,visitor_id,company_id,user_id&type=neq.page&at=gte.' + new Date(Date.now() - days * 864e5).toISOString() + '&order=at.desc&limit=400';
  if (type) q += '&type=eq.' + encodeURIComponent(type); if (/^[0-9a-f-]{36}$/i.test(cid)) q += '&company_id=eq.' + cid; if (signed) q += '&company_id=not.is.null';
  const ev = await db.select('events', q);
  const cids = [...new Set(ev.map((e) => e.company_id).filter(Boolean))], uids = [...new Set(ev.map((e) => e.user_id).filter(Boolean))];
  const cos = cids.length ? await db.select('companies', 'select=id,name,unleashed_code&id=in.(' + cids.join(',') + ')') : [];
  const us = uids.length ? await db.select('users', 'select=id,name,email&id=in.(' + uids.join(',') + ')') : [];
  const C = {}, U = {}; cos.forEach((c) => { C[c.id] = c; }); us.forEach((u) => { U[u.id] = u; });
  const N = await names();
  return res.json({ rows: ev.map((e) => ({ at: e.at, type: e.type, code: e.code, t: e.code && N[e.code] ? N[e.code].t : '', query: e.query, device: e.device, place: [e.city, e.region, e.country].filter(Boolean).join(', '), src: (e.utm && e.utm.source) || e.referrer || '', visitor: String(e.visitor_id || '').slice(0, 6),
    company: e.company_id && C[e.company_id] ? C[e.company_id].name : '', cid: e.company_id, code_c: e.company_id && C[e.company_id] ? C[e.company_id].unleashed_code : '', person: e.user_id && U[e.user_id] ? (U[e.user_id].name || U[e.user_id].email) : '' })) });
};

// ---------------------------------------------------------------- product campaigns (badge + discount on chosen parts)
const slugify = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
A.campaigns = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const cs = await db.select('campaigns', 'select=*&order=starts_at.desc&limit=200');
  const items = cs.length ? await db.selectAll('campaign_products', 'select=campaign_id,code') : [];
  const n = {}; items.forEach((i) => { n[i.campaign_id] = (n[i.campaign_id] || 0) + 1; });
  // orders with campaign parts since the campaign started: units and value at the order price
  return res.json({ campaigns: cs.map((c) => Object.assign(c, { products: n[c.id] || 0 })) });
};
A.campaign = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const id = clean(req.query.id, 60);
  const c = (await db.select('campaigns', 'select=*&id=eq.' + id + '&limit=1'))[0];
  if (!c) return res.status(404).json({ error: 'campaign' });
  const items = await db.selectAll('campaign_products', 'select=code,value&campaign_id=eq.' + id);
  let sold = []; try {
    sold = await db.selectAll('order_lines', 'select=code,qty,price,orders!inner(created_at,status)&code=in.(' + items.slice(0, 800).map((i) => '"' + String(i.code).replace(/"/g, '') + '"').join(',') + ')&orders.created_at=gte.' + c.starts_at);
  } catch (e) { sold = []; }
  return res.json({ campaign: c, items, sold: { lines: sold.length, units: sold.reduce((a, l) => a + Number(l.qty || 0), 0), value: Math.round(sold.reduce((a, l) => a + Number(l.qty || 0) * Number(l.price || 0), 0)) } });
};
// cost floor per part: cost (average landed, else last) x (1 + margin). Admin only, never sent to the portal.
const MIN_MARGIN = () => (Number(process.env.CAMPAIGN_MIN_MARGIN) >= 0 && process.env.CAMPAIGN_MIN_MARGIN !== undefined && process.env.CAMPAIGN_MIN_MARGIN !== '' ? Number(process.env.CAMPAIGN_MIN_MARGIN) : 10);
async function floorsFor(list) {
  const out = {}; if (!list.length) return out;
  const [prod, costs] = await Promise.all([cached('portal/products.json', 10 * 60 * 1000), (async () => { const r = []; for (let i = 0; i < list.length; i += 150) r.push(...(await db.select('product_costs', 'select=code,avg_cost,last_cost&code=' + inList(list.slice(i, i + 150))))); return r; })()]);
  const m = 1 + MIN_MARGIN() / 100;
  costs.forEach((c) => { const cost = Number(c.avg_cost) > 0 ? Number(c.avg_cost) : Number(c.last_cost) > 0 ? Number(c.last_cost) : null; if (!cost) return;
    const p = prod && prod.items && prod.items[c.code], tiers = ((p && p.t) || []).concat(p && p.d ? [p.d] : []).filter((x) => x > 0);
    out[c.code] = { cost, floor: Math.ceil(cost * m * 100) / 100, low: tiers.length ? Math.min.apply(null, tiers) : null }; });
  return out;
}
async function belowFloor(codes, kind, value, stack) {
  const F = await floorsFor(codes.map((x) => x[0])), list = [], vcap = stack ? (Number(process.env.VOUCHER_MAX_PCT) > 0 ? Number(process.env.VOUCHER_MAX_PCT) : 15) : 0;
  const nocost = codes.filter((x) => !F[x[0]]).length;
  codes.forEach(([code, v]) => { const f = F[code]; if (!f) return; const pv = v != null ? v : value; let price = kind === 'price' ? pv : f.low != null ? f.low * (1 - pv / 100) : null; if (price != null && vcap) price = price * (1 - vcap / 100); if (price != null && price < f.floor) list.push({ code, floor: f.floor, price: Math.round(price * 100) / 100 }); });
  return { list, pct: MIN_MARGIN(), nocost, stacked: vcap };
}
// floors for the campaign editor (min price and max % per part), from the same rule
A['campaign-floors'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = req.method === 'POST' ? readBody(req) : {}, codes = (Array.isArray(b.codes) ? b.codes : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 6000);
  const F = await floorsFor(codes), out = {};
  Object.entries(F).forEach(([k, f]) => { out[k] = [f.floor, f.low != null && f.low > 0 ? Math.max(0, Math.floor((1 - f.floor / f.low) * 1000) / 10) : null]; });
  const st = (await db.select('sales_sync', 'select=costs_at&id=eq.1'))[0];
  return res.json({ pct: MIN_MARGIN(), floors: out, costsAt: st && st.costs_at });
};
// campaign banner: a wide image for the top of the campaign page (public photo store, same as product photos)
const BANNER_URL = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/campaigns\/[A-Za-z0-9._-]+$/;
const BANNER_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const magicOk = (buf, type) => type === 'image/png' ? buf.slice(0, 4).toString('hex') === '89504e47' : type === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
A['campaign-banner'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!process.env.FOTOS_READ_WRITE_TOKEN) return res.status(500).json({ error: 'The photo store is not set up.' });
  const b = readBody(req), type = String(b.type || ''), ext = BANNER_TYPES[type];
  if (!ext) return res.status(400).json({ error: 'Use a JPG, PNG or WebP image.' });
  const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length || buf.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: 'The image must be 1.5 MB or less.' });
  if (!magicOk(buf, type)) return res.status(400).json({ error: 'That file is not a valid ' + ext.toUpperCase() + ' image.' });
  const name = 'campaigns/' + (String(b.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign') + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  try {
    const { put } = require('@vercel/blob');
    const r = await put(name, buf, { access: 'public', token: process.env.FOTOS_READ_WRITE_TOKEN, contentType: type, addRandomSuffix: false, cacheControlMaxAge: 31536000 });
    await PS.audit(w.email, 'campaign.banner', 'campaign', clean(b.id, 60) || null, null, { url: r.url, bytes: buf.length });
    return res.status(200).json({ ok: true, url: r.url });
  } catch (e) { console.error('banner', e.message); return res.status(502).json({ error: 'Could not save the image. Try again.' }); }
};

A['campaign-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60), name = clean(b.name, 80);
  if (!name) return res.status(400).json({ error: 'Give the campaign a name.' });
  const kind = b.kind === 'price' ? 'price' : 'percent', value = num(b.value);
  if (kind === 'percent' && !(value > 0 && value < 100)) return res.status(400).json({ error: 'The discount must be between 1 and 99%.' });
  const starts = b.starts_at ? new Date(b.starts_at) : new Date(), ends = b.ends_at ? new Date(b.ends_at) : null;
  if (!ends || isNaN(ends) || isNaN(starts) || ends <= starts) return res.status(400).json({ error: 'Set when the campaign ends (after it starts).' });
  const codes = [...new Map((Array.isArray(b.items) ? b.items : []).map((i) => [clean(i && i.code, 60), i && num(i.value) > 0 ? num(i.value) : null]).filter((x) => x[0])).entries()].slice(0, 6000);
  if (!codes.length) return res.status(400).json({ error: 'Add at least one product to the campaign.' });
  if (kind === 'price' && codes.some((x) => !(x[1] > 0))) return res.status(400).json({ error: 'Fixed price campaigns need a price on every part (' + codes.filter((x) => !(x[1] > 0)).length + ' without one).' });
  // margin floor: the campaign price on the lowest tier must stay at or above cost + CAMPAIGN_MIN_MARGIN (10% by default)
  // only sales and superadmins can put hidden parts in a campaign (a live campaign shows them to customers)
  if (w.role === 'marketing') { const hid = new Set((await db.selectAll('hidden_products', 'select=code')).map((r) => r.code)), hc = codes.filter((x) => hid.has(x[0])).map((x) => x[0]); if (hc.length) return res.status(403).json({ error: hc.length + ' hidden part' + (hc.length === 1 ? '' : 's') + ' in the list (' + hc.slice(0, 6).join(', ') + (hc.length > 6 ? '...' : '') + '). A live campaign shows them to customers, so only sales can add them. Remove them or ask sales.' }); }
  // costs must have loaded at least once before anyone but a superadmin can save a campaign
  const cst = (await db.select('sales_sync', 'select=costs_at&id=eq.1'))[0];
  if (!(cst && cst.costs_at) && !(w.role === 'superadmin' && b.force)) return res.status(409).json({ error: 'Costs from Unleashed have not loaded yet (first run takes up to an hour), so the margin cannot be checked. Try again later' + (w.role === 'superadmin' ? ', or save anyway.' : '.'), canForce: w.role === 'superadmin' });
  const below = await belowFloor(codes, kind, value, !!b.stack_vouchers);
  if (below.list.length && w.role === 'superadmin' && b.force && !clean(b.force_reason, 300)) return res.status(400).json({ error: 'Say why this campaign goes under the margin floor.' });
  if (below.list.length && !(w.role === 'superadmin' && b.force)) return res.status(409).json({ error: below.list.length + ' part' + (below.list.length === 1 ? '' : 's') + ' would sell under cost + ' + below.pct + '% on the lowest price tier' + (below.stacked ? ' with a ' + below.stacked + '% voucher on top (vouchers are allowed on this campaign)' : '') + ': ' + below.list.slice(0, 8).map((x) => x.code + ' (min $' + x.floor + ')').join(', ') + (below.list.length > 8 ? '...' : '') + '. Lower the discount on those parts or remove them' + (w.role === 'superadmin' ? ', or save anyway.' : '.'), below: below.list.slice(0, 200), canForce: w.role === 'superadmin' });
  const rec = { name, slug: slugify(b.slug || name) || 'campaign', badge: clean(b.badge, 30) || name.slice(0, 30), description: String(b.description || '').slice(0, 1500) || null, kind, value: kind === 'price' ? 0 : value || 0,
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#d32a37', banner_url: BANNER_URL.test(String(b.banner_url || '')) ? String(b.banner_url) : null, starts_at: starts.toISOString(), ends_at: ends.toISOString(), active: b.active !== false, stack_vouchers: !!b.stack_vouchers, show_all: !!b.show_all, rules: b.rules && typeof b.rules === 'object' ? b.rules : null, updated_at: new Date().toISOString() };
  let cid = id;
  try {
    if (cid) await db.update('campaigns', 'id=eq.' + cid, rec);
    else cid = (await db.insert('campaigns', [Object.assign(rec, { created_by: w.email })]))[0].id;
  } catch (e) { return res.status(409).json({ error: /duplicate|unique/i.test(e.message) ? 'Another campaign already uses that link name. Change the name or the link.' : 'Could not save.' }); }
  await db.remove('campaign_products', 'campaign_id=eq.' + cid);
  for (let i = 0; i < codes.length; i += 500) await db.insert('campaign_products', codes.slice(i, i + 500).map((x) => ({ campaign_id: cid, code: x[0], value: x[1] })));
  require('../lib/campaigns').reset();
  await PS.audit(w.email, id ? 'campaign.update' : 'campaign.create', 'campaign', cid, null, { name, products: codes.length, ...(b.force ? { force: true, reason: clean(b.force_reason, 300) || null } : {}) });
  return res.json({ ok: true, id: cid, slug: rec.slug });
};
A['campaign-toggle'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  if (b.remove) { await db.remove('campaigns', 'id=eq.' + id); await PS.audit(w.email, 'campaign.delete', 'campaign', id); }
  else { await db.update('campaigns', 'id=eq.' + id, { active: !!b.active, updated_at: new Date().toISOString() }); await PS.audit(w.email, b.active ? 'campaign.on' : 'campaign.off', 'campaign', id); }
  require('../lib/campaigns').reset();
  return res.json({ ok: true });
};

// ---------------------------------------------------------------- behaviour log: summaries for BI
A.events = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const company = clean(req.query.company, 60);
  const q = 'select=at,visitor_id,type,path,code,qty,value,query,device,country,region,city,utm,referrer,company_id,user_id&at=gte.' + since + (company ? '&company_id=eq.' + company : '') + '&order=at.desc&limit=' + (company ? 500 : 5000);
  const rows = await db.select('events', q);
  if (company) return res.json({ timeline: rows.slice(0, 500) });
  const top = (key, n = 15) => { const m = {}; rows.forEach((r) => { const k = r[key]; if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => ({ k, c })); };
  const of = (t) => rows.filter((r) => r.type === t);
  const adds = {}; of('cart_add').forEach((r) => { if (r.code) adds[r.code] = (adds[r.code] || 0) + (r.qty || 1); });
  const src = {}; rows.forEach((r) => { const u = r.utm && r.utm.source; const k = u || (r.referrer ? 'ref:' + r.referrer : 'direct'); src[k] = (src[k] || 0) + 1; });
  return res.json({
    days, total: rows.length, sample: rows.length >= 5000,
    visitors: new Set(rows.map((r) => r.visitor_id)).size,
    by_type: top('type', 20), top_products: top('code'), top_searches: top('query'), top_pages: top('path'),
    top_cart_adds: Object.entries(adds).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ k, c })),
    sources: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ k, c })),
    devices: top('device', 5), regions: top('region', 15),
  });
};

// ---------------------------------------------------------------- dashboard: sales (Unleashed history), portal behavior, next actions
const { cached } = require('../lib/store');
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
async function names() {
  const cat = await cached('catalog/live.json', 60 * 60 * 1000).catch(() => null);
  const m = {}; (Array.isArray(cat) ? cat : []).forEach((r) => { m[r[0]] = { t: String(r[1] || '').split(' / ')[0].slice(0, 70), k: r[3] }; });
  return m;
}
// rule-based next actions; each one says who, why and what to do, ranked by money at stake
function actions(S, B, portal, N, touched) {
  const out = [], nm = (c) => (N[c] && N[c].t) || c, T = touched || new Set(), fresh = (c) => !T.has(c);
  const inPortal = (c) => portal[c] && portal[c] !== 'rejected';
  (S.due || []).filter((c) => fresh(c.c)).slice(0, 25).forEach((c) => {
    const items = (c.items || []).slice(0, 4).map((i) => i.code + ' (' + nm(i.code) + ')');
    out.push({ kind: 'reorder', channel: 'call', score: (c.r12 || 0) + (c.total || 0) / 4, title: (c.status === 'overdue' ? 'Overdue: ' : 'Due to reorder: ') + c.n,
      why: 'Buys about every ' + c.med + ' days. Last order ' + c.since + ' days ago. ' + usd(c.r12) + ' in the last 12 months.' + (c.sp ? ' Salesperson: ' + c.sp + '.' : ''),
      todo: items.length ? 'Call or e-mail with the parts they usually buy: ' + items.join(', ') + '.' : 'Call to check what they need next.',
      who: [{ c: c.c, n: c.n }], sp: c.sp || null, codes: (c.items || []).map((i) => i.code) });
  });
  (S.declining || []).filter((c) => fresh(c.c)).slice(0, 10).forEach((c) => out.push({ kind: 'declining', channel: 'call', score: (c.p12 - c.r12) * 0.8, title: 'Buying less: ' + c.n,
    why: usd(c.r12) + ' in the last 12 months against ' + usd(c.p12) + ' the year before (' + Math.round((1 - c.r12 / Math.max(1, c.p12)) * 100) + '% down).',
    todo: 'Ask what changed: price, stock, a competitor, or less work. Call first; a voucher only if it is about price.', who: [{ c: c.c, n: c.n }], sp: c.sp || null }));
  const lost = (S.lost || []).filter((c) => c.total >= 1000 && fresh(c.c));
  if (lost.length) out.push({ kind: 'winback', channel: 'campaign', score: lost.reduce((a, c) => a + (c.p12 || 0) + c.total / 6, 0) / 3,
    title: 'Win-back campaign: ' + pl(lost.length, 'customer') + ' who stopped buying or are slipping', why: 'Together they spent ' + usd(lost.reduce((a, c) => a + c.total, 0)) + ' with Maxzz, ' + Math.round(lost.reduce((a, c) => a + c.orders, 0) / lost.length) + ' orders each on average.',
    todo: 'E-mail with a one-time voucher (for example 7% off, 30 days) and a portal invite. Call the 5 largest first.', who: lost.map((c) => ({ c: c.c, n: c.n })) });
  const nw = (S.new_customers || []).filter((c) => c.orders === 1);
  if (nw.length) out.push({ kind: 'second_order', channel: 'campaign', score: nw.length * 800, title: 'Second order push: ' + pl(nw.length, 'new customer') + ' with one order',
    why: 'New in the last 4 months and have not ordered again yet. The second order is where a customer usually sticks.', todo: 'Send a welcome with a portal invite and the parts most bought with what they ordered.', who: nw.map((c) => ({ c: c.c, n: c.n })) });
  const notIn = (S.top_customers || []).filter((c) => c.r12 > 0 && !inPortal(c.c)).slice(0, 25);
  if (notIn.length) out.push({ kind: 'portal_invite', channel: 'campaign', score: notIn.reduce((a, c) => a + c.r12, 0) / 20, title: 'Invite top customers to the portal: ' + notIn.length + ' not in yet',
    why: 'They are among your 40 biggest customers in the last 12 months and still order by phone or e-mail.', todo: 'Import them as a segment and send the portal invite, starting with the ones you talk to most.', who: notIn.map((c) => ({ c: c.c, n: c.n })) });
  (S.rising || []).slice(0, 5).forEach((p) => out.push({ kind: 'rising', channel: 'content', score: (p.r90 || 0) / 2, title: 'Selling more: ' + p.code + ' ' + nm(p.code),
    why: p.q90 + ' units in the last 90 days against ' + p.pq90 + ' in the 90 before.', todo: 'Check stock covers the trend, feature it on the portal home and in an Instagram post or e-mail to customers of that engine.', codes: [p.code] }));
  (S.falling || []).slice(0, 3).forEach((p) => out.push({ kind: 'falling', channel: 'review', score: (p.pr90 || 0) / 3, title: 'Selling less: ' + p.code + ' ' + nm(p.code),
    why: p.q90 + ' units in the last 90 days against ' + p.pq90 + ' in the 90 before.', todo: 'Check price against the market and stock. If it is seasonal, nothing to do.', codes: [p.code] }));
  (B.users || []).filter((u) => u.hot && !(u.code && T.has(u.code))).slice(0, 15).forEach((u) => out.push({ kind: 'portal_intent', channel: 'call', score: 1500 + (u.ca || 0) * 500 + (u.pv || 0) * 50, title: 'Shopping without ordering: ' + (u.company || u.email),
    why: (u.name || u.email) + ' viewed ' + (u.pv || 0) + ' parts' + (u.ca ? ' and added ' + u.ca + ' to the cart' : '') + ' in the portal, with no quote or order.' + (u.queries && u.queries.length ? ' Searched: ' + u.queries.join(', ') + '.' : ''),
    todo: 'Reach out today: help with the parts they looked at' + (u.codes && u.codes.length ? ' (' + u.codes.slice(0, 4).join(', ') + ')' : '') + ', price or stock questions.', who: [{ c: u.code, n: u.company, e: u.email }], codes: u.codes || [] }));
  return out.sort((a, b) => b.score - a.score).slice(0, 40).map((a) => { a.score = Math.round(a.score); return a; });
}
A.dash = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const touchedP = db.select('customer_notes', 'select=customer_code,follow_up,done_at,created_at&or=(created_at.gte.' + new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) + ',and(done_at.is.null,follow_up.gte.' + new Date().toISOString().slice(0, 10) + '))&limit=2000').catch(() => []);
  const [S, B, cos, N, ord, qts, PER] = await Promise.all([
    db.rpc('dash_sales'), db.rpc('dash_behavior', { p_days: days }),
    db.selectAll('companies', 'select=unleashed_code,status&unleashed_code=not.is.null'), names(),
    db.select('orders', 'select=total,created_at,status&created_at=gte.' + new Date(Date.now() - days * 864e5).toISOString() + '&limit=2000'),
    db.select('quotes', 'select=created_at&created_at=gte.' + new Date(Date.now() - days * 864e5).toISOString() + '&limit=2000'),
    db.rpc('dash_period', { p_days: days }).catch(() => null),
  ]);
  const FUN = await db.rpc('dash_funnel', { p_days: days }).catch(() => null);
  const portal = {}; (cos || []).forEach((c) => { portal[c.unleashed_code] = c.status; });
  const title = (c) => (N[c] ? N[c].t : '');
  ['products', 'rising', 'falling'].forEach((k) => (S[k] || []).forEach((p) => { p.t = title(p.code); p.k = N[p.code] ? N[p.code].k : ''; }));
  (S.due || []).forEach((c) => (c.items || []).forEach((i) => { i.t = title(i.code); }));
  ['top_customers', 'due', 'lost', 'declining', 'new_customers'].forEach((k) => (S[k] || []).forEach((c) => { c.portal = portal[c.c] || null; }));
  ['viewed', 'carted'].forEach((k) => (B[k] || []).forEach((p) => { p.t = title(p.k); }));
  const P = { orders: ord.length, order_value: Math.round(ord.reduce((a, o) => a + Number(o.total || 0), 0)), quotes: qts.length,
    companies: Object.values(portal).filter((s) => s === 'approved' || s === 'active').length, invited: Object.values(portal).filter((s) => s === 'invited').length };
  return res.json({ days, period: PER, funnel: FUN, sales: S, behavior: B, portal: P, actions: actions(S, B, portal, N, new Set((await touchedP).map((x) => x.customer_code).filter(Boolean))), ai: aiOn(req), at: Date.now() });
};
// AI read of the same numbers: campaigns for groups and one-to-one actions. Off until DASH_AI=1 (it has a cost per run).
// Only business data goes out (company names, codes, totals, parts); no e-mails or phone numbers.
// key: an AI Gateway key if one is set, else the project's own Vercel OIDC token (no key to manage)
const AI_KEY = (req) => process.env.AI_GATEWAY_API_KEY || (req && req.headers['x-vercel-oidc-token']) || process.env.VERCEL_OIDC_TOKEN || '';
const aiOn = (req) => process.env.DASH_AI === '1' && !!AI_KEY(req);
A['dash-ai'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const { readJson, writeJson } = require('../lib/store');
  if (req.method !== 'POST') return res.json({ on: aiOn(req), last: await readJson('portal/dash-ai.json').catch(() => null) });
  if (!originOk(req)) return res.status(405).json({ error: 'method' });
  if (!aiOn(req)) return res.status(409).json({ error: 'AI suggestions are not switched on yet.' });
  const last = await readJson('portal/dash-ai.json').catch(() => null);
  if (last && Date.now() - last.at < 10 * 60 * 1000) return res.json(last); // one run per 10 minutes is plenty
  const [S, B, N] = await Promise.all([db.rpc('dash_sales'), db.rpc('dash_behavior', { p_days: 30 }), names()]);
  const nm = (c) => (N[c] ? N[c].t : '');
  const cut = (a, n, f) => (a || []).slice(0, n).map(f);
  const facts = {
    today: new Date().toISOString().slice(0, 10), kpi: S.kpi, months: (S.months || []).slice(-13), segments: S.segments, status: S.status,
    due: cut(S.due, 20, (c) => ({ customer: c.n, code: c.c, every_days: c.med, days_since: c.since, last12: c.r12, rep: c.sp, usual_parts: (c.items || []).slice(0, 4).map((i) => i.code + ' ' + nm(i.code)) })),
    lost_or_at_risk: cut(S.lost, 15, (c) => ({ customer: c.n, code: c.c, lifetime: c.total, prev12: c.p12, days_since: c.since, orders: c.orders })),
    declining: cut(S.declining, 10, (c) => ({ customer: c.n, last12: c.r12, prev12: c.p12 })),
    new_customers: cut(S.new_customers, 15, (c) => ({ customer: c.n, first: c.first, orders: c.orders, total: c.total, country: c.country })),
    top_products: cut(S.products, 20, (p) => ({ code: p.code, name: nm(p.code), type: N[p.code] ? N[p.code].k : '', rev12: p.r12, units12: p.q12, buyers12: p.cust12 })),
    rising: cut(S.rising, 10, (p) => ({ code: p.code, name: nm(p.code), units90: p.q90, prev90: p.pq90 })),
    falling: cut(S.falling, 8, (p) => ({ code: p.code, name: nm(p.code), units90: p.q90, prev90: p.pq90 })),
    countries: S.countries, reps: S.reps,
    portal_30d: { totals: B.totals, funnel: B.funnel, sources: B.sources, searches: (B.searches || []).slice(0, 15), viewed: cut(B.viewed, 12, (p) => ({ code: p.k, name: nm(p.k), views: p.c })),
      shopping_without_order: (B.users || []).filter((u) => u.hot).slice(0, 10).map((u) => ({ company: u.company, viewed: u.pv, carted: u.ca, parts: u.codes, searched: u.queries })) },
  };
  const prompt = 'You are the sales analyst of Maxzz Diesel, a diesel fuel injection distributor in Florida (Bosch injectors, pumps, nozzles, repair parts, tools) selling B2B to repair shops and rebuilders in the US and Latin America through a sales team and a B2B portal. ' +
    'From the data below, write the actions with the best expected return for the next 2 weeks. Be specific: name customers, parts and numbers from the data, never invent figures. Plain, direct English, no hype, no em dashes. ' +
    'Answer only with JSON: {"summary": "3 to 5 sentences on how the business is doing and why", "one_to_one": [{"customer": "", "code": "", "action": "", "why": "", "channel": "call|email|whatsapp|visit", "priority": 1}], ' +
    '"campaigns": [{"name": "", "audience": "who and how many, from the data", "codes": ["customer codes if known"], "channel": "email|whatsapp|instagram|portal|call", "offer": "", "message": "a short draft of the message", "why": "", "expected": "what success looks like"}], ' +
    '"products": [{"code": "", "action": "", "why": ""}], "watch": ["risks or data gaps worth checking"]}. Up to 10 one_to_one, 5 campaigns, 5 products.\n\nDATA:\n' + JSON.stringify(facts);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + AI_KEY(req), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error('dash-ai', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: /customer_verification|credit card/i.test(JSON.stringify(j)) ? 'AI Gateway in Vercel needs a credit card on file before it answers (Vercel > AI Gateway). The free credits start after that.' : r.status === 401 || r.status === 403 ? 'The AI service refused the key. Check AI Gateway in Vercel.' : r.status === 402 ? 'AI Gateway has no credit left this month.' : 'The AI service did not answer. Try again in a minute.' }); }
    const text = String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'The AI answer could not be read. Try again.' });
    const doc = { at: Date.now(), by: w.email, model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', out };
    await writeJson('portal/dash-ai.json', doc);
    await PS.audit(w.email, 'dash.ai', 'dashboard', 'ai').catch(() => {});
    return res.json(doc);
  } finally { clearTimeout(t); }
};
A['dash-customers'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const [rows, cos] = await Promise.all([db.rpc('dash_customers'), db.selectAll('companies', 'select=unleashed_code,status&unleashed_code=not.is.null')]);
  const portal = {}; (cos || []).forEach((c) => { portal[c.unleashed_code] = c.status; });
  (rows || []).forEach((r) => { r.portal = portal[r.c] || null; });
  return res.json({ rows: rows || [] });
};
// one customer, everything we know: sales rhythm and history from Unleashed, portal people, behavior, portal orders and quotes
// one customer: sales, contacts and one activity timeline (like a CRM lead page) built from everything we keep
const EVN = { product: 'viewed', search: 'searched', cart_add: 'added to cart', cart_remove: 'removed from cart', quote_remove: 'removed from the quote', qty_change: 'changed a quantity', quote_abandon: 'left with items in the list', campaign_click: 'came from a campaign', search_empty: 'searched with no result', cart_view: 'opened the cart', checkout: 'started checkout', voucher: 'tried a voucher', filter: 'filtered' };
const AUD = { 'invite.send': ['invite', 'Invite e-mail sent'], 'invite.accept': ['account', 'Invite accepted'], 'company.approve': ['account', 'Account approved'], 'company.edit': ['account', 'Customer details edited'], 'company.reject': ['account', 'Access request rejected'], 'prospect.add': ['account', 'Added by hand'] };
A.customer = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const code = clean(req.query.code, 60), id = clean(req.query.id, 60);
  if (!code && !id) return res.status(400).json({ error: 'code' });
  const co = (await db.select('companies', 'select=*&' + (id ? 'id=eq.' + encodeURIComponent(id) : 'unleashed_code=eq.' + encodeURIComponent(code)) + '&limit=1'))[0] || null;
  const c = code || (co && co.unleashed_code) || '';
  const [sales, N, users, ev, ord, qts, ulc, inv, aud, segl, notes] = await Promise.all([
    c ? db.rpc('dash_customer', { p_code: c }) : null, names(),
    co ? db.select('users', 'select=email,name,phone,status,role,last_login_at,invited_at,invited_by,terms_accepted_at,created_at&company_id=eq.' + co.id) : [],
    co ? db.select('events', 'select=at,type,code,qty,value,query,path,device,city,region,session_id,referrer,utm&company_id=eq.' + co.id + '&order=at.desc&limit=600') : [],
    co ? db.select('orders', 'select=number,status,total,subtotal,discount,voucher_code,po,unleashed_number,created_at&company_id=eq.' + co.id + '&order=created_at.desc&limit=40') : [],
    co ? db.select('quotes', 'select=number,status,unleashed_number,notes,created_at&company_id=eq.' + co.id + '&order=created_at.desc&limit=40') : [],
    c ? db.select('ul_customers', 'select=*&code=eq.' + encodeURIComponent(c) + '&limit=1') : [],
    c ? db.select('sales_orders', 'select=guid,number,order_date,completed_date,subtotal,salesperson&customer_code=eq.' + encodeURIComponent(c) + '&order=completed_date.desc.nullslast&limit=60') : [],
    co ? db.select('audit_log', 'select=at,admin_email,action,after&entity=eq.company&entity_id=eq.' + co.id + '&order=at.desc&limit=60') : [],
    co ? db.select('company_segments', 'select=segment_id,added_by,at&company_id=eq.' + co.id) : [],
    (c || co) ? db.select('customer_notes', 'select=*&' + (c && co ? 'or=(customer_code.eq.' + encodeURIComponent('"' + c.replace(/["\\]/g, '') + '"') + ',company_id.eq.' + co.id + ')' : c ? 'customer_code=eq.' + encodeURIComponent(c) : 'company_id=eq.' + co.id) + '&order=created_at.desc&limit=200').catch(() => []) : [],
  ]);
  if (sales) (sales.parts || []).forEach((p) => { p.t = N[p.code] ? N[p.code].t : ''; });
  (ev || []).forEach((e) => { if (e.code && N[e.code]) e.t = N[e.code].t; });
  const lines = inv.length ? await db.select('sales_lines', 'select=order_guid,code,qty,total&order_guid=in.(' + inv.map((o) => o.guid).join(',') + ')') : [];
  const segN = {}; if (segl.length) (await db.select('segments', 'select=id,name&id=in.(' + segl.map((x) => x.segment_id).join(',') + ')')).forEach((g) => { segN[g.id] = g.name; });
  const T = [];
  const push = (at, kind, title, desc, det) => { if (at) T.push({ at, kind, title, desc: desc || '', det: det || null }); };
  inv.forEach((o) => { const ls = lines.filter((l) => l.order_guid === o.guid);
    push(o.completed_date || o.order_date, 'order', 'Invoiced order ' + (o.number || ''), usd(o.subtotal) + ' · ' + pl(ls.length, 'line') + (o.salesperson ? ' · ' + o.salesperson : ''), ls.map((l) => [l.code, (N[l.code] && N[l.code].t) || '', l.qty, l.total])); });
  (ord || []).forEach((o) => push(o.created_at, 'order', 'Portal order ' + o.number, usd(o.total) + ' · ' + o.status + (o.voucher_code ? ' · voucher ' + o.voucher_code : '') + (o.po ? ' · PO ' + o.po : ''), null));
  (qts || []).forEach((q) => push(q.created_at, 'quote', 'Quote request ' + q.number, q.status + (q.unleashed_number ? ' · ' + q.unleashed_number : ''), q.notes ? [[q.notes]] : null));
  // portal visits: one entry per session, with what happened in it
  const ses = {}; (ev || []).forEach((e) => { const k = e.session_id || (e.at || '').slice(0, 13); (ses[k] = ses[k] || []).push(e); });
  Object.values(ses).forEach((L) => {
    L.sort((a, b) => (a.at < b.at ? -1 : 1));
    const n = (t) => L.filter((e) => e.type === t).length, pages = n('page'), views = n('product'), srch = n('search'), cart = n('cart_add'), f = L[0];
    if (L.every((e) => e.type === 'login')) return;
    const bits = [views && pl(views, 'part') + ' viewed', srch && pl(srch, 'search'), cart && pl(cart, 'cart add'), pages && pl(pages, 'page')].filter(Boolean);
    push(f.at, 'visit', 'Visited the portal', bits.join(' · ') + (f.device ? ' · ' + f.device : '') + (f.city ? ' · ' + f.city + (f.region ? ', ' + f.region : '') : ''),
      L.filter((e) => e.type !== 'page' && e.type !== 'login').slice(0, 40).map((e) => [new Date(e.at).toISOString().slice(11, 16), EVN[e.type] || e.type, e.code || e.query || '', (e.code && N[e.code] && N[e.code].t) || '']));
  });
  (ev || []).filter((e) => e.type === 'login').forEach((e) => push(e.at, 'account', 'Signed in', [e.device, e.city].filter(Boolean).join(' · ')));
  (aud || []).forEach((a) => { const m = AUD[a.action]; if (!m) return; push(a.at, m[0], m[1], [a.after && a.after.email, 'by ' + a.admin_email].filter(Boolean).join(' · ')); });
  users.forEach((u) => { if (u.terms_accepted_at) push(u.terms_accepted_at, 'account', 'Accepted the terms of use', u.email); if (u.created_at && !(aud || []).length) push(u.created_at, 'account', 'Person added: ' + (u.name || u.email), u.invited_by ? 'invited by ' + u.invited_by : ''); });
  segl.forEach((x) => push(x.at, 'segment', 'Added to segment ' + (segN[x.segment_id] || ''), x.added_by ? 'by ' + x.added_by : ''));
  const NK = { call: 'Call', email: 'E-mail', meeting: 'Meeting', note: 'Note' };
  (notes || []).forEach((n) => T.push({ at: n.created_at, kind: 'note', title: (NK[n.kind] || 'Note') + ' by ' + String(n.created_by).split('@')[0], desc: n.body, det: null, note: { id: n.id, follow_up: n.follow_up, done: !!n.done_at, done_by: n.done_by, outcome: n.outcome, done_outcome: n.done_outcome } }));
  const u = ulc[0] || null;
  if (u && u.created_on) push(u.created_on, 'account', 'Customer created in Unleashed', u.code);
  if (co && co.created_at) push(co.created_at, 'account', 'Added to the admin', co.source ? String(co.source).replace(/_/g, ' ') : '');
  T.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
  const contact = { name: (u && u.contact_name) || (co && co.contact_name) || (users[0] && users[0].name) || '', email: (u && u.email) || (co && co.contact_email) || '', phone: (u && u.phone) || (co && co.contact_phone) || '',
    type: (u && u.type) || (co && co.customer_type) || '', tier: (u && u.tier) || (co && co.tier) || '', terms: (u && u.payment_terms) || (co && co.payment_terms) || '', sp: (u && u.salesperson) || (co && co.salesperson) || '',
    city: (u && u.city) || (co && co.city) || '', state: (u && u.state) || (co && co.state) || '', country: (u && u.country) || (co && co.country) || '', since: (u && u.created_on) || '', stop: !!((u && u.stop_credit) || (co && co.stop_credit)), obsolete: !!(u && u.obsolete),
    segments: segl.map((x) => segN[x.segment_id]).filter(Boolean), cname: (u && u.name) || (co && co.name) || '', editable: !!(u && !u.obsolete && c) };
  if (c) { const sg = (await db.select('customer_segments', 'select=segment,status,confidence,evidence&code=eq.' + encodeURIComponent(c) + '&limit=1').catch(() => []))[0]; if (sg) contact.seg = sg; }
  contact.tags = c ? (await db.select('customer_tags', 'select=tag&code=eq.' + encodeURIComponent(c)).catch(() => [])).map((x) => x.tag) : [];
  contact.allTags = [...new Set((await db.selectAll('customer_tags', 'select=tag').catch(() => [])).map((x) => x.tag))].sort();
  return res.json({ code: c, company: co && { id: co.id, name: co.name, status: co.status, tier: co.tier, city: co.city, state: co.state, country: co.country, contact_email: co.contact_email, contact_phone: co.contact_phone, salesperson: co.salesperson, created_at: co.created_at, source: co.source },
    contact, sales, users, events: ev.slice(0, 60), openFollowUps: (notes || []).filter((n) => n.follow_up && !n.done_at).length, orders: ord, quotes: qts, timeline: T.slice(0, 300) });
};
// edit a customer: read it live from Unleashed, change only the fields that differ, write it back, then update our copy.
// Not editable here on purpose: price tier, salesperson, payment terms, stop credit (those stay in Unleashed).
A['customer-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed is not connected here.' });
  const b = readBody(req), code = clean(b.code, 60);
  const want = { name: clean(b.name, 150), contact: clean(b.contact, 120), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 40), city: clean(b.city, 80), state: clean(b.state, 60), country: clean(b.country, 60) };
  if (!code) return res.status(400).json({ error: 'code' });
  if (!want.name) return res.status(400).json({ error: 'The company name cannot be empty.' });
  if (want.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(want.email)) return res.status(400).json({ error: 'That e-mail does not look right.' });
  const mir = (await db.select('ul_customers', 'select=*&code=eq.' + encodeURIComponent(code) + '&limit=1'))[0];
  if (!mir) return res.status(404).json({ error: 'customer' });
  let live;
  try {
    if (mir.guid) live = await ul('Customers/' + mir.guid);
    if (!live || !live.Guid) live = (((await ul('Customers', 'customerCode=' + encodeURIComponent(code) + '&includeObsolete=true')).Items) || [])[0];
  } catch (e) { return res.status(502).json({ error: 'Could not read this customer in Unleashed (' + e.message + '). Nothing was changed.' }); }
  if (!live || !live.Guid || live.CustomerCode !== code) return res.status(404).json({ error: 'Unleashed did not return this customer. Nothing was changed.' });
  if (live.Obsolete) return res.status(409).json({ error: 'This customer is obsolete in Unleashed.' });
  const ad = (live.Addresses || []).find((x) => /physical|street/i.test(x.AddressType || '')) || (live.Addresses || [])[0] || null;
  const was = { name: live.CustomerName || '', contact: [live.ContactFirstName, live.ContactLastName].filter(Boolean).join(' '), email: String(live.Email || '').toLowerCase(), phone: live.PhoneNumber || live.MobileNumber || '', city: (ad && ad.City) || '', state: (ad && ad.Region) || '', country: (ad && ad.Country) || '' };
  const FL = { name: 'Company name', contact: 'Contact', email: 'E-mail', phone: 'Phone', city: 'City', state: 'State', country: 'Country' };
  const changes = Object.keys(want).filter((k) => want[k] !== was[k]).map((k) => ({ f: FL[k], k, from: was[k], to: want[k] }));
  if (!changes.length) return res.json({ ok: true, changes: [] });
  if (!ad && changes.some((x) => ['city', 'state', 'country'].includes(x.k))) return res.status(409).json({ error: 'This customer has no address in Unleashed yet. Add the address there first.' });
  if (changes.some((x) => x.k === 'phone') && want.phone && !want.contact && !want.email) return res.status(400).json({ error: 'Unleashed only accepts a phone number when the customer also has a contact name or an e-mail. Fill one of them in too.' });
  if (b.dry) return res.json({ ok: true, dry: true, changes });
  // only the identity plus what changed: posting the whole record back made Unleashed answer 500
  const out = { Guid: live.Guid, CustomerCode: live.CustomerCode, CustomerName: live.CustomerName }, ch = (k) => changes.some((x) => x.k === k);
  ['ContactFirstName', 'ContactLastName', 'Email'].forEach((f) => { if (live[f]) out[f] = live[f]; });
  if (ad && ['city', 'state', 'country'].some(ch)) out.Addresses = JSON.parse(JSON.stringify(live.Addresses));
  if (ch('name')) out.CustomerName = want.name;
  if (ch('contact')) { const parts = want.contact.split(' '); out.ContactFirstName = parts.shift() || null; out.ContactLastName = parts.join(' ') || null; }
  if (ch('email')) out.Email = want.email || null;
  if (ch('phone')) out.PhoneNumber = want.phone || null;
  if (ad) { const t = out.Addresses[live.Addresses.indexOf(ad)]; if (ch('city')) t.City = want.city; if (ch('state')) t.Region = want.state; if (ch('country')) t.Country = want.country; }
  try { await ul('Customers/' + live.Guid, '', { method: 'POST', body: out }); }
  catch (e) { return res.status(502).json({ error: 'Unleashed did not accept the change (' + e.message + '). Nothing was changed.' }); }
  // read it back: Unleashed can answer OK and still keep the old value (it ignores empty text), so only report what it really holds
  let back = null;
  try { back = await ul('Customers/' + live.Guid); } catch (e) { back = null; }
  if (back && back.Guid) {
    const bad = changes.filter((x) => {
      if (x.k === 'name') return (back.CustomerName || '') !== want.name;
      if (x.k === 'contact') return [back.ContactFirstName, back.ContactLastName].filter(Boolean).join(' ') !== want.contact;
      if (x.k === 'email') return String(back.Email || '').toLowerCase() !== want.email;
      if (x.k === 'phone') return (back.PhoneNumber || '') !== want.phone;
      const t = (back.Addresses || []).find((a) => /physical|street/i.test(a.AddressType || '')) || (back.Addresses || [])[0] || {};
      return ({ city: t.City, state: t.Region, country: t.Country }[x.k] || '') !== want[x.k];
    });
    if (bad.length) return res.status(409).json({ error: 'Unleashed kept the old value for ' + bad.map((x) => x.f).join(', ') + '. Clearing a field is not accepted by Unleashed, so change it there if it must be empty. Nothing was changed here.' });
  }
  const mset = { name: want.name, contact_name: want.contact || null, email: want.email || null, phone: want.phone || null, city: want.city || null, state: want.state || null, country: want.country || null, synced_at: new Date().toISOString() };
  await db.update('ul_customers', 'code=eq.' + encodeURIComponent(code), mset);
  const co = (await db.select('companies', 'select=id&unleashed_code=eq.' + encodeURIComponent(code) + '&limit=1'))[0];
  if (co) await db.update('companies', 'id=eq.' + co.id, { name: want.name, contact_name: want.contact || null, contact_email: want.email || null, contact_phone: want.phone || null, city: want.city || null, state: want.state || null, country: want.country || null });
  await PS.audit(w.email, 'company.edit', 'company', co ? co.id : null, { code }, { code, changed: changes.map((x) => x.f), from: Object.fromEntries(changes.map((x) => [x.k, x.from])), to: Object.fromEntries(changes.map((x) => [x.k, x.to])) });
  return res.json({ ok: true, changes });
};
// log a call, e-mail, meeting or note on a customer, with an optional follow-up date (shows on the dashboard until done)
A['note-add'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), body = String(b.body || '').trim().slice(0, 4000), code = clean(b.code, 60) || null, cid = /^[0-9a-f-]{36}$/i.test(String(b.company || '')) ? b.company : null;
  if (!body) return res.status(400).json({ error: 'Write what happened.' });
  if (!code && !cid) return res.status(400).json({ error: 'customer' });
  const fu = /^\d{4}-\d{2}-\d{2}$/.test(String(b.follow_up || '')) ? b.follow_up : null;
  const outcome = ['reached', 'no_answer', 'left_message', 'quote_sent', 'ordered', 'not_now', 'lost'].includes(b.outcome) ? b.outcome : null;
  const r = await db.insert('customer_notes', [{ customer_code: code, company_id: cid, customer_name: clean(b.name, 160) || null, kind: ['call', 'email', 'meeting', 'note'].includes(b.kind) ? b.kind : 'note', body, follow_up: fu, outcome, created_by: w.email }]);
  return res.json({ ok: true, id: r[0] && r[0].id });
};
A['note-done'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), id = clean(b.id, 60);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id' });
  const patch = b.snooze && /^\d{4}-\d{2}-\d{2}$/.test(b.snooze) ? { follow_up: b.snooze } : { done_at: b.undo ? null : new Date().toISOString(), done_by: b.undo ? null : w.email, done_outcome: b.undo ? null : (['reached', 'no_answer', 'left_message', 'quote_sent', 'ordered', 'not_now', 'lost'].includes(b.outcome) ? b.outcome : null) };
  await db.update('customer_notes', 'id=eq.' + id, patch);
  return res.json({ ok: true });
};
// open follow-ups for the dashboard: overdue, today and the next 7 days
A.followups = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  let rows = await db.select('customer_notes', 'select=id,customer_code,company_id,customer_name,kind,body,outcome,follow_up,created_by,created_at&done_at=is.null&follow_up=not.is.null&order=follow_up.asc&limit=500');
  // a follow-up closes itself when the customer orders after the note (invoice in Unleashed or order in the portal)
  const codes = [...new Set(rows.map((r) => r.customer_code).filter(Boolean))], cids = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
  const minAt = rows.reduce((m, r) => (r.created_at < m ? r.created_at : m), new Date().toISOString()).slice(0, 10);
  const inv = [], po = [];
  for (let i = 0; i < codes.length; i += 150) inv.push(...(await db.select('sales_orders', 'select=customer_code,number,completed_date,order_date&completed_date=gte.' + minAt + '&customer_code=' + inList(codes.slice(i, i + 150)))));
  for (let i = 0; i < cids.length; i += 150) po.push(...(await db.select('orders', 'select=company_id,number,created_at&created_at=gte.' + minAt + '&company_id=in.(' + cids.slice(i, i + 150).join(',') + ')')));
  const closed = [];
  rows.forEach((r) => { const d = r.created_at.slice(0, 10);
    const o = inv.find((x) => x.customer_code === r.customer_code && (x.completed_date || x.order_date) > d) || po.find((x) => x.company_id === r.company_id && x.created_at > r.created_at);
    if (o) closed.push({ id: r.id, ref: o.number }); });
  for (const c of closed) await db.update('customer_notes', 'id=eq.' + c.id, { done_at: new Date().toISOString(), done_by: 'auto', done_outcome: 'ordered' }).catch(() => {});
  const shut = new Set(closed.map((c) => c.id));
  rows = rows.filter((r) => !shut.has(r.id) && r.follow_up <= until);
  // whose account it is: the Unleashed salesperson of the customer
  const sp = {}; const rc = [...new Set(rows.map((r) => r.customer_code).filter(Boolean))];
  for (let i = 0; i < rc.length; i += 150) (await db.select('ul_customers', 'select=code,salesperson&code=' + inList(rc.slice(i, i + 150)))).forEach((x) => { sp[x.code] = x.salesperson; });
  rows.forEach((r) => { r.sp = sp[r.customer_code] || null; });
  const me = (await db.select('admins', 'select=salesperson&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0] || {};
  return res.json({ rows, me: w.email, mySp: me.salesperson || null, autoClosed: closed.length });
};
// who is behind one funnel step: visitors (with what they did) or companies, newest first
const FSTEPS = ['visitors', 'browsed', 'carted', 'requests', 'approved', 'bought', 'inv_invited', 'inv_accepted', 'inv_used', 'inv_bought'];
A['funnel-step'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30)), step = String(req.query.step || '');
  if (!FSTEPS.includes(step)) return res.status(400).json({ error: 'step' });
  const [rows, N] = await Promise.all([db.rpc('dash_funnel_step', { p_days: days, p_step: step }), names()]);
  (rows || []).forEach((r) => (r.trail || []).forEach((e) => { if (e.code && N[e.code]) e.t = N[e.code].t; }));
  return res.json({ step, days, rows: rows || [] });
};
// quotes and portal orders waiting for the team: the Parked sales orders in Unleashed (website quotes, B2B store quotes,
// portal orders and parked orders typed by hand), with their age and owner. Marked lost or handled ones are left out.
let pipeMemo = { at: 0, rows: null };
// the quote comment ends with: company · name · e-mail · phone ... so a web quote keeps who asked for it
function commentContact(c) {
  const parts = String(c || '').split(' · '), i = parts.findIndex((x) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x.trim()));
  if (i < 0) return null;
  const ph = parts[i + 1] && /^[\d()+\-.\s]{7,}$/.test(parts[i + 1].trim()) ? parts[i + 1].trim() : null;
  return { name: i > 0 ? parts[i - 1].trim().slice(0, 120) : null, email: parts[i].trim().toLowerCase(), phone: ph };
}
async function loadParked(fresh) {
  if (!pipeMemo.rows || Date.now() - pipeMemo.at > 3 * 60e3 || fresh) {
    const items = [];
    for (let page = 1; page <= 3; page++) {
      const d = await ul('SalesOrders/' + page, 'pageSize=200&orderStatus=Parked', { timeoutMs: 60000 });
      items.push(...(d.Items || []));
      if (!d.Pagination || page >= (d.Pagination.NumberOfPages || 1)) break;
    }
    const day = (v) => { const m = String(v || '').match(/\/Date\((-?\d+)/); const t = m ? +m[1] : Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
    pipeMemo = { at: Date.now(), rows: items.map((o) => { const c = String(o.Comments || '');
      const kind = /^QUOTE REQUEST .*\(website\)/i.test(c) ? 'site_quote' : /^QUOTE REQUEST/i.test(c) ? 'portal_quote' : /^Portal B2B/i.test(c) ? 'portal_order' : 'parked';
      return { number: o.OrderNumber, ref: o.CustomerRef || '', kind, code: o.Customer && o.Customer.CustomerCode, name: o.Customer && o.Customer.CustomerName, at: day(o.OrderDate) || day(o.CreatedOn),
        value: Number(o.SubTotal || o.BCSubTotal || 0), lines: (o.SalesOrderLines || []).length, sp: o.SalesPerson && (o.SalesPerson.FullName || o.SalesPerson.Email) || null, note: c.replace(/^QUOTE REQUEST [^:]*:\s*/i, '').slice(0, 220), web: /WEB CUSTOMER/i.test(c), ct: commentContact(c) }; }) };
  }
  return pipeMemo.rows;
}
A.pipeline = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (!configured()) return res.status(503).json({ error: 'Unleashed not configured' });
  await loadParked(req.query.fresh === '1');
  const marks = await db.selectAll('pipeline_marks', 'select=number,status').catch(() => []), gone = new Set(marks.map((m) => m.number));
  const rows = pipeMemo.rows.filter((r) => !gone.has(r.number));
  const codes = [...new Set(rows.map((r) => r.code).filter(Boolean))], sp = {};
  for (let i = 0; i < codes.length; i += 150) (await db.select('ul_customers', 'select=code,salesperson&code=' + inList(codes.slice(i, i + 150)))).forEach((x) => { sp[x.code] = x.salesperson; });
  rows.forEach((r) => { if (!r.sp) r.sp = sp[r.code] || null; });
  const me = (await db.select('admins', 'select=salesperson&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0] || {};
  return res.json({ rows, at: pipeMemo.at, mySp: me.salesperson || null });
};
A['pipeline-mark'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), number = clean(b.number, 40), status = b.status === 'handled' ? 'handled' : 'lost', code = clean(b.code, 60) || null;
  if (!number) return res.status(400).json({ error: 'number' });
  await db.insert('pipeline_marks', [{ number, status, reason: clean(b.reason, 300) || null, customer_code: code, marked_by: w.email }], { onConflict: 'number' });
  if (code) await db.insert('customer_notes', [{ customer_code: code, customer_name: clean(b.name, 160) || null, kind: 'note', body: (status === 'lost' ? 'Lost ' : 'Handled ') + number + (b.reason ? ': ' + clean(b.reason, 300) : ''), outcome: status === 'lost' ? 'lost' : null, created_by: w.email }]).catch(() => {});
  await PS.audit(w.email, 'pipeline.' + status, 'order', number, null, { reason: b.reason || null });
  return res.json({ ok: true });
};
// ---------------------------------------------------------------- CRM (Sales > CRM): deals on a kanban, fed by the parked orders in Unleashed
const CRM_OWNER = 'Michael'; // a new customer with no Unleashed salesperson goes here until a distribution rule exists
const crmStageOf = (kind) => (kind === 'site_quote' || kind === 'portal_quote' ? 'new' : 'quote');
let crmSyncAt = 0;
async function crmSync() {
  if (Date.now() - crmSyncAt < 90e3 || !configured()) return;
  crmSyncAt = Date.now();
  const parked = await loadParked(false).catch((e) => { console.error('crmSync: Unleashed read failed', e.message); crmSyncAt = 0; return null; }); if (!parked) return;
  // without the marks or the deals already on record, a sync would create or rewrite deals it should leave alone: stop and try again on the next open
  let marks, deals;
  try { marks = await db.selectAll('pipeline_marks', 'select=number,status,reason'); deals = await db.selectAll('crm_deals', 'select=id,ref,stage,value,created_at,updated_at,stage_at&ref=not.is.null'); }
  catch (e) { console.error('crmSync: database read failed, nothing changed', e.message); crmSyncAt = 0; return; }
  const mk = {}; marks.forEach((m) => { mk[m.number] = m; });
  const by = {}; deals.forEach((d) => { by[d.ref] = d; });
  const live = new Set(parked.map((r) => r.number)), codes = [...new Set(parked.map((r) => r.code).filter(Boolean))], spOf = {};
  const ctOf = {};
  for (let i = 0; i < codes.length; i += 150) (await db.select('ul_customers', 'select=code,salesperson,contact_name,email,phone&code=' + inList(codes.slice(i, i + 150)))).forEach((x) => { spOf[x.code] = x.salesperson; ctOf[x.code] = x; });
  const fresh = parked.filter((r) => !by[r.number] && !mk[r.number]).map((r) => ({ title: (r.name || r.code || 'Customer') + ' · ' + r.number, stage: crmStageOf(r.kind), owner: r.sp || spOf[r.code] || CRM_OWNER, customer_code: r.code || null, customer_name: r.name || null, contact_name: (r.web || r.code === 'WEBQUOTE' ? (r.ct && r.ct.name) : null) || (ctOf[r.code] || {}).contact_name || null, contact_email: (r.web || r.code === 'WEBQUOTE' ? (r.ct && r.ct.email) : null) || (ctOf[r.code] || {}).email || null, contact_phone: (r.web || r.code === 'WEBQUOTE' ? (r.ct && r.ct.phone) : null) || (ctOf[r.code] || {}).phone || null, value: r.value || 0, source: r.kind, ref: r.number, note: r.note || null, created_by: 'auto', ...(r.at ? { created_at: r.at, stage_at: r.at, updated_at: r.at } : {}) }));
  if (fresh.length) {
    // one bad row must not lose the whole batch: on a failure each order is tried on its own and the one that fails is named in the log
    let ins = await db.insert('crm_deals', fresh, { onConflict: 'ref', ignoreDuplicates: true }).catch((e) => { console.error('crmSync: batch insert failed, retrying one by one', e.message); return null; });
    if (!ins) { ins = []; for (const row of fresh) { try { const r1 = await db.insert('crm_deals', [row], { onConflict: 'ref', ignoreDuplicates: true }); if (Array.isArray(r1)) ins.push(...r1); } catch (e) { console.error('crmSync: could not import', row.ref, e.message); } } }
    if (ins) await db.insert('crm_activities', (Array.isArray(ins) ? ins : []).map((d) => ({ deal_id: d.id, kind: 'stage', body: 'Created from Unleashed (' + d.source + ')', created_by: 'auto' }))).catch(() => {}); }
  // a deal is as old as its order in Unleashed, not as the moment the CRM first saw it. Deals made by an earlier sync that nobody touched since get their order date back.
  for (const r of parked) { const d = by[r.number]; if (!d || !r.at || d.stage === 'won' || d.stage === 'lost') continue; const cr = Date.parse(d.created_at), up = Date.parse(d.updated_at);
    const sa = Date.parse(d.stage_at);
    if (Number.isFinite(cr) && Math.abs(sa - cr) < 5 * 60e3 && cr - Date.parse(r.at) > 864e5 && Date.now() - cr < 3 * 864e5) await db.update('crm_deals', 'id=eq.' + d.id, Math.abs(up - cr) < 5 * 60e3 ? { created_at: r.at, stage_at: r.at, updated_at: r.at } : { created_at: r.at, stage_at: r.at }).catch(() => {}); }
  for (const r of parked) { const d = by[r.number]; if (d && d.stage !== 'won' && d.stage !== 'lost' && Number(d.value) !== Number(r.value)) await db.update('crm_deals', 'id=eq.' + d.id, { value: r.value || 0 }).catch(() => {}); }
  // completed orders that never passed through the Parked list (or were invoiced before the CRM saw them) are won deals too
  const done = await db.select('sales_orders', 'select=number,customer_code,customer_name,order_date,completed_date,subtotal,salesperson&status=eq.Completed&or=(is_return.is.null,is_return.eq.false)&order_date=gte.' + new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) + '&limit=2000').catch(() => []);
  const wonNew = done.filter((o) => !by[o.number] && !mk[o.number]);
  if (wonNew.length) {
    const miss = [...new Set(wonNew.map((o) => o.customer_code).filter((c) => c && !spOf[c]))];
    for (let i = 0; i < miss.length; i += 150) (await db.select('ul_customers', 'select=code,salesperson&code=' + inList(miss.slice(i, i + 150))).catch(() => [])).forEach((x) => { spOf[x.code] = x.salesperson; });
    await db.insert('crm_deals', wonNew.map((o) => { const t = o.completed_date || o.order_date; return { title: (o.customer_name || o.customer_code || 'Customer') + ' · ' + o.number, stage: 'won', owner: o.salesperson || spOf[o.customer_code] || CRM_OWNER, customer_code: o.customer_code || null, customer_name: o.customer_name || null, value: Number(o.subtotal) || 0, source: 'order', ref: o.number, created_by: 'auto', created_at: o.order_date, updated_at: t, stage_at: t, closed_at: t, note: 'Imported from Unleashed (completed order)' }; }), { onConflict: 'ref' }).catch(() => null);
  }
  await crmSyncAccess().catch(() => {});
  // deals whose order left the Parked list: lost if marked, won if invoiced
  const gone = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost' && !live.has(d.ref));
  if (gone.length) {
    const nums = gone.map((d) => d.ref), inv = new Set();
    for (let i = 0; i < nums.length; i += 150) (await db.select('sales_orders', 'select=number&number=' + inList(nums.slice(i, i + 150)))).forEach((x) => inv.add(x.number));
    for (const d of gone) { const m = mk[d.ref], to = m ? (m.status === 'lost' ? 'lost' : 'won') : inv.has(d.ref) ? 'won' : null; if (!to) continue;
      const now = new Date().toISOString();
      await db.update('crm_deals', 'id=eq.' + d.id, { stage: to, stage_at: now, closed_at: now, updated_at: now, lost_reason: to === 'lost' ? (m && m.reason) || null : null }).catch(() => {});
      await db.insert('crm_activities', [{ deal_id: d.id, kind: 'stage', body: to === 'won' ? 'Won: order left the Parked list' + (inv.has(d.ref) ? ' and is invoiced' : '') : 'Lost' + (m && m.reason ? ': ' + m.reason : ''), created_by: 'auto' }]).catch(() => {}); }
  }
}
// portal access requests become deals too: a new company asking for access is a lead nobody should miss
async function crmSyncAccess() {
  const pend = await db.select('companies', 'select=id,name,city,state,country,created_at&status=eq.pending&order=created_at.desc&limit=200').catch(() => []);
  const have = await db.selectAll('crm_deals', 'select=id,ref,stage&source=eq.access_request').catch(() => []), by = {}; have.forEach((d) => { by[d.ref] = d; });
  const fresh = pend.filter((c) => !by['access:' + c.id]);
  if (fresh.length) {
    const us = await db.select('users', 'select=company_id,name,email,phone&company_id=in.(' + fresh.map((c) => c.id).join(',') + ')').catch(() => []), U = {}; us.forEach((u) => { if (!U[u.company_id]) U[u.company_id] = u; });
    const ins = await db.insert('crm_deals', fresh.map((c) => { const u = U[c.id] || {}; return { title: 'Portal access · ' + c.name, stage: 'new', owner: CRM_OWNER, customer_name: c.name, contact_name: u.name || null, contact_email: u.email || null, contact_phone: u.phone || null, value: 0, source: 'access_request', ref: 'access:' + c.id, note: [c.city, c.state, c.country].filter(Boolean).join(', ') || null, created_by: 'auto' }; }), { onConflict: 'ref' }).catch(() => null);
    if (ins) await db.insert('crm_activities', (Array.isArray(ins) ? ins : []).map((d) => ({ deal_id: d.id, kind: 'stage', body: 'Created from a portal access request', created_by: 'auto' }))).catch(() => {});
  }
  const live = new Set(pend.map((c) => 'access:' + c.id)), gone = have.filter((d) => d.stage !== 'won' && d.stage !== 'lost' && !live.has(d.ref));
  if (gone.length) {
    const cs = await db.select('companies', 'select=id,status&id=in.(' + gone.map((d) => d.ref.slice(7)).join(',') + ')').catch(() => []), st = {}; cs.forEach((c) => { st[c.id] = c.status; });
    for (const d of gone) { const cs1 = st[d.ref.slice(7)]; if (!cs1) continue; const to = cs1 === 'rejected' ? 'lost' : 'won', now = new Date().toISOString();
      await db.update('crm_deals', 'id=eq.' + d.id, { stage: to, stage_at: now, closed_at: now, updated_at: now, lost_reason: to === 'lost' ? 'Access request rejected' : null }).catch(() => {});
      await db.insert('crm_activities', [{ deal_id: d.id, kind: 'stage', body: to === 'won' ? 'Access approved' : 'Access rejected', created_by: 'auto' }]).catch(() => {}); }
  }
}
// rules that flag what matters today; the AI pass (crm-ai) ranks and words them when it is switched on
function crmRules(deals, stages, isSuper) {
  const SK = {}; stages.forEach((x) => { SK[x.key] = x; });
  const td = new Date().toISOString().slice(0, 10), now = Date.now(), D = 864e5, open = deals.filter((d) => SK[d.stage] && SK[d.stage].kind === 'open'), out = [];
  const nm = (L) => L.slice(0, 3).map((d) => d.customer_name || d.title).join(', ') + (L.length > 3 ? ' and ' + (L.length - 3) + ' more' : '');
  const add = (id, sev, title, tip, L) => { if (L.length) out.push({ id, sev, title, tip, ids: L.map((d) => d.id) }); };
  const late = open.filter((d) => d.next && d.next.due < td);
  add('late', 3, late.length + (late.length === 1 ? ' follow-up is overdue' : ' follow-ups are overdue'), 'Overdue: ' + nm(late) + '. Open the deal, make the call and log it.', late);
  const nw = open.filter((d) => d.stage === 'new' && now - Date.parse(d.stage_at) > 2 * D);
  add('new', 3, nw.length + (nw.length === 1 ? ' new deal has waited' : ' new deals have waited') + ' over 2 days', 'Nobody has touched: ' + nm(nw) + '. A first reply in the first day wins more quotes.', nw);
  const q = open.filter((d) => d.stage === 'quote' && now - Date.parse(d.updated_at) > 5 * D);
  add('quote', 2, q.length + (q.length === 1 ? ' quote is' : ' quotes are') + ' quiet for 5 days', 'Quote sent, no reply: ' + nm(q) + '. A short call now beats waiting.', q);
  const big = open.filter((d) => Number(d.value) >= 5000 && !d.next).sort((x, y) => y.value - x.value);
  add('big', 2, big.length + (big.length === 1 ? ' large deal has' : ' large deals have') + ' no next step', 'Biggest first: ' + nm(big) + '. Add a dated task so it does not go cold.', big);
  const na = open.filter((d) => !Number(d.value));
  add('amt', 1, na.length + (na.length === 1 ? ' open deal has' : ' open deals have') + ' no amount', 'Without an amount the forecast ignores: ' + nm(na) + '.', na);
  const wk = deals.filter((d) => d.stage === 'won' && d.closed_at && now - Date.parse(d.closed_at) < 7 * D);
  if (wk.length) out.push({ id: 'won', sev: 0, title: wk.length + (wk.length === 1 ? ' deal' : ' deals') + ' won this week', tip: nm(wk) + ' closed in the last 7 days, ' + Math.round(wk.reduce((t, d) => t + (Number(d.value) || 0), 0)).toLocaleString('en-US') + ' dollars.', ids: wk.map((d) => d.id) });
  if (isSuper) { const by = {}; open.filter((d) => (d.next && d.next.due < td) || now - Date.parse(d.updated_at) > 7 * D).forEach((d) => { const o = d.owner || 'No owner'; (by[o] = by[o] || []).push(d); });
    const top = Object.entries(by).sort((x, y) => y[1].length - x[1].length)[0];
    if (top && top[1].length >= 3) add('team', 2, top[0] + ' has ' + top[1].length + ' deals needing attention', 'Late or idle for 7 days: ' + nm(top[1]) + '. Worth a word with ' + top[0] + '.', top[1]); }
  return out.sort((x, y) => y.sev - x.sev).slice(0, 6);
}
A.crm = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  await crmSync().catch(() => {});
  const sc = await salesScope(w, { query: {} }), isSuper = w.role === 'superadmin';
  if (!isSuper && sc.none) return res.json({ stages: [], deals: [], mySp: null, isSuper, owners: [] });
  const since = new Date(Date.now() - 60 * 864e5).toISOString(), dOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')), q = req.query || {}, own = isSuper ? '' : '&owner=eq.' + encodeURIComponent(sc.sp);
  // default: open deals plus what closed in the last 60 days. With a period (or all=1) the board holds every deal created in it, the imported Unleashed order history included.
  const per = q.all === '1' ? '' : (dOk(q.from) ? '&created_at=gte.' + q.from : '') + (dOk(q.to) ? '&created_at=lte.' + q.to + 'T23:59:59' : '');
  const [stages, all] = await Promise.all([db.select('crm_stages', 'select=*&order=pos.asc'), (q.all === '1' || per)
    ? db.selectAll('crm_deals', 'select=*&order=updated_at.desc' + per + own).then((r) => r.slice(0, 6000))
    : db.select('crm_deals', 'select=*&or=(closed_at.is.null,closed_at.gte.' + since + ')&order=updated_at.desc&limit=800' + own)]);
  const ids = all.filter((d) => d.source !== 'order').map((d) => d.id), next = {};
  for (let i = 0; i < ids.length; i += 100) (await db.select('crm_activities', 'select=deal_id,body,due&done_at=is.null&due=not.is.null&deal_id=in.(' + ids.slice(i, i + 100).join(',') + ')&order=due.asc')).forEach((a) => { if (!next[a.deal_id]) next[a.deal_id] = a; });
  all.forEach((d) => { d.next = next[d.id] || null; });
  const cnt = {};
  for (let i = 0; i < ids.length; i += 100) (await db.select('crm_activities', 'select=deal_id,kind,done_at&kind=in.(note,call,email,task)&limit=5000&deal_id=in.(' + ids.slice(i, i + 100).join(',') + ')').catch(() => [])).forEach((a) => { const c = cnt[a.deal_id] || (cnt[a.deal_id] = { n: 0, c: 0, e: 0, t: 0 }); if (a.kind === 'note') c.n++; else if (a.kind === 'call') c.c++; else if (a.kind === 'email') c.e++; else if (!a.done_at) c.t++; });
  const codes = [...new Set(all.map((d) => d.customer_code).filter(Boolean))], pl = {};
  for (let i = 0; i < codes.length; i += 150) (await db.select('ul_customers', 'select=code,city,state&code=' + inList(codes.slice(i, i + 150))).catch(() => [])).forEach((x) => { pl[x.code] = [x.city, x.state].filter(Boolean).join(', '); });
  all.forEach((d) => { d.cnt = cnt[d.id] || { n: 0, c: 0, e: 0, t: 0 }; d.place = pl[d.customer_code] || null; });
  const owners = isSuper ? [...new Set((await db.select('ul_customers', 'select=salesperson&salesperson=not.is.null&limit=2000')).map((x) => x.salesperson).concat(all.map((d) => d.owner).filter(Boolean)).concat([CRM_OWNER]))].sort() : [];
  // a photo is found by the mapped salesperson, or else by the admin's name (full name, then first name), so it shows before the mapping is done
  const photos = {}; (await db.select('admins', 'select=email,name,first_name,salesperson,photo&active=eq.true').catch(() => [])).forEach((r) => { const ph = r.photo || TEAM_PH[String(r.email).toLowerCase()]; if (!ph) return; [r.salesperson, r.name, r.first_name, String(r.name||'').trim().split(/\s+/)[0]].forEach((k) => { k = String(k || '').trim(); if (k && !photos[k]) photos[k] = ph; }); });
  return res.json({ stages, deals: all, mySp: sc.sp, isSuper, owners, photos, team: (await teamList()).map((t) => ({ name: t.name, handle: t.handles[0], photo: t.photo })), ins: crmRules(all, stages, isSuper), ai: aiOn(req) });
};
// ---------------------------------------------------------------- proposals (Sales > CRM > deal > Proposal)
const PROP = require('../lib/proposal');
const normPn = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function dealFor(req, res, w, id) {
  const d = (await db.select('crm_deals', 'select=*&id=eq.' + encodeURIComponent(id) + '&limit=1'))[0];
  if (!d) { res.status(404).json({ error: 'deal' }); return null; }
  const sc = await salesScope(w, { query: {} });
  if (w.role !== 'superadmin' && d.owner !== sc.sp) { res.status(403).json({ error: 'scope' }); return null; }
  return d;
}
async function orderLinesOf(ref) {
  if (!ref || !/^[A-Za-z0-9-]+$/.test(ref) || !configured()) return [];
  try {
    const o = ((await ul('SalesOrders', 'orderNumber=' + encodeURIComponent(ref), { timeoutMs: 9000 })).Items || [])[0];
    return o ? (o.SalesOrderLines || []).filter((l) => l.Product).map((l) => ({ code: l.Product.ProductCode, name: String(l.Product.ProductDescription || '').slice(0, 140), qty: Number(l.OrderQuantity) || 0, price: Number(l.UnitPrice) || 0 })) : [];
  } catch (e) { return []; }
}
async function moveDeal(d, stage, body, by, value) {
  const now = new Date().toISOString(), won = stage === 'won' || stage === 'lost';
  await db.update('crm_deals', 'id=eq.' + d.id, Object.assign({ stage, stage_at: now, updated_at: now }, won ? { closed_at: now } : {}, value != null ? { value } : {}));
  await db.insert('crm_activities', [{ deal_id: d.id, kind: 'stage', body, created_by: by }]).catch(() => {});
}
// proposal number: the Unleashed order number when the deal comes from one, otherwise the next quote number (MXQ-n), never an internal ref like access:<id>
const goodNo = (n) => /^(SO-\d+|MXQ-\d+|P-[A-Z0-9]+)$/i.test(String(n || ''));
async function propNumber(d) {
  if (/^SO-\d+$/i.test(d.ref || '')) return d.ref;
  try { if (PS.on()) return await PS.nextNumber('quote'); } catch (e) {}
  return 'P-' + String(d.id).slice(0, 6).toUpperCase();
}
A['proposal-get'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const d = await dealFor(req, res, w, clean(req.query.id, 60)); if (!d) return;
  let p = (await db.select('proposals', 'select=*&deal_id=eq.' + d.id + '&limit=1'))[0], fresh = false;
  if (p && p.status === 'draft' && !goodNo(p.number)) p.number = 'Not numbered yet';
  if (!p) {
    fresh = true;
    p = { deal_id: d.id, ref: d.ref, number: /^SO-\d+$/i.test(d.ref || '') ? d.ref : 'Not numbered yet', doc_type: process.env.PROPOSAL_DOC === 'invoice' ? 'invoice' : 'quote', status: 'draft', lines: await orderLinesOf(d.ref), discount_pct: 0, freight: 0, notes: '', valid_days: 30,
      customer_name: d.customer_name || '', contact_name: d.contact_name || '', contact_email: d.contact_email || '', contact_phone: d.contact_phone || '', ship: null };
  }
  const floors = {}, F = await floorsFor((p.lines || []).map((l) => l.code).filter(Boolean));
  const costs = {}; Object.keys(F).forEach((c) => { floors[c] = F[c].floor; costs[c] = F[c].cost; });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ proposal: p, fresh, floors, costs, pct: MIN_MARGIN(), canBelow: w.role === 'superadmin', deal: { id: d.id, title: d.title, ref: d.ref, stage: d.stage, customer: d.customer_name, code: d.customer_code }, mailOn: customerMailOn(), url: p.token ? 'https://' + req.headers.host + '/portal#/proposal/' + p.token : null });
};
// type-ahead for adding a part: part number with or without dots and brand prefix, or words from the name
A['proposal-search'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const raw = clean(req.query.q, 60), nq = normPn(raw), words = raw.toLowerCase().split(/\s+/).filter((x) => x.length > 1);
  if (nq.length < 2) return res.json({ rows: [] });
  const [cat, prod] = await Promise.all([cached('catalog/live.json', 60 * 60 * 1000).catch(() => []), cached('portal/products.json', 10 * 60 * 1000).catch(() => null)]);
  const out = [];
  for (const r of (Array.isArray(cat) ? cat : [])) {
    const code = normPn(r[0]), bare = code.replace(/^[a-z]{2,4}(?=\d)/, ''), name = String(r[1] || '').toLowerCase();
    let sc = 0;
    if (code === nq || bare === nq) sc = 100; else if (code.startsWith(nq) || bare.startsWith(nq)) sc = 80; else if (code.includes(nq)) sc = 60; else if (words.length && words.every((x) => name.includes(x))) sc = 30;
    if (sc) out.push([sc, r]);
  }
  out.sort((a, b) => b[0] - a[0]);
  const top = out.slice(0, 10), F = await floorsFor(top.map(([, r]) => r[0])).catch(() => ({}));
  return res.json({ rows: top.map(([, r]) => { const p = prod && prod.items && prod.items[r[0]], f = F[r[0]]; return { code: r[0], name: String(r[1] || '').split(' / ')[0].slice(0, 120), price: p && p.d > 0 ? p.d : null, floor: f ? f.floor : null, cost: f ? f.cost : null }; }) });
};
// Preview of the document as the customer will get it, marked PENDING, before anything is saved or sent. Cost never appears.
A['proposal-preview'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), d = await dealFor(req, res, w, clean(b.id, 60)); if (!d) return;
  const lines = PROP.cleanLines(b.lines); if (!lines.length) return res.status(400).json({ error: 'Add at least one part with a quantity.' });
  const days = Math.min(365, Math.max(1, parseInt(b.valid_days, 10) || 30));
  const v = PROP.view({ number: clean(b.number, 40) || d.ref || 'DRAFT', doc_type: b.doc_type === 'invoice' ? 'invoice' : 'quote', status: 'draft', lines, discount_pct: Math.min(100, Math.max(0, Number(b.discount_pct) || 0)), freight: Math.max(0, Number(b.freight) || 0),
    notes: clean(b.notes, 2000), customer_name: clean(b.customer_name, 120), contact_name: clean(b.contact_name, 120), valid_until: new Date(Date.now() + days * 86400000).toISOString() });
  v.preview = true;
  const buf = await require('../lib/proposal-pdf').build(v);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="preview-' + String(v.number).replace(/[^A-Za-z0-9-]/g, '') + '.pdf"'); res.setHeader('Cache-Control', 'private, no-store');
  return res.send(buf);
};
A['proposal-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), d = await dealFor(req, res, w, clean(b.id, 60)); if (!d) return;
  const lines = PROP.cleanLines(b.lines);
  if (!lines.length) return res.status(400).json({ error: 'Add at least one part with a quantity.' });
  if (b.send && lines.some((l) => !(l.price > 0))) return res.status(400).json({ error: 'Every part needs a price before the proposal goes out.' });
  const pct = Math.min(100, Math.max(0, Number(b.discount_pct) || 0)), freight = Math.max(0, Number(b.freight) || 0), days = Math.min(365, Math.max(1, parseInt(b.valid_days, 10) || 30));
  // margin floor: cost + CAMPAIGN_MIN_MARGIN, on the price the customer actually pays (after the discount). Only a superadmin goes under, with a reason.
  const F = await floorsFor(lines.map((l) => l.code).filter(Boolean)), below = [];
  lines.forEach((l) => { const f = F[l.code]; const net = l.price * (1 - pct / 100); if (f && net < f.floor - 0.004) below.push({ code: l.code, price: Math.round(net * 100) / 100, floor: f.floor }); });
  if (below.length) {
    if (!(w.role === 'superadmin' && b.force)) return res.status(409).json({ error: below.length + ' part' + (below.length === 1 ? ' is' : 's are') + ' under the margin floor (cost + ' + MIN_MARGIN() + '%).' + (w.role === 'superadmin' ? ' Confirm to go under it, with a reason.' : ' Ask a superadmin to approve it.'), below, canBelow: w.role === 'superadmin' });
    if (!clean(b.force_reason, 300)) return res.status(400).json({ error: 'Say why this proposal goes under the margin floor.', below, canBelow: true });
  }
  const now = new Date(), cur = (await db.select('proposals', 'select=*&deal_id=eq.' + d.id + '&limit=1'))[0];
  if (cur && cur.status === 'accepted') return res.status(409).json({ error: 'The customer already accepted this proposal. Open a new deal for changes.' });
  const rec = { deal_id: d.id, ref: d.ref || null, number: (cur && goodNo(cur.number) && cur.number) || await propNumber(d), doc_type: b.doc_type === 'invoice' ? 'invoice' : 'quote', lines, discount_pct: pct, freight: Math.round(freight * 100) / 100,
    notes: String(b.notes || '').slice(0, 1500), valid_days: days, customer_name: clean(b.customer_name, 160) || d.customer_name || null, contact_name: clean(b.contact_name, 120) || d.contact_name || null,
    contact_email: clean(b.contact_email, 160).toLowerCase() || d.contact_email || null, contact_phone: clean(b.contact_phone, 40) || d.contact_phone || null, below_floor: below.length ? { by: w.email, reason: clean(b.force_reason, 300), parts: below } : null,
    created_by: (cur && cur.created_by) || w.email, updated_at: now.toISOString() };
  const t = PROP.calc(lines, pct, freight);
  if (b.send) {
    if (!rec.contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.contact_email)) return res.status(400).json({ error: 'Add a valid customer e-mail to send the proposal.' });
    Object.assign(rec, { status: 'sent', token: (cur && cur.token) || PROP.newToken(), sent_at: now.toISOString(), valid_until: new Date(now.getTime() + days * 864e5).toISOString() });
  } else if (!cur) rec.status = 'draft';
  const saved = cur ? (await db.update('proposals', 'id=eq.' + cur.id, rec))[0] : (await db.insert('proposals', [rec]))[0];
  await PS.audit(w.email, b.send ? 'proposal.send' : 'proposal.save', 'deal', d.id, null, { number: rec.number, total: t.total, below: below.length || undefined, reason: below.length ? clean(b.force_reason, 300) : undefined });
  let mail = null, url = null;
  if (b.send) {
    url = 'https://' + req.headers.host + '/portal#/proposal/' + saved.token;
    await moveDeal(d, 'quote', 'Proposal ' + rec.number + ' sent to ' + rec.contact_email + ' (' + t.total.toFixed(2) + ' USD, valid ' + days + ' days)', w.email, t.total);
    try { await PS.updateQuoteStatus(rec.number, 'Quoted'); } catch (e) {}
    const v = PROP.view(saved);
    try { mail = await send(rec.contact_email, v.label + ' ' + v.number + ' from Maxzz Diesel', 'Your ' + v.label.toLowerCase() + ' is ready', PROP.emailTable(v) + '<p style="margin-top:14px">Open it to review the parts and prices, check your contact, delivery and billing details (change anything that is not right), and accept. Nothing is processed until you accept.</p>', { label: 'Review and accept', url }, { name: rec.contact_name }); } catch (e) { console.error('proposal mail', e.message); }
  }
  return res.json({ ok: true, proposal: saved, totals: t, url, mail: mail ? (mail.sent ? 'sent' : mail.blocked ? 'blocked' : 'not sent') : null });
};

A['crm-deal'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const id = clean(req.query.id, 60), d = (await db.select('crm_deals', 'select=*&id=eq.' + encodeURIComponent(id) + '&limit=1'))[0];
  if (!d) return res.status(404).json({ error: 'deal' });
  const sc = await salesScope(w, { query: {} }); if (w.role !== 'superadmin' && d.owner !== sc.sp) return res.status(403).json({ error: 'scope' });
  const code = d.customer_code, enc = code ? encodeURIComponent(code) : null;
  const [acts, cust, orders, life, others] = await Promise.all([
    db.select('crm_activities', 'select=*&deal_id=eq.' + d.id + '&order=created_at.desc&limit=200'),
    enc ? db.select('ul_customers', 'select=code,name,tier,type,email,contact_name,phone,city,state,country,salesperson,payment_terms,stop_credit,created_on&code=eq.' + enc + '&limit=1').catch(() => []) : [],
    enc ? db.select('sales_orders', 'select=number,order_date,completed_date,subtotal,status&is_return=eq.false&customer_code=eq.' + enc + '&order=order_date.desc&limit=6').catch(() => []) : [],
    enc ? db.select('sales_orders', 'select=subtotal,order_date&is_return=eq.false&customer_code=eq.' + enc + '&limit=5000').catch(() => []) : [],
    enc ? db.select('crm_deals', 'select=id,title,stage,value&customer_code=eq.' + enc + '&id=neq.' + d.id + '&order=updated_at.desc&limit=8').catch(() => []) : [] ]);
  let lines = null;
  if (d.ref && /^[A-Za-z0-9-]+$/.test(d.ref) && d.source !== 'access_request' && configured()) { // what is in the order, at sell price only (never cost)
    try { const o = ((await ul('SalesOrders', 'orderNumber=' + encodeURIComponent(d.ref), { timeoutMs: 9000 })).Items || [])[0];
      if (o) lines = (o.SalesOrderLines || []).filter((l) => l.Product).map((l) => ({ code: l.Product.ProductCode, desc: String(l.Product.ProductDescription || '').slice(0, 90), qty: Number(l.OrderQuantity) || 0, price: Number(l.UnitPrice) || 0, total: Number(l.LineTotal) || 0 })); } catch (e) { lines = null; } }
  const tot = life.reduce((t, x) => t + (Number(x.subtotal) || 0), 0), last = life.reduce((m, x) => (x.order_date > m ? x.order_date : m), '');
  let attr = null; // where the lead came from (UTM, click ids, referrer), matched by contact e-mail
  try { const em = String(d.contact_email || (cust[0] && cust[0].email) || '').trim().toLowerCase();
    if (em && /^[^\s@]+@[^\s@]+$/.test(em)) attr = (await db.select('lead_attribution', 'select=kind,ref,first,last,device,country,created_at&email=eq.' + encodeURIComponent(em) + '&order=created_at.asc&limit=1'))[0] || null; } catch (e) { attr = null; }
  let porder = null; // the portal order behind this deal: lines above stock or without a price wait for a lead time written here
  try { if (d.ref) { const po = (await db.select('orders', 'select=id,number,unleashed_number,status&or=(unleashed_number.eq.' + encodeURIComponent(d.ref) + ',number.eq.' + encodeURIComponent(d.ref) + ')&limit=1'))[0];
    if (po) porder = { id: po.id, number: po.unleashed_number || po.number, lines: (await db.select('order_lines', 'select=line_no,code,name,qty,price,backorder,stock_at_order,lead_note,line_state&order_id=eq.' + po.id + '&order=line_no')).map((l) => ({ no: l.line_no, code: l.code, name: l.name, qty: l.qty, price: l.price == null ? null : Number(l.price), short: !!l.backorder, stock: l.stock_at_order, lead: l.lead_note || '', state: l.line_state || '' })) }; } } catch (e) { console.error('deal portal order', e.message); }
  return res.json({ deal: d, acts, cust: cust[0] || null, orders, life: { sales: tot, orders: life.length, last: last || null }, others, lines, attr, porder });
};
// sales writes the lead time (or the price) of one order line; the customer gets an e-mail and accepts it or takes the line out in the portal
A['order-lead'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), oid = clean(b.order, 40), no = parseInt(b.no, 10), note = clean(b.note, 300);
  if (!PS.isUuid(oid) || !(no > 0) || note.length < 3) return res.status(400).json({ error: 'Write the lead time for this part, for example: ships in 3 weeks.' });
  const o = (await db.select('orders', 'select=id,number,unleashed_number,placed_by,company_id&id=eq.' + oid + '&limit=1'))[0];
  if (!o) return res.status(404).json({ error: 'order' });
  const up = await PS.setLineLead(o.id, no, note, w.email);
  if (!Array.isArray(up) || !up.length) return res.status(404).json({ error: 'line' });
  const num = o.unleashed_number || o.number, line = up[0];
  await PS.audit(w.email, 'order.lead_time', 'order', num, null, { code: line.code, note }).catch(() => {});
  let mailed = false;
  try { const u = o.placed_by ? (await db.select('users', 'select=email,name&id=eq.' + o.placed_by + '&limit=1'))[0] : null;
    if (u && u.email) { await send(u.email, 'Order ' + num + ': please confirm the lead time of one part', 'One part needs your answer',
      '<p>The rest of your order <b>' + esc(num) + '</b> is not affected and keeps moving.</p><p><b>' + esc(line.code) + '</b> × ' + line.qty + '<br><span style="color:#5f656c">' + esc(line.name || '') + '</span></p><p><b>Lead time:</b> ' + esc(note) + '</p><p>Open the order to accept this lead time or to take the part out of the order.</p>',
      { url: base(req) + '/portal#/o/' + o.id, label: 'Open my order' }, { name: u.name, greet: true }); mailed = true; } } catch (e) { console.error('lead time mail', e.message); }
  return res.json({ ok: true, mailed });
};

// category fixed by hand for one or more parts (wins over the Unleashed product group); an empty category goes back to automatic
A['catalog-category'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const FIX = require('../lib/catalog-fix'), b = readBody(req), cat = clean(b.category, 20);
  const codes = [...new Set((Array.isArray(b.codes) ? b.codes : []).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 2000);
  if (!codes.length || (cat && !FIX.CATS[cat])) return res.status(400).json({ error: 'Pick the parts and a category.' });
  for (let i = 0; i < codes.length; i += 200) { const part = codes.slice(i, i + 200);
    if (cat) await db.insert('product_overrides', part.map((code) => ({ code, category: cat, updated_by: w.email, updated_at: new Date().toISOString() })), { onConflict: 'code' });
    else await db.remove('product_overrides', 'code=' + inList(part)); }
  FIX.clear();
  await PS.audit(w.email, 'product.category', 'product', codes.join(',').slice(0, 200), null, { n: codes.length, category: cat || 'automatic' });
  return res.json({ ok: true, n: codes.length });
};

// parts linked by hand to one part: offered first in the store, before the automatic suggestions
A['product-links'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  if (req.method === 'GET') { const code = clean(req.query.code, 60);
    const rows = await db.selectAll('product_links', 'select=code,related_code,pos,created_by,created_at' + (code ? '&code=eq.' + encodeURIComponent(code) : '') + '&order=code,pos');
    return res.json({ links: rows }); }
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const b = readBody(req), code = clean(b.code, 60);
  const rel = [...new Set((Array.isArray(b.related) ? b.related : String(b.related || '').split(/[\s,;]+/)).map((c) => clean(c, 60)).filter((c) => c && c !== code))].slice(0, 12);
  if (!code) return res.status(400).json({ error: 'Pick the part first.' });
  const { readJson } = require('../lib/store');
  const live = await readJson('catalog/live.json').catch(() => null), known = new Set((Array.isArray(live) && live.length ? live : JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'data', 'catalog.json'), 'utf8'))).map((r) => r[0]));
  const bad = rel.filter((c) => !known.has(c)); if (bad.length) return res.status(400).json({ error: 'Not in the catalog: ' + bad.slice(0, 5).join(', ') });
  await db.remove('product_links', 'code=eq.' + encodeURIComponent(code));
  if (rel.length) await db.insert('product_links', rel.map((r, i) => ({ code, related_code: r, pos: i, created_by: w.email })));
  await PS.audit(w.email, 'product.links', 'product', code, null, { related: rel });
  return res.json({ ok: true, n: rel.length });
};

A['crm-cust'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const code = clean(req.query.code, 60); if (!code) return res.json({ deals: [] });
  const sc = await salesScope(w, { query: {} }), isSuper = w.role === 'superadmin';
  if (!isSuper && sc.none) return res.json({ deals: [] });
  const deals = await db.select('crm_deals', 'select=id,title,stage,value,owner,updated_at,expected_close&customer_code=eq.' + encodeURIComponent(code) + (isSuper ? '' : '&owner=eq.' + encodeURIComponent(sc.sp)) + '&order=updated_at.desc&limit=20').catch(() => []);
  return res.json({ deals, stages: await db.select('crm_stages', 'select=key,label,kind,color&order=pos.asc').catch(() => []) });
};
const crmAiMemo = {};
A['crm-ai'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const sc = await salesScope(w, { query: {} }), isSuper = w.role === 'superadmin', key = isSuper ? 'all' : sc.sp || 'none';
  if (req.method !== 'POST') return res.json({ on: aiOn(req), last: crmAiMemo[key] || null });
  if (!originOk(req)) return res.status(405).json({ error: 'method' });
  if (!aiOn(req)) return res.status(409).json({ error: 'AI insights are not switched on yet. Turn on DASH_AI and add the AI Gateway key in Vercel.' });
  if (crmAiMemo[key] && Date.now() - crmAiMemo[key].at < 10 * 60e3) return res.json(crmAiMemo[key]);
  if (!isSuper && sc.none) return res.json({ at: Date.now(), out: { summary: 'Your login is not linked to a salesperson yet.', items: [] } });
  const stages = await db.select('crm_stages', 'select=*&order=pos.asc'), SK = {}; stages.forEach((x) => { SK[x.key] = x; });
  const rows = await db.select('crm_deals', 'select=id,title,stage,owner,customer_code,customer_name,value,source,created_at,stage_at,updated_at,expected_close&closed_at=is.null&order=value.desc&limit=60' + (isSuper ? '' : '&owner=eq.' + encodeURIComponent(sc.sp)));
  const dn = {}; rows.forEach((d) => { dn[d.id] = d; });
  const acts = rows.length ? await db.select('crm_activities', 'select=deal_id,kind,body,due,done_at,created_at&deal_id=in.(' + rows.map((d) => d.id).join(',') + ')&order=created_at.desc&limit=600').catch(() => []) : [];
  const A1 = {}; acts.forEach((a) => { (A1[a.deal_id] = A1[a.deal_id] || []).push(a); });
  const days = (t) => Math.floor((Date.now() - Date.parse(t)) / 864e5), td = new Date().toISOString().slice(0, 10);
  const facts = { today: td, deals: rows.map((d) => ({ id: d.id, title: d.title, company: d.customer_name, stage: SK[d.stage] && SK[d.stage].label, chance: SK[d.stage] && SK[d.stage].prob, value: Number(d.value) || 0, owner: d.owner, source: d.source, age_days: days(d.created_at), days_in_stage: days(d.stage_at), idle_days: days(d.updated_at), expected_close: d.expected_close,
    open_tasks: (A1[d.id] || []).filter((a) => a.kind === 'task' && !a.done_at).map((a) => ({ what: String(a.body || '').slice(0, 80), due: a.due })).slice(0, 3), last_notes: (A1[d.id] || []).filter((a) => a.kind !== 'stage').slice(0, 3).map((a) => a.kind + ': ' + String(a.body || '').slice(0, 100)) })) };
  const prompt = 'You are the sales coach of Maxzz Diesel, a diesel fuel injection parts distributor selling B2B. Below are the open deals in the CRM' + (isSuper ? ' for the whole team' : ' of one salesperson') + '. Tell what matters today. Rank by expected money at risk or to win. Be specific: name the company, the number and the next action. Never invent facts. Plain direct English, no hype, no em dashes. ' +
    'Answer only with JSON: {"summary": "2 to 3 sentences on the state of the pipeline today", "items": [{"deal_id": "id from the data or empty for a team point", "headline": "under 70 characters", "why": "one or two sentences with the evidence", "action": "the next step to take", "channel": "call|email|whatsapp|visit|none", "priority": 1}]}. Up to 7 items.\n\nDATA:\n' + JSON.stringify(facts);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + AI_KEY(req), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error('crm-ai', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: /customer_verification|credit card/i.test(JSON.stringify(j)) ? 'AI Gateway in Vercel needs a credit card on file before it answers.' : r.status === 402 ? 'AI Gateway has no credit left this month.' : r.status === 401 || r.status === 403 ? 'The AI service refused the key. Check AI Gateway in Vercel.' : 'The AI service did not answer. Try again in a minute.' }); }
    const text = String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out || !Array.isArray(out.items)) return res.status(502).json({ error: 'The AI answer could not be read. Try again.' });
    out.items = out.items.filter((i) => i && (!i.deal_id || dn[i.deal_id])).slice(0, 7).map((i) => ({ deal_id: i.deal_id || '', headline: String(i.headline || '').slice(0, 90), why: String(i.why || '').slice(0, 320), action: String(i.action || '').slice(0, 220), channel: String(i.channel || ''), priority: Number(i.priority) || 3, title: i.deal_id ? dn[i.deal_id].customer_name || dn[i.deal_id].title : '' }));
    const doc = { at: Date.now(), model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', out: { summary: String(out.summary || '').slice(0, 500), items: out.items } };
    crmAiMemo[key] = doc; await PS.audit(w.email, 'crm.ai', 'crm', key).catch(() => {});
    return res.json(doc);
  } catch (e) { return res.status(504).json({ error: 'The AI service took too long. Try again.' }); } finally { clearTimeout(t); }
};

// ---- daily briefing: the same one the 7:00 and 18:00 e-mails carry, shown on the Dashboard; a test goes to the person asking only
const digestMemo = {};
A.digest = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const DG = require('../lib/digest'), now = new Date(), when = req.query.when === 'pm' ? 'pm' : req.query.when === 'am' ? 'am' : (DG.hourNY(now) >= 13 ? 'pm' : 'am');
  const hit = digestMemo[when]; if (hit && Date.now() - hit.t < 300000) return res.json(hit.v);
  const b = await DG.build(when, now), v = { when, title: b.title, html: b.html, ai: b.ai, at: Date.now() };
  digestMemo[when] = { t: Date.now(), v }; return res.json(v);
};
A['digest-test'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  if (!internalTo(w.email)) return res.status(400).json({ error: 'Only team addresses can receive it.' });
  const b = readBody(req), when = b.when === 'pm' ? 'pm' : 'am', bl = await require('../lib/digest').build(when, new Date());
  const r = await send(w.email, '[Test] ' + bl.subject, bl.title, bl.html, { url: base(req) + '/admin', label: 'Open the admin' }, { internal: true, team: true });
  return res.json({ ok: !!r.sent, sent: !!r.sent });
};

// ---- @mentions and the bell: notifications for the team (in the admin and by e-mail, team addresses only)
const handlesOf = (a) => { const out = new Set(), e = String(a.email || '').toLowerCase(); out.add(e.split('@')[0]);
  [a.first_name, a.name, a.salesperson].forEach((x) => { const t = String(x || '').trim().split(/\s+/)[0]; if (t) out.add(t.toLowerCase().replace(/[^a-z0-9._-]/g, '')); }); out.delete(''); return [...out]; };
const teamList = async () => (await db.select('admins', 'select=email,name,first_name,last_name,salesperson,photo&active=eq.true').catch(() => [])).map((a) => ({ email: String(a.email).toLowerCase(), name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email, handles: handlesOf(a), photo: a.photo || TEAM_PH[String(a.email).toLowerCase()] || null }));
async function notifyMentions(req, w, d, kind, body, due) {
  try {
    const found = [...new Set((String(body).match(/(^|[^a-z0-9._-])@([a-z0-9._-]{2,40})/gi) || []).map((m) => m.replace(/^[^@]*@/, '').toLowerCase().replace(/[._-]+$/, '')))];
    if (!found.length) return;
    const team = await teamList(), me = String(w.email).toLowerCase(), mine = team.find((t) => t.email === me), from = (mine && mine.name) || w.email, sent = new Set();
    const everyone = found.includes('all') || found.includes('everyone') || found.includes('team');
    const targets = everyone ? team.map((t) => t.handles[0]) : found;
    for (const h of targets) { const t = everyone ? team.find((x) => x.handles[0] === h) : team.find((x) => x.handles.includes(h)); if (!t || t.email === me || sent.has(t.email)) continue; sent.add(t.email);
      const title = from + ' mentioned you in ' + (kind === 'task' ? 'a task' : 'a ' + kind) + ' on ' + (d.title || 'a deal');
      await db.insert('admin_notifications', [{ to_email: t.email, kind: 'mention', title, body: clean(body, 400), deal_id: d.id, from_email: me, from_name: from }]).catch(() => {});
      await send(t.email, title, 'You were mentioned', '<p><b>' + esc(from) + '</b> wrote on <b>' + esc(d.title || 'a deal') + '</b>:</p><p style="padding:10px 14px;background:#f3f4f6;border-radius:8px">' + esc(clean(body, 400)) + '</p>' + (due ? '<p>Due: <b>' + esc(due) + '</b></p>' : ''),
        { url: base(req) + '/admin?deal=' + encodeURIComponent(d.id), label: 'Open the deal' }, { greet: true, team: true }).catch(() => {}); }
  } catch (e) { /* a mention must never break saving the note */ }
}
A.notifs = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  const rows = await db.select('admin_notifications', 'select=id,kind,title,body,deal_id,from_name,created_at,read_at&to_email=eq.' + encodeURIComponent(String(w.email).toLowerCase()) + '&order=created_at.desc&limit=25').catch(() => []);
  return res.json({ items: rows, unread: rows.filter((r) => !r.read_at).length });
};
A['notifs-read'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return; const b = readBody(req), to = encodeURIComponent(String(w.email).toLowerCase());
  const ids = Array.isArray(b.ids) ? b.ids.map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 50) : null;
  await db.update('admin_notifications', 'to_email=eq.' + to + '&read_at=is.null' + (ids ? '&id=in.(' + ids.join(',') + ')' : ''), { read_at: new Date().toISOString() }).catch(() => {});
  return res.json({ ok: true });
};

// ---- CRM contacts: people as their own records (one e-mail, one contact), linked to a company by Unleashed code
const upsertContact = async (w, c, owner) => { try { const email = clean(c.email, 160).toLowerCase(); if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return;
  const row = { email, name: clean(c.name, 120) || null, phone: clean(c.phone, 60) || null, customer_code: clean(c.customer_code, 60) || null, company_name: clean(c.company_name, 160) || null, owner: owner || null, created_by: w.email, updated_at: new Date().toISOString() };
  Object.keys(row).forEach((k) => { if (row[k] == null) delete row[k]; });
  await db.insert('crm_contacts', [row], { onConflict: 'email' }); } catch (e) { /* best effort */ } };
A['crm-contacts'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const sc = await salesScope(w, { query: {} }), isSuper = w.role === 'superadmin';
  if (!isSuper && sc.none) return res.json({ contacts: [] });
  const [rows, deals] = await Promise.all([db.select('crm_contacts', 'select=*&order=updated_at.desc&limit=1500' + (isSuper ? '' : '&owner=eq.' + encodeURIComponent(sc.sp))), db.select('crm_deals', 'select=id,contact_email,stage,value&contact_email=not.is.null&limit=3000' + (isSuper ? '' : '&owner=eq.' + encodeURIComponent(sc.sp))).catch(() => [])]);
  const by = {}; deals.forEach((d) => { const k = String(d.contact_email).toLowerCase(); (by[k] = by[k] || { n: 0, open: 0, value: 0 }).n++; if (!['won', 'lost'].includes(d.stage)) { by[k].open++; by[k].value += Number(d.value) || 0; } });
  rows.forEach((r) => { r.deals = by[r.email] || { n: 0, open: 0, value: 0 }; });
  return res.json({ contacts: rows });
};
A['contact-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), isSuper = w.role === 'superadmin', sc = await salesScope(w, { query: {} });
  if (!isSuper && sc.none) return res.status(403).json({ error: 'scope' });
  const id = clean(b.id, 60), cur = id ? (await db.select('crm_contacts', 'select=*&id=eq.' + encodeURIComponent(id) + '&limit=1'))[0] : null;
  if (id && !cur) return res.status(404).json({ error: 'contact' });
  if (cur && !isSuper && cur.owner !== sc.sp) return res.status(403).json({ error: 'scope' });
  if (b.del) { if (!cur) return res.status(400).json({ error: 'contact' }); await db.remove('crm_contacts', 'id=eq.' + cur.id); await PS.audit(w.email, 'crm.contact.delete', 'contact', cur.id, null, {}).catch(() => {}); return res.json({ ok: true }); }
  const email = clean(b.email, 160).toLowerCase(), name = clean(b.name, 120);
  if (!name && !email) return res.status(400).json({ error: 'Add a name or an e-mail.' });
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Check the e-mail address.' });
  const p = { name: name || null, email: email || null, phone: clean(b.phone, 60) || null, role: clean(b.role, 80) || null, customer_code: clean(b.customer_code, 60) || null, company_name: clean(b.company_name, 160) || null, updated_at: new Date().toISOString() };
  try {
    if (cur) await db.update('crm_contacts', 'id=eq.' + cur.id, p);
    else await db.insert('crm_contacts', [Object.assign(p, { owner: isSuper ? (clean(b.owner, 120) || CRM_OWNER) : sc.sp, created_by: w.email })]);
  } catch (e) { return res.status(409).json({ error: 'A contact with this e-mail already exists.' }); }
  return res.json({ ok: true });
};
A['crm-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const b = readBody(req), isSuper = w.role === 'superadmin', sc = await salesScope(w, { query: {} }), now = new Date().toISOString();
  const st = await db.select('crm_stages', 'select=key,kind,label'), SK = {}; st.forEach((s) => { SK[s.key] = s; });
  const log = (id, kind, body, due) => db.insert('crm_activities', [{ deal_id: id, kind, body: clean(body, 1000) || null, due: due || null, created_by: w.email }]);
  const mine = async (id) => { const d = (await db.select('crm_deals', 'select=*&id=eq.' + encodeURIComponent(clean(id, 60)) + '&limit=1'))[0]; if (!d) return null; return isSuper || d.owner === sc.sp ? d : false; };
  if (/^stage_/.test(b.kind || '')) {
    if (!isSuper) return res.status(403).json({ error: 'role' });
    const all = await db.select('crm_stages', 'select=*&order=pos.asc'), byK = {}; all.forEach((x) => { byK[x.key] = x; });
    const renum = async (open) => { const ord = open.concat(all.filter((x) => x.kind === 'won'), all.filter((x) => x.kind === 'lost')); for (let i = 0; i < ord.length; i++) if (ord[i].pos !== (i + 1) * 10) await db.update('crm_stages', 'key=eq.' + encodeURIComponent(ord[i].key), { pos: (i + 1) * 10 }); };
    const open = all.filter((x) => x.kind === 'open');
    if (b.kind === 'stage_add') {
      const label = clean(b.label, 40); if (!label) return res.status(400).json({ error: 'label' });
      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'stage'; while (byK[key]) key += '2';
      await db.insert('crm_stages', [{ key, label, pos: 9999, kind: 'open', color: '#8b7cf6', prob: 20 }]); all.push({ key, label, pos: 9999, kind: 'open' }); open.push({ key, pos: 9999, kind: 'open' }); await renum(open);
      await PS.audit(w.email, 'crm.stage_add', 'crm', key).catch(() => {}); return res.json({ ok: true });
    }
    const x = byK[clean(b.key, 40)]; if (!x) return res.status(404).json({ error: 'stage' });
    if (b.kind === 'stage_edit') {
      const p = {}; if (b.label != null) p.label = clean(b.label, 40) || x.label;
      if (b.prob != null && x.kind === 'open') p.prob = Math.min(95, Math.max(1, Math.round(Number(b.prob) || x.prob)));
      if (b.color != null && /^#[0-9a-fA-F]{6}$/.test(b.color)) p.color = b.color;
      await db.update('crm_stages', 'key=eq.' + encodeURIComponent(x.key), p); await PS.audit(w.email, 'crm.stage_edit', 'crm', x.key, null, p).catch(() => {}); return res.json({ ok: true });
    }
    if (b.kind === 'stage_move') {
      if (x.kind !== 'open') return res.status(400).json({ error: 'stage' }); const i = open.findIndex((y) => y.key === x.key), j = i + (Number(b.dir) < 0 ? -1 : 1); if (j < 0 || j >= open.length) return res.json({ ok: true });
      [open[i], open[j]] = [open[j], open[i]]; await renum(open); return res.json({ ok: true });
    }
    if (b.kind === 'stage_del') {
      if (x.kind !== 'open') return res.status(400).json({ error: 'stage' }); if (open.length <= 2) return res.status(400).json({ error: 'Keep at least two open stages.' });
      const n = (await db.select('crm_deals', 'select=id&stage=eq.' + encodeURIComponent(x.key) + '&limit=1')).length; if (n) return res.status(400).json({ error: 'Move the deals out of this stage first.' });
      await db.remove('crm_stages', 'key=eq.' + encodeURIComponent(x.key)); await PS.audit(w.email, 'crm.stage_del', 'crm', x.key).catch(() => {}); return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'kind' });
  }
  if (b.kind === 'create') {
    const title = clean(b.title, 160); if (!title) return res.status(400).json({ error: 'title' });
    const owner = isSuper ? (clean(b.owner, 120) || CRM_OWNER) : sc.sp; if (!owner) return res.status(403).json({ error: 'scope' });
    const row = (await db.insert('crm_deals', [{ title, stage: (SK[b.stage] && SK[b.stage].kind === 'open' ? b.stage : 'new'), owner, customer_code: clean(b.customer_code, 60) || null, customer_name: clean(b.customer_name, 160) || null, contact_name: clean(b.contact_name, 120) || null, contact_email: clean(b.contact_email, 160) || null, contact_phone: clean(b.contact_phone, 60) || null, expected_close: ISO10.test(b.expected_close || '') ? b.expected_close : null, value: Math.max(0, Number(b.value) || 0), source: 'manual', note: clean(b.note, 1000) || null, created_by: w.email }]))[0];
    if (row) await log(row.id, 'stage', 'Created by ' + w.email);
    if (row) await upsertContact(w, { name: b.contact_name, email: b.contact_email, phone: b.contact_phone, customer_code: b.customer_code, company_name: b.customer_name }, owner);
    return res.json({ ok: true, id: row && row.id });
  }
  const d = await mine(b.id); if (d === null) return res.status(404).json({ error: 'deal' }); if (d === false) return res.status(403).json({ error: 'scope' });
  if (b.kind === 'move') {
    const to = SK[b.stage]; if (!to) return res.status(400).json({ error: 'stage' });
    if (to.kind === 'lost' && !clean(b.reason, 300)) return res.status(400).json({ error: 'reason' });
    const closed = to.kind !== 'open';
    await db.update('crm_deals', 'id=eq.' + d.id, { stage: to.key, stage_at: now, updated_at: now, closed_at: closed ? now : null, lost_reason: to.kind === 'lost' ? clean(b.reason, 300) : null });
    await log(d.id, 'stage', 'Moved to ' + to.label + (to.kind === 'lost' ? ': ' + clean(b.reason, 300) : ''));
    return res.json({ ok: true });
  }
  if (b.kind === 'edit') {
    const p = { updated_at: now };
    if (b.title != null) p.title = clean(b.title, 160) || d.title;
    if (b.value != null) p.value = Math.max(0, Number(b.value) || 0);
    if (b.note != null) p.note = clean(b.note, 1000) || null;
    ['contact_name', 'contact_phone'].forEach((k) => { if (b[k] != null) p[k] = clean(b[k], 120) || null; });
    if (b.contact_email != null) p.contact_email = clean(b.contact_email, 160) || null;
    if (b.expected_close != null) p.expected_close = ISO10.test(b.expected_close) ? b.expected_close : null;
    if (b.owner != null && isSuper && clean(b.owner, 120) !== d.owner) { p.owner = clean(b.owner, 120); await log(d.id, 'owner', 'Owner changed from ' + (d.owner || 'nobody') + ' to ' + p.owner); }
    await db.update('crm_deals', 'id=eq.' + d.id, p);
    if (b.contact_email != null || b.contact_name != null || b.contact_phone != null) await upsertContact(w, { name: p.contact_name != null ? p.contact_name : d.contact_name, email: p.contact_email != null ? p.contact_email : d.contact_email, phone: p.contact_phone != null ? p.contact_phone : d.contact_phone, customer_code: d.customer_code, company_name: d.customer_name }, d.owner);
    return res.json({ ok: true });
  }
  if (['note', 'call', 'email', 'task'].includes(b.kind)) {
    const body = clean(b.body, 1000); if (!body) return res.status(400).json({ error: 'body' });
    const due = b.kind === 'task' && ISO10.test(b.due || '') ? b.due : null;
    await log(d.id, b.kind, body, due); await db.update('crm_deals', 'id=eq.' + d.id, { updated_at: now });
    await notifyMentions(req, w, d, b.kind, body, due);
    return res.json({ ok: true });
  }
  if (b.kind === 'done') { await db.update('crm_activities', 'id=eq.' + encodeURIComponent(clean(b.act, 60)) + '&deal_id=eq.' + d.id, { done_at: now }); return res.json({ ok: true }); }
  return res.status(400).json({ error: 'kind' });
};
A['dash-sync'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const out = await require('../lib/sales-sync').run(45 * 1000);
  return res.json(Object.assign({ ok: !out.error }, out));
};

// ---------------------------------------------------------------- loyalty (off until the rules are decided)
A.loyalty = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales', 'marketing')) return res.status(403).json({ error: 'role' });
  const s = (await db.select('loyalty_settings', 'select=*&id=eq.1'))[0];
  const rows = await db.select('loyalty_ledger', 'select=company_id,points');
  const bal = {}; rows.forEach((r) => { bal[r.company_id] = (bal[r.company_id] || 0) + r.points; });
  return res.json({ settings: s, companies_with_points: Object.keys(bal).length, points_outstanding: Object.values(bal).reduce((a, b) => a + b, 0) });
};
// ---- Sales > Analytics. Superadmin sees everyone; the sales role sees only the salesperson mapped to it in Admin users.
// Cost and profit come only from the cost at the time of the sale (never the current product cost) and stay inside the admin.
const ISO10 = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const spanDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
async function salesScope(w, req) {
  if (w.role === 'superadmin') { const q = clean(req.query.sp, 120); return { sp: q && q !== 'all' ? q : null, all: true }; }
  const a = (await db.select('admins', 'select=salesperson&email=eq.' + encodeURIComponent(w.email) + '&limit=1').catch(() => []))[0] || {};
  return a.salesperson ? { sp: a.salesperson, all: false } : { sp: null, all: false, none: true };
}
const m$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const sumBy = (rows, f) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
A['sales-data'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const sc = await salesScope(w, req);
  const today = new Date().toISOString().slice(0, 10);
  let to = ISO10.test(req.query.to || '') ? req.query.to : today, from = ISO10.test(req.query.from || '') ? req.query.from : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (spanDays(from, to) > 3700) from = addDays(to, -3699);
  const cmp = ['prev', 'year', 'none'].includes(req.query.cmp) ? req.query.cmp : 'prev';
  const n = spanDays(from, to);
  const pf = cmp === 'year' ? addDays(from, -365) : addDays(from, -n), pt = cmp === 'year' ? addDays(to, -365) : addDays(from, -1);
  const empty = { orders: [], days: [], parts: [] };
  const [cur, prv, comm, N] = await Promise.all([
    sc.none ? empty : db.rpc('sales_agg', { p_from: from, p_to: to, p_sp: sc.sp }),
    sc.none || cmp === 'none' ? empty : db.rpc('sales_agg', { p_from: pf, p_to: pt, p_sp: sc.sp }),
    db.select('sales_commission', 'select=*').catch(() => []), names(),
  ]);
  const rule = {}; comm.forEach((r) => { rule[r.salesperson] = r; });
  const prof = (r) => (Number(r.cov) || 0) - (Number(r.cost) || 0);
  const comOf = (sp, sales, profit) => { const r = rule[sp]; return r ? (r.basis === 'sales' ? sales : profit) * Number(r.pct) / 100 : 0; };
  const kpi = (d) => {
    const sales = sumBy(d.orders, (r) => r.sales), cost = sumBy(d.orders, (r) => r.cost), cov = sumBy(d.orders, (r) => r.cov), orders = sumBy(d.orders, (r) => r.cnt);
    const bySp = {}; d.orders.forEach((r) => { const b = bySp[r.sp] || (bySp[r.sp] = { sales: 0, profit: 0 }); b.sales += Number(r.sales) || 0; b.profit += prof(r); });
    const commission = Object.keys(bySp).reduce((t, k) => t + comOf(k, bySp[k].sales, bySp[k].profit), 0);
    return { sales, cost, cov, profit: cov - cost, margin: cov ? (cov - cost) / cov : null, coverage: sales ? cov / sales : null, orders, customers: new Set(d.orders.filter((r) => Number(r.sales) > 0).map((r) => r.c)).size, aov: orders ? sales / orders : null, commission };
  };
  const group = (d, key, extra) => { const m = {}; d.orders.forEach((r) => { const k = r[key]; const g = m[k] || (m[k] = Object.assign({ k, sales: 0, cost: 0, cov: 0, cnt: 0, months: {} }, extra ? extra(r) : {})); g.sales += Number(r.sales) || 0; g.cost += Number(r.cost) || 0; g.cov += Number(r.cov) || 0; g.cnt += Number(r.cnt) || 0; g.months[r.ym] = (g.months[r.ym] || 0) + (Number(r.sales) || 0); if (key === 'c') { g.sps = g.sps || {}; g.sps[r.sp] = (g.sps[r.sp] || 0) + (Number(r.sales) || 0); g.comm = (g.comm || 0) + comOf(r.sp, Number(r.sales) || 0, prof(r)); } }); return m; };
  const cu = group(cur, 'c', (r) => ({ n: r.n })), pc = group(prv, 'c'), su = group(cur, 'sp'), sp0 = group(prv, 'sp');
  const customers = Object.values(cu).sort((a, b) => b.sales - a.sales).slice(0, 3000).map((g) => ({ c: g.k, n: g.n, sales: g.sales, profit: g.cov - g.cost, cov: g.cov, orders: g.cnt, comm: g.comm || 0, sp: Object.keys(g.sps || {}).sort((a, b) => g.sps[b] - g.sps[a])[0] || '', months: g.months, prev: pc[g.k] ? pc[g.k].sales : 0 }));
  const people = Object.values(su).sort((a, b) => b.sales - a.sales).map((g) => ({ sp: g.k, sales: g.sales, profit: g.cov - g.cost, cov: g.cov, orders: g.cnt, comm: comOf(g.k, g.sales, g.cov - g.cost), prev: sp0[g.k] ? sp0[g.k].sales : 0, rule: rule[g.k] ? { basis: rule[g.k].basis, pct: Number(rule[g.k].pct) } : null }));
  const pp = {}; (prv.parts || []).forEach((r) => { pp[r.code] = r; });
  const parts = (cur.parts || []).slice(0, 120).map((r) => ({ code: r.code, name: (N[r.code] && N[r.code].t) || '', qty: r.qty, sales: r.sales, profit: (Number(r.cov) || 0) - (Number(r.cost) || 0), prev: pp[r.code] ? pp[r.code].sales : 0 }));
  // signals: plain rules over the numbers above, each with the evidence behind it and what to do about it
  const signals = [];
  const ev = (arr, f) => arr.slice(0, 25).map(f);
  const rowOf = (c, note) => ({ c: c.c, n: c.n, a: Math.round(c.sales), b: Math.round(c.prev), sp: c.sp, note: note || '' });
  const prevOnly = Object.values(pc).filter((g) => g.sales > 0 && !cu[g.k]);
  const named = {}; (cur.orders || []).concat(prv.orders || []).forEach((r) => { if (r.c && r.n) named[r.c] = r.n; });
  if (cmp !== 'none') {
    const gone = prevOnly.filter((g) => g.sales >= 3000).sort((a, b) => b.sales - a.sales).map((g) => ({ c: g.k, n: named[g.k] || g.k, a: 0, b: Math.round(g.sales), sp: '', note: 'Bought before, nothing in this period' }));
    if (gone.length) signals.push({ id: 'quiet', sev: 'high', title: 'Customers gone quiet', n: gone.length, tip: gone.length + ' customers that bought ' + m$(sumBy(gone, (r) => r.b)) + ' in the comparison period have not bought in this one.', text: 'These customers bought in the comparison period and have not ordered since. Call them before they settle with another supplier: ask if something went wrong, offer a restock on their usual parts.', rows: gone.slice(0, 25) });
    const down = customers.filter((c) => c.prev >= 5000 && c.sales > 0 && c.sales <= c.prev * 0.6).sort((a, b) => (b.prev - b.sales) - (a.prev - a.sales));
    if (down.length) signals.push({ id: 'down', sev: 'high', title: 'Spending dropped', n: down.length, tip: down.length + ' customers are buying at least 40% less than in the comparison period.', text: 'Same customers, clearly smaller baskets. Check what changed: price, stock outs, a competitor, or a shop that slowed down. A quote on their usual parts is a good opener.', rows: ev(down, (c) => rowOf(c, Math.round((1 - c.sales / c.prev) * 100) + '% less')) });
    const up = customers.filter((c) => c.sales >= 5000 && c.prev > 0 && c.sales >= c.prev * 1.5).sort((a, b) => (b.sales - b.prev) - (a.sales - a.prev));
    if (up.length) signals.push({ id: 'up', sev: 'good', title: 'Growing accounts', n: up.length, tip: up.length + ' customers are buying at least 50% more than before.', text: 'Worth a thank you and a conversation about what else they could stock with you. Good candidates for a tier review.', rows: ev(up, (c) => rowOf(c, '+' + Math.round((c.sales / c.prev - 1) * 100) + '%')) });
    const fresh = customers.filter((c) => c.prev === 0 && c.sales >= 1000).sort((a, b) => b.sales - a.sales);
    if (fresh.length) signals.push({ id: 'new', sev: 'info', title: 'New or returning buyers', n: fresh.length, tip: fresh.length + ' customers bought in this period and not in the comparison one.', text: 'First orders and customers that came back. A call in the first 30 days decides whether they become regulars.', rows: ev(fresh, (c) => rowOf(c, 'No sales in the comparison period')) });
  }
  const low = customers.filter((c) => c.cov >= 3000 && c.profit / c.cov < 0.1).sort((a, b) => a.profit / a.cov - b.profit / b.cov);
  if (low.length) signals.push({ id: 'margin', sev: 'high', title: 'Thin margin', n: low.length, tip: low.length + ' customers earn under 10% margin on the sales that have a recorded cost.', text: 'Margin is measured on lines with the cost recorded at the time of the sale. Review the tier and the discounts given to these accounts.', rows: ev(low, (c) => rowOf(c, 'Margin ' + Math.round(c.profit / c.cov * 100) + '%')) });
  const topC = customers[0], totS = sumBy(customers, (c) => c.sales);
  if (topC && totS > 0 && topC.sales / totS >= 0.25) signals.push({ id: 'conc', sev: 'med', title: 'One customer is a quarter of sales', n: 1, tip: topC.n + ' is ' + Math.round(topC.sales / totS * 100) + '% of the sales in this period.', text: 'A lot rides on one account. Protect it, and look for customers of similar profile to spread the risk.', rows: [rowOf(topC, Math.round(topC.sales / totS * 100) + '% of sales')] });
  const unas = customers.filter((c) => c.sp === 'Unassigned');
  if (unas.length) signals.push({ id: 'unas', sev: 'med', title: 'Sales without a salesperson', n: unas.length, tip: unas.length + ' customers have sales but no salesperson in Unleashed.', text: 'Set the salesperson on the customer in Unleashed so the sale and the commission land with the right person.', rows: ev(unas, (c) => rowOf(c, '')) });
  const k0 = kpi(cur);
  if (k0.sales > 0 && k0.coverage != null && k0.coverage < 0.7) signals.push({ id: 'cost', sev: 'info', title: 'Profit covers part of the sales', n: 1, tip: 'Only ' + Math.round(k0.coverage * 100) + '% of the sales in this period have a recorded cost.', text: 'The cost at the time of the sale is being loaded from Unleashed for older orders. Profit and margin firm up as the history load finishes.', rows: [] });
  let everyone = [];
  if (sc.all) everyone = [...new Set([...people.map((x) => x.sp), ...comm.map((x) => x.salesperson), ...(await db.selectAll('ul_customers', 'select=salesperson&salesperson=not.is.null').catch(() => [])).map((x) => x.salesperson)])].sort();
  // week by week: the same aggregate, asked once per week (Monday to Sunday, at most the last 27 weeks of the period)
  let weeks = null;
  if (req.query.g === 'week' && !sc.none) {
    const ws = []; let mon = addDays(to, -((new Date(to + 'T00:00:00Z').getUTCDay() + 6) % 7));
    while (mon >= addDays(from, -6) && ws.length < 27) { const a0 = mon < from ? from : mon, b0 = addDays(mon, 6) > to ? to : addDays(mon, 6); if (a0 <= b0) ws.unshift([mon, a0, b0]); mon = addDays(mon, -7); }
    const per = await Promise.all(ws.map((x) => db.rpc('sales_agg', { p_from: x[1], p_to: x[2], p_sp: sc.sp }).catch((e) => { console.error('sales week', x[0], e.message); return null; })));
    if (per.every(Boolean)) { const byC = {}; customers.forEach((c) => { c.weeks = {}; byC[c.c] = c; });
      per.forEach((d, i) => { (d.orders || []).forEach((r) => { const c = byC[r.c]; if (c) c.weeks[ws[i][0]] = (c.weeks[ws[i][0]] || 0) + (Number(r.sales) || 0); }); });
      weeks = ws.map((x) => x[0]); }
  }
  return res.json({ from, to, pf, pt, cmp, scope: sc.all ? (sc.sp || 'all') : (sc.sp || null), none: !!sc.none, role: w.role, weeks, kpi: kpi(cur), prev: cmp === 'none' ? null : kpi(prv),
    days: (cur.days || []).map((r) => [r.d, Number(r.sales) || 0, (Number(r.cov) || 0) - (Number(r.cost) || 0)]), pdays: (prv.days || []).map((r) => [r.d, Number(r.sales) || 0, (Number(r.cov) || 0) - (Number(r.cost) || 0)]),
    customers, people, parts, signals, everyone, rules: sc.all ? comm.map((r) => ({ sp: r.salesperson, basis: r.basis, pct: Number(r.pct) })) : null });
};
// ---- sales mix: the same period cut by category, part type, brand, customer type (channel) or state (region)
A['sales-mix'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const sc = await salesScope(w, req); if (sc.none) return res.json({ rows: [], total: 0 });
  const today = new Date().toISOString().slice(0, 10), to = ISO10.test(req.query.to || '') ? req.query.to : today;
  let from = ISO10.test(req.query.from || '') ? req.query.from : addDays(to, -29); if (from > to) from = to;
  if (spanDays(from, to) > 3700) from = addDays(to, -3699);
  const dim = ['category', 'type', 'brand', 'channel', 'region'].includes(req.query.dim) ? req.query.dim : 'category';
  const prof = (r) => (Number(r.cov) || 0) - (Number(r.cost) || 0);
  let src = [], key;
  if (['channel', 'region'].includes(dim)) {
    const ag = await db.rpc('sales_agg', { p_from: from, p_to: to, p_sp: sc.sp }); src = ag.orders || [];
    const codes = [...new Set(src.map((r) => r.c).filter(Boolean))], cu = {};
    for (let i = 0; i < codes.length; i += 150) (await db.select('ul_customers', 'select=code,type,state,country&code=' + inList(codes.slice(i, i + 150))).catch(() => [])).forEach((x) => { cu[x.code] = x; });
    key = (r) => { const c = cu[r.c] || {}; return dim === 'channel' ? (c.type || 'No customer type') : ([c.state, c.country && c.country !== 'United States' ? c.country : ''].filter(Boolean).join(', ') || 'No address'); };
  } else {
    src = await db.rpc('sales_by_code', { p_from: from, p_to: to, p_sp: sc.sp }); src = Array.isArray(src) ? src : [];
    const cat = await cached('catalog/live.json', 60 * 60 * 1000).catch(() => null), cm = {}; (Array.isArray(cat) ? cat : []).forEach((r) => { cm[r[0]] = r; });
    key = (r) => { const c = cm[r.code]; if (!c) return 'Not in the catalog'; return (dim === 'brand' ? c[4] : dim === 'type' ? c[2] : c[3]) || 'Not set'; };
  }
  const g = {}; src.forEach((r) => { const k = key(r), x = g[k] || (g[k] = { k, sales: 0, profit: 0, cov: 0, lines: 0 }); x.sales += Number(r.sales) || 0; x.profit += prof(r); x.cov += Number(r.cov) || 0; x.lines += r.cnt != null ? Number(r.cnt) || 0 : 1; });
  const rows = Object.values(g).filter((x) => Math.abs(x.sales) > 0.5).sort((a, b) => b.sales - a.sales).slice(0, 60), total = rows.reduce((t, x) => t + x.sales, 0);
  return res.json({ from, to, dim, total, rows: rows.map((x) => ({ k: x.k, sales: x.sales, profit: x.profit, margin: x.cov ? x.profit / x.cov : null, share: total ? x.sales / total : 0 })) });
};
// ---- monthly commission close: a closed month keeps the numbers it had at closing, so a later edit in Unleashed does not change what was paid.
A['commission-close'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const post = req.method === 'POST';
  if (post && !originOk(req)) return res.status(405).json({ error: 'method' });
  const b = post ? readBody(req) : req.query || {};
  const ym = String(b.ym || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return res.status(400).json({ error: 'Pick a month.' });
  const from = ym + '-01', to = ym + '-' + String(monthDays(ym)).padStart(2, '0');
  const thisMonth = new Date().toISOString().slice(0, 7);
  const sc = await salesScope(w, req);
  const [agg, rules, closed] = await Promise.all([
    sc.none ? [] : db.rpc('sales_agg', { p_from: from, p_to: to, p_sp: post ? null : sc.sp }).then((d) => d.orders || []),
    db.select('sales_commission', 'select=*').catch(() => []),
    db.select('commission_closes', 'select=*&ym=eq.' + ym).catch(() => []),
  ]);
  const rule = {}; rules.forEach((r) => { rule[r.salesperson] = r; });
  const by = {}; agg.forEach((r) => { const k = r.sp || 'Unassigned'; const x = by[k] || (by[k] = { sales: 0, profit: 0 }); x.sales += Number(r.sales) || 0; x.profit += (Number(r.cov) || 0) - (Number(r.cost) || 0); });
  const live = Object.keys(by).filter((k) => k !== 'Unassigned').sort((a, c) => by[c].sales - by[a].sales).map((sp) => {
    const r = rule[sp], base = r ? (r.basis === 'sales' ? by[sp].sales : by[sp].profit) : 0;
    return { sp, sales: by[sp].sales, profit: by[sp].profit, basis: r ? r.basis : null, pct: r ? Number(r.pct) : null, commission: r ? Math.round(base * Number(r.pct)) / 100 : 0 };
  });
  if (post) {
    if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin closes or reopens a month.' });
    if (b.kind === 'reopen') {
      await db.remove('commission_closes', 'ym=eq.' + ym);
      await PS.audit(w.email, 'commission.reopen', 'month', ym, null, null);
      return res.json({ ok: true });
    }
    if (ym >= thisMonth) return res.status(400).json({ error: 'A month can be closed only after it ends.' });
    if (closed.length) return res.status(400).json({ error: 'That month is already closed.' });
    if (!live.length) return res.status(400).json({ error: 'No sales in that month.' });
    await db.insert('commission_closes', live.map((x) => ({ ym, salesperson: x.sp, basis: x.basis, pct: x.pct, sales: x.sales, profit: x.profit, commission: x.commission, closed_by: w.email })));
    await PS.audit(w.email, 'commission.close', 'month', ym, null, { total: live.reduce((t, x) => t + x.commission, 0) });
    return res.json({ ok: true });
  }
  const frozen = {}; closed.forEach((c) => { frozen[c.salesperson] = c; });
  const rows = (closed.length ? Object.keys(frozen).filter((k) => (sc.all && !sc.sp) || k === sc.sp) : live.map((x) => x.sp)).map((sp) => {
    const l = live.find((x) => x.sp === sp) || { sales: 0, profit: 0, commission: 0 }, f = frozen[sp];
    return { sp, sales: f ? Number(f.sales) : l.sales, profit: f ? Number(f.profit) : l.profit, basis: f ? f.basis : l.basis, pct: f ? (f.pct == null ? null : Number(f.pct)) : l.pct, commission: f ? Number(f.commission) : l.commission, now: f ? l.commission : null };
  });
  return res.json({ ym, closed: closed.length ? { by: closed[0].closed_by, at: closed[0].closed_at } : null, canClose: ym < thisMonth, rows });
};
A['sales-commission'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin sets commission.' });
  const b = readBody(req), sp = clean(b.salesperson, 120), basis = b.basis === 'sales' ? 'sales' : 'profit', pct = Number(b.pct);
  if (!sp) return res.status(400).json({ error: 'Pick a salesperson.' });
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Percent must be between 0 and 100.' });
  await db.insert('sales_commission', [{ salesperson: sp, basis, pct: Math.round(pct * 100) / 100, updated_by: w.email, updated_at: new Date().toISOString() }], { onConflict: 'salesperson' });
  await PS.audit(w.email, 'commission.save', 'salesperson', sp, null, { basis, pct });
  return res.json({ ok: true });
};
// ---- Sales > Goals & rewards: goals per salesperson and month, a points and levels program, badges, weekly and monthly awards.
// Everything is worked out from the synced sales. Superadmin sets goals and the program; the sales role sees the ranking
// (names, % of goal, points, level, badges) but dollar amounts only for itself.
const PROG_DEFAULT = {
  pts: { per100: 1, goal: 200, margin: 100, newc: 50, back: 75 }, marginTarget: 0.15, autoGoalPct: 5,
  levels: [['Skates', 0], ['Scooter', 1000], ['Bicycle', 3000], ['Motorbike', 8000], ['Pickup', 20000], ['Big Rig', 50000]],
  awards: [
    { id: 'week_top', cycle: 'week', rule: 'top', text: 'Top of the week: lunch on the team' },
    { id: 'week_goal', cycle: 'week', rule: 'goal', text: 'Weekly goal reached: leave early on Friday' },
    { id: 'month_top', cycle: 'month', rule: 'top', text: 'Top of the month: gift card' },
    { id: 'month_goal', cycle: 'month', rule: 'goal', text: 'Monthly goal reached: bonus day off' }],
};
const isoDay = (d) => d.toISOString().slice(0, 10);
const mondayOf = (iso) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return isoDay(t); };
const monthDays = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const ymAdd = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
function progCfg(row) { const c = (row && row.config) || {}; return { pts: Object.assign({}, PROG_DEFAULT.pts, c.pts), marginTarget: c.marginTarget != null ? c.marginTarget : PROG_DEFAULT.marginTarget, autoGoalPct: c.autoGoalPct != null ? c.autoGoalPct : PROG_DEFAULT.autoGoalPct, levels: Array.isArray(c.levels) && c.levels.length ? c.levels : PROG_DEFAULT.levels, awards: Array.isArray(c.awards) ? c.awards : PROG_DEFAULT.awards }; }
A['sales-program'] = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w, 'sales')) return res.status(403).json({ error: 'role' });
  const sc = await salesScope(w, { query: {} }), isSuper = w.role === 'superadmin';
  const today = isoDay(new Date()), ym = today.slice(0, 7), wk = mondayOf(today), md = monthDays(ym), ms0 = ym + '-01';
  const weeks = [1, 2, 3, 4].map((i) => { const a = isoDay(new Date(Date.parse(wk + 'T00:00:00Z') - i * 7 * 864e5)); return [a, isoDay(new Date(Date.parse(a + 'T00:00:00Z') + 6 * 864e5))]; });
  const [dayR, weekR, monR, months, goalRows, cfgRow, log, ...pastW] = await Promise.all([
    db.rpc('sales_sp_period', { p_from: today, p_to: today }), db.rpc('sales_sp_period', { p_from: wk, p_to: today }), db.rpc('sales_sp_period', { p_from: ms0, p_to: today }),
    db.rpc('sales_sp_months'), db.select('sales_goals', 'select=salesperson,ym,target&limit=2000').catch(() => []), db.select('sales_program', 'select=config&id=eq.1').then((r) => r[0]).catch(() => null),
    db.select('sales_award_log', 'select=*&order=cycle.desc&limit=400').catch(() => []), ...weeks.map((r) => db.rpc('sales_sp_period', { p_from: r[0], p_to: r[1] })),
  ]);
  const cfg = progCfg(cfgRow), P = cfg.pts;
  const goal = {}; goalRows.forEach((g) => { goal[g.salesperson + '|' + g.ym] = Number(g.target); });
  const mon = {}; (months || []).forEach((r) => { (mon[r.sp] = mon[r.sp] || {})[r.ym] = r; });
  const recent = (sp) => ymAdd(ym, -1) in (mon[sp] || {}) || ym in (mon[sp] || {}) || ymAdd(ym, -2) in (mon[sp] || {});
  const people = [...new Set([...Object.keys(mon).filter((k) => k !== 'Unassigned' && recent(k)), ...goalRows.map((g) => g.salesperson).filter((k) => k !== '*')])].sort();
  // seasonality: share of each month in last year's sales (the person's own, else the whole company's, else even)
  const seasC = {}, pad2 = (i) => String(i).padStart(2, '0');
  const seas = (sp, y) => { const k = sp + '|' + y; if (seasC[k]) return seasC[k]; const keys = Array.from({ length: 12 }, (_, i) => (y - 1) + '-' + pad2(i + 1));
    const pick = (f) => keys.map((m) => Math.max(0, Number(f(m)) || 0)); const sum = (a) => a.reduce((x, z) => x + z, 0);
    let w = sp === '*' ? [] : pick((m) => ((mon[sp] || {})[m] || {}).sales); if (!(sum(w) > 0)) w = pick((m) => Object.keys(mon).reduce((t, p) => t + (Number(((mon[p] || {})[m] || {}).sales) || 0), 0));
    const t = sum(w); return (seasC[k] = t > 0 ? w.map((x) => x / t) : Array(12).fill(1 / 12)); };
  // goal of one person for one month: set for that month, else the yearly goal split by seasonality, else the average of the 3 months before plus a margin
  const goalOf = (sp, m) => { const g = goal[sp + '|' + m]; if (g != null) return { v: g, auto: false, src: 'month' };
    const yg = goal[sp + '|' + m.slice(0, 4) + '-00']; if (yg != null) return { v: Math.round(yg * seas(sp, +m.slice(0, 4))[+m.slice(5, 7) - 1]), auto: false, src: 'annual' };
    const prev = [1, 2, 3].map((i) => Number(((mon[sp] || {})[ymAdd(m, -i)] || {}).sales) || 0); const avg = prev.reduce((a, b) => a + b, 0) / 3; return avg > 0 ? { v: Math.round(avg * (1 + cfg.autoGoalPct / 100)), auto: true, src: 'auto' } : { v: null, auto: true, src: 'auto' }; };
  const pointsOf = (r, g) => { const sales = Number(r.sales) || 0, cov = Number(r.cov) || 0, margin = cov > 0 ? (cov - (Number(r.cost) || 0)) / cov : null, cvg = sales > 0 ? cov / sales : 0;
    return Math.max(0, Math.floor(sales / 100 * P.per100)) + (g && sales >= g ? P.goal : 0) + (margin != null && margin >= cfg.marginTarget && cvg >= 0.7 ? P.margin : 0) + (Number(r.newc) || 0) * P.newc + (Number(r.back) || 0) * P.back; };
  const board = (rows, scale) => { const by = {}; (rows || []).forEach((r) => { by[r.sp] = r; });
    const out = people.map((sp) => { const r = by[sp] || { sales: 0, cost: 0, cov: 0, orders: 0, newc: 0, back: 0 }, g = goalOf(sp, ym), gv = g.v != null ? g.v * scale : null, sales = Number(r.sales) || 0, cov = Number(r.cov) || 0;
      return { sp, sales, goal: gv != null ? Math.round(gv) : null, auto: g.auto, pct: gv ? sales / gv : null, orders: Number(r.orders) || 0, newc: Number(r.newc) || 0, back: Number(r.back) || 0, margin: cov > 0 ? (cov - (Number(r.cost) || 0)) / cov : null, points: pointsOf(r, gv) }; });
    out.sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.sales - a.sales); out.forEach((r, i) => { r.rank = i + 1; }); return out; };
  // lifetime points and levels, streaks and badges from the monthly history
  const life = {}, badges = {};
  people.forEach((sp) => {
    const all = Object.keys(mon[sp] || {}).sort(); let pts = 0, hit = 0, mk = 0, streak = 0;
    all.forEach((m) => { const r = mon[sp][m], sales = Number(r.sales) || 0, gg = goalOf(sp, m), g = gg.auto ? null : gg.v; pts += Math.max(0, Math.floor(sales / 100 * P.per100)); if (g != null && sales >= g) { pts += P.goal; hit++; }
      const cov = Number(r.cov) || 0; if (cov > 0 && sales > 0 && cov / sales >= 0.7 && (cov - (Number(r.cost) || 0)) / cov >= cfg.marginTarget) mk++; });
    for (let m = ym; ; m = ymAdd(m, -1)) { const gg = goalOf(sp, m), g = gg.auto ? null : gg.v, r = (mon[sp] || {})[m]; if (g != null && r && Number(r.sales) >= g) streak++; else if (m === ym) continue; else break; if (streak > 36) break; }
    life[sp] = pts; badges[sp] = { goal_crusher: hit, margin_keeper: mk, streak };
  });
  const lvl = (pts) => { let cur = cfg.levels[0], next = null; cfg.levels.forEach((l) => { if (pts >= l[1]) cur = l; }); next = cfg.levels.filter((l) => l[1] > pts)[0] || null; return { name: cur[0], pts, next: next ? next[0] : null, need: next ? next[1] - pts : 0, from: cur[1], to: next ? next[1] : null }; };
  const dayB = board(dayR, 1 / md), weekB = board(weekR, 7 / md), monB = board(monR, 1);
  const BDG = { goal_crusher: ['Goal crusher', 'Months with the goal reached'], margin_keeper: ['Margin keeper', 'Months at or above the margin target'], streak: ['On a streak', 'Months in a row with the goal reached'], hunter: ['Hunter', '3 or more new customers this month'], comeback: ['Comeback', '2 or more customers back after 90 days or more this month'], closer: ['Closer', '8 or more orders this week'] };
  const mineName = sc.sp || null;
  const shape = (rows, self) => rows.map((r) => { const own = isSuper || r.sp === mineName, b = badges[r.sp] || {}, mrow = monB.filter((x) => x.sp === r.sp)[0] || {}, wrow = weekB.filter((x) => x.sp === r.sp)[0] || {}, earned = [];
    if (b.goal_crusher) earned.push(['goal_crusher', b.goal_crusher]); if (b.margin_keeper) earned.push(['margin_keeper', b.margin_keeper]); if (b.streak >= 2) earned.push(['streak', b.streak]);
    if (mrow.newc >= 3) earned.push(['hunter', mrow.newc]); if (mrow.back >= 2) earned.push(['comeback', mrow.back]); if (wrow.orders >= 8) earned.push(['closer', wrow.orders]);
    return Object.assign({}, r, { sales: own ? r.sales : null, goal: own ? r.goal : null, level: lvl(life[r.sp] || 0), life: life[r.sp] || 0, me: r.sp === mineName, badges: earned }); });
  // past cycles: winners and who reached the goal
  const wins = [], logK = {}; log.forEach((l) => { logK[l.cycle + '|' + l.salesperson + '|' + l.award] = l; });
  const push = (cycle, label, aw, sp) => { const l = logK[cycle + '|' + sp + '|' + aw.id]; wins.push({ cycle, label, id: aw.id, award: aw.text, sp, delivered: !!(l && l.delivered), by: l && l.delivered_by }); };
  const pastRows = (rows, scale, m) => { const by = {}; (rows || []).forEach((r) => { by[r.sp] = r; }); return people.map((sp) => { const g = goalOf(sp, m).v, sales = Number((by[sp] || {}).sales) || 0, gv = g != null ? g * scale : null; return { sp, sales, pct: gv ? sales / gv : null, hit: gv != null && sales >= gv && !goalOf(sp, m).auto }; }).filter((r) => r.sales > 0); };
  cfg.awards.forEach((aw) => {
    if (aw.cycle === 'week') weeks.forEach((wr, i) => { const m = wr[0].slice(0, 7), rows = pastRows(pastW[i], 7 / monthDays(m), m), label = 'Week of ' + wr[0];
      if (aw.rule === 'top') { const t = rows.slice().sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.sales - a.sales)[0]; if (t) push('w' + wr[0], label, aw, t.sp); } else rows.filter((r) => r.hit).forEach((r) => push('w' + wr[0], label, aw, r.sp)); });
    else [1, 2, 3].forEach((i) => { const m = ymAdd(ym, -i), rows = people.map((sp) => { const r = (mon[sp] || {})[m], g = goalOf(sp, m), sales = r ? Number(r.sales) || 0 : 0; return { sp, sales, pct: g.v ? sales / g.v : null, hit: g.v != null && !g.auto && sales >= g.v }; }).filter((r) => r.sales > 0), label = m;
      if (aw.rule === 'top') { const t = rows.slice().sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct) || b.sales - a.sales)[0]; if (t) push('m' + m, label, aw, t.sp); } else rows.filter((r) => r.hit).forEach((r) => push('m' + m, label, aw, r.sp)); });
  });
  const visibleWins = isSuper ? wins : wins.filter((x) => x.sp === mineName);
  const out = { today, week: wk, ym, daysInMonth: md, day: today.slice(8, 10) * 1, pace: (+today.slice(8, 10)) / md, boards: { day: shape(dayB), week: shape(weekB), month: shape(monB) }, wins: visibleWins, badges: BDG, role: w.role, me: mineName, none: !!sc.none,
    levels: cfg.levels, pts: P, marginTarget: cfg.marginTarget };
  const coSales = (m) => Object.keys(mon).reduce((t, p) => t + (Number(((mon[p] || {})[m] || {}).sales) || 0), 0);
  const cg = goalOf('*', ym), peopleNow = people.map((sp) => goalOf(sp, ym).v).filter((v) => v != null);
  out.company = { now: cg.v != null && !cg.auto ? cg.v : (peopleNow.length ? peopleNow.reduce((a, b) => a + b, 0) : null), sales: sumBy(monB, (r) => r.sales) };
  if (isSuper) {
    const Y = /^\d{4}$/.test(String(req.query.year || '')) ? +req.query.year : +ym.slice(0, 4);
    out.cfg = { pts: P, marginTarget: cfg.marginTarget, autoGoalPct: cfg.autoGoalPct, levels: cfg.levels, awards: cfg.awards };
    const rowFor = (sp) => { const months = Array.from({ length: 12 }, (_, i) => { const m = Y + '-' + pad2(i + 1), g = goalOf(sp, m), pm = (Y - 1) + '-' + pad2(i + 1);
      return { ym: m, v: g.v, src: g.src, sales: sp === '*' ? coSales(m) : Number(((mon[sp] || {})[m] || {}).sales) || 0, last: sp === '*' ? coSales(pm) : Number(((mon[sp] || {})[pm] || {}).sales) || 0 }; });
      const yg = goal[sp + '|' + Y + '-00'];
      return { sp, annual: yg != null ? yg : null, seas: seas(sp, Y), months, lastYear: months.reduce((t, r) => t + r.last, 0), ytd: months.reduce((t, r) => t + r.sales, 0) }; };
    out.goals = { year: Y, years: [Y - 1, Y, Y + 1], rows: [rowFor('*')].concat(people.map(rowFor)) };
  }
  // the race track: how close the month is to its goal and what that month is worth in the year (the company for a superadmin, the person otherwise)
  { const spQ = String(req.query.sp || ''), key = isSuper ? (spQ && spQ !== 'all' && people.includes(spQ) ? spQ : '*') : mineName, Yr = +ym.slice(0, 4);
    if (key) { const gOf = (m) => { const g = goalOf(key, m); if (key === '*' && g.auto) { const v = people.map((p) => goalOf(p, m).v).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; } return g.v; };
      const sOf = (m) => key === '*' ? Object.keys(mon).reduce((t, p) => t + (Number(((mon[p] || {})[m] || {}).sales) || 0), 0) : Number(((mon[key] || {})[m] || {}).sales) || 0;
      const months = Array.from({ length: 12 }, (_, i) => { const m = Yr + '-' + pad2(i + 1); return { ym: m, goal: gOf(m), sales: sOf(m) }; });
      const yg = months.reduce((t, r) => t + (r.goal || 0), 0), ytd = months.reduce((t, r) => t + r.sales, 0), cur = months[+ym.slice(5, 7) - 1];
      out.race = { who: key === '*' ? 'Team' : key, ym, year: Yr, pace: out.pace, month: { goal: cur.goal, sales: cur.sales }, yearGoal: yg || null, ytd, months, annualSet: goal[key + '|' + Yr + '-00'] != null }; } }
  return res.json(out);
};
A['sales-program-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin changes goals and the program.' });
  const b = readBody(req), now = new Date().toISOString();
  if (b.kind === 'goal') {
    const sp = clean(b.salesperson, 120), m = String(b.ym || ''), t = Number(b.target);
    if (!sp || !/^\d{4}-(00|0[1-9]|1[0-2])$/.test(m)) return res.status(400).json({ error: 'Pick a salesperson and a month.' });
    if (b.target === '' || b.target === null) { await db.remove('sales_goals', 'salesperson=eq.' + encodeURIComponent(sp) + '&ym=eq.' + m); }
    else { if (!Number.isFinite(t) || t < 0 || t > 1e9) return res.status(400).json({ error: 'Type a valid amount.' }); await db.insert('sales_goals', [{ salesperson: sp, ym: m, target: Math.round(t), updated_by: w.email, updated_at: now }], { onConflict: 'salesperson,ym' }); }
    await PS.audit(w.email, 'goal.save', 'salesperson', sp, null, { ym: m, target: b.target }); return res.json({ ok: true });
  }
  if (b.kind === 'goals') {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60), ups = [], dels = [];
    for (const it of items) { const sp = clean(it.salesperson, 120), m = String(it.ym || ''), t = Number(it.target);
      if (!sp || !/^\d{4}-(00|0[1-9]|1[0-2])$/.test(m)) return res.status(400).json({ error: 'Pick a salesperson and a month.' });
      if (it.target === '' || it.target === null || it.target === undefined || t === 0) dels.push([sp, m]);
      else { if (!Number.isFinite(t) || t < 0 || t > 1e9) return res.status(400).json({ error: 'Type a valid amount.' }); ups.push({ salesperson: sp, ym: m, target: Math.round(t), updated_by: w.email, updated_at: now }); } }
    if (ups.length) await db.insert('sales_goals', ups, { onConflict: 'salesperson,ym' });
    for (const d of dels) await db.remove('sales_goals', 'salesperson=eq.' + encodeURIComponent(d[0]) + '&ym=eq.' + d[1]);
    await PS.audit(w.email, 'goal.save', 'salesperson', items[0] ? clean(items[0].salesperson, 120) : '', null, { set: ups.length, cleared: dels.length }); return res.json({ ok: true });
  }
  if (b.kind === 'deliver') {
    const cycle = clean(b.cycle, 20), sp = clean(b.salesperson, 120), aw = clean(b.award, 40); if (!cycle || !sp || !aw) return res.status(400).json({ error: 'award' });
    await db.insert('sales_award_log', [{ cycle, salesperson: sp, award: aw, delivered: !!b.delivered, delivered_by: b.delivered ? w.email : null, delivered_at: b.delivered ? now : null }], { onConflict: 'cycle,salesperson,award' });
    await PS.audit(w.email, 'award.deliver', 'salesperson', sp, null, { cycle, award: aw, delivered: !!b.delivered }); return res.json({ ok: true });
  }
  if (b.kind === 'config') {
    const c = b.config || {}, n = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) && v >= lo && v <= hi ? v : d; };
    const pts = {}; Object.keys(PROG_DEFAULT.pts).forEach((k) => { pts[k] = n((c.pts || {})[k], 0, 100000, PROG_DEFAULT.pts[k]); });
    const levels = (Array.isArray(c.levels) ? c.levels : []).slice(0, 10).map((l) => [clean(l[0], 30), n(l[1], 0, 1e7, 0)]).filter((l) => l[0]).sort((a, z) => a[1] - z[1]);
    if (!levels.length || levels[0][1] !== 0) return res.status(400).json({ error: 'The first level must start at 0 points.' });
    const awards = (Array.isArray(c.awards) ? c.awards : []).slice(0, 12).map((a, i) => ({ id: clean(a.id, 30) || 'award' + i, cycle: a.cycle === 'week' ? 'week' : 'month', rule: a.rule === 'goal' ? 'goal' : 'top', text: clean(a.text, 120) })).filter((a) => a.text);
    await db.insert('sales_program', [{ id: 1, config: { pts, marginTarget: n(c.marginTarget, 0, 1, 0.15), autoGoalPct: n(c.autoGoalPct, 0, 100, 5), levels, awards }, updated_by: w.email, updated_at: now }], { onConflict: 'id' });
    await PS.audit(w.email, 'program.save', 'program', '1'); return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'kind' });
};
A['loyalty-save'] = async (req, res) => {
  if (req.method !== 'POST' || !originOk(req)) return res.status(405).json({ error: 'method' });
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const b = readBody(req);
  const rec = { enabled: !!b.enabled, points_per_usd: Math.max(0, num(b.points_per_usd) || 1), usd_per_point: Math.max(0, num(b.usd_per_point) || 0.01), expiry_months: num(b.expiry_months) > 0 ? Math.floor(num(b.expiry_months)) : null, updated_by: w.email, updated_at: new Date().toISOString() };
  await db.insert('loyalty_settings', [{ id: 1, ...rec }], { onConflict: 'id' });
  await PS.audit(w.email, 'loyalty.save', 'loyalty', '1', null, rec);
  return res.json({ ok: true });
};
A.audit = async (req, res) => {
  const w = await who(req, res); if (!w) return;
  if (!can(w)) return res.status(403).json({ error: 'role' });
  const before = req.query.before && !isNaN(Date.parse(req.query.before)) ? '&at=lt.' + encodeURIComponent(new Date(req.query.before).toISOString()) : '';
  const rows = await db.select('audit_log', 'select=*&order=at.desc&limit=100' + before);
  // names for the records the log points at, so the list reads "Thanksgiving" instead of an id
  const UUID = /^[0-9a-f-]{36}$/i, want = { campaign: ['campaigns', 'name'], voucher: ['vouchers', 'code'], company: ['companies', 'name'], segment: ['segments', 'name'] }, names = {};
  await Promise.all(Object.keys(want).map(async (ent) => {
    const ids = [...new Set(rows.filter((r) => r.entity === ent && UUID.test(r.entity_id || '')).map((r) => r.entity_id))];
    if (!ids.length) return;
    try { (await db.select(want[ent][0], 'select=id,' + want[ent][1] + '&id=' + inList(ids))).forEach((x) => { names[x.id] = x[want[ent][1]]; }); } catch (e) { /* a missing table only costs the label */ }
  }));
  const people = {}; (await db.select('admins', 'select=email,name,first_name,last_name,photo').catch(() => [])).forEach((x) => { const e = String(x.email).toLowerCase(); people[e] = { name: x.name || [x.first_name, x.last_name].filter(Boolean).join(' ') || e.split('@')[0], photo: x.photo || TEAM_PH[e] || null }; });
  Object.keys(TEAM_PH).forEach((e) => { if (!people[e]) people[e] = { name: e.split('@')[0], photo: TEAM_PH[e] }; });
  return res.json({ rows: rows.map((r) => ({ ...r, label: names[r.entity_id] || null })), more: rows.length === 100, people });
};

// ---- access profiles: an admin can be limited to some screens. null = everything the role allows.
const SCREENS = ['dash', 'dir', 'pipe', 'segments', 'clients', 'prospects', 'sa', 'crm', 'goals', 'campaigns', 'emails', 'vouchers', 'loyalty', 'products', 'events', 'bcomp', 'stream', 'terms'];
const API_SCREEN = { 'sales-data': ['sa', 'goals', 'dash'], 'sales-mix': ['sa'], 'sales-commission': ['sa', 'goals'], 'commission-close': ['sa', 'goals'], 'sales-program': ['goals', 'sa', 'dash'], 'sales-program-save': ['goals'],
  crm: ['crm'], 'crm-deal': ['crm', 'dir'], 'proposal-get': ['crm'], 'proposal-search': ['crm'], 'proposal-save': ['crm'], 'proposal-preview': ['crm'], 'crm-save': ['crm'], 'crm-ai': ['crm'], 'crm-contacts': ['crm'], 'contact-save': ['crm'], 'crm-cust': ['crm', 'dir'],
  vouchers: ['vouchers'], 'voucher-save': ['vouchers'], 'voucher-toggle': ['vouchers'], campaigns: ['campaigns'], campaign: ['campaigns'], 'campaign-save': ['campaigns'], 'campaign-toggle': ['campaigns'], 'campaign-floors': ['campaigns'], 'campaign-banner': ['campaigns'], 'campaign-sample': ['campaigns'],
  'mail-list': ['emails'], 'mail-get': ['emails'], 'mail-save': ['emails'], 'mail-copy': ['emails'], 'mail-archive': ['emails'], 'mail-preview': ['emails'], 'mail-audience': ['emails'], 'mail-test': ['emails'], 'mail-send': ['emails'], 'mail-cancel': ['emails'], 'mail-continue': ['emails'], 'mail-report': ['emails'],
  loyalty: ['loyalty'], 'loyalty-save': ['loyalty'], 'order-lead': ['crm'], 'catalog-category': ['products'], 'product-links': ['products'], hidden: ['products'], 'hidden-set': ['products'], 'hidden-standard': ['products'], 'catalog-all': ['products', 'campaigns'],
  dash: ['dash'], 'dash-ai': ['dash', 'crm'], 'dash-customers': ['dash'], 'dash-sync': ['dash'], 'funnel-step': ['dash'], followups: ['dash', 'sa', 'crm'], 'note-add': ['dash', 'dir', 'crm', 'sa'], 'note-done': ['dash', 'dir', 'crm', 'sa'], customer: ['dir', 'crm', 'dash', 'sa', 'goals', 'bcomp', 'events', 'stream', 'pipe', 'clients'],
  events: ['events', 'bcomp', 'stream'], 'behavior-companies': ['bcomp', 'events'], 'behavior-stream': ['stream', 'events'], terms: ['terms'], 'terms-save': ['terms'], 'terms-publish': ['terms'],
  segments: ['segments'], 'segment-save': ['segments'], 'segment-members': ['segments'], 'segment-delete': ['segments'], 'segment-import': ['segments'], 'segment-create': ['segments'], 'segment-invite': ['segments'], 'segment-template': ['segments'], 'tags-set': ['segments'], segment: ['segments'], 'invite-preview': ['segments'], invite: ['segments', 'dir'],
  prospects: ['prospects'], addprospect: ['prospects'], 'import-preview': ['prospects'], import: ['prospects'], 'company-remove': ['clients', 'prospects'], dir: ['dir'], 'dir-sync': ['dir'], pipeline: ['pipe'], 'pipeline-mark': ['pipe'], approve: ['clients'], reject: ['clients'], revoke: ['clients'] };
require('../lib/admin-mail')(A, { who, can, originOk, readBody, clean, audit: (...a) => PS.audit(...a).catch(() => {}), base });
const scrMemo = new Map();
async function screensOf(email) {
  const k = String(email).toLowerCase(), hit = scrMemo.get(k); if (hit && Date.now() - hit.t < 20000) return hit.v;
  let v = null; try { const r = (await db.select('admins', 'select=role,screens&email=eq.' + encodeURIComponent(k) + '&limit=1'))[0]; if (r && r.role !== 'superadmin' && Array.isArray(r.screens)) v = r.screens; } catch (e) { console.error('screens lookup', e.message); return false; } // unknown: the caller refuses instead of opening everything
  scrMemo.set(k, { t: Date.now(), v }); return v;
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  if (!PS.on()) return res.status(503).json({ error: 'database mode is off' });
  const fn = A[String(req.query.a || '')];
  if (!fn) return res.status(404).json({ error: 'not found' });
  const need = API_SCREEN[String(req.query.a || '')];
  if (need) { const s0 = await SDB.lookup(req, 'admin').catch(() => null), allow = s0 && s0.email ? await screensOf(s0.email) : null; if (allow === false) return res.status(503).json({ error: 'Could not check your access right now. Try again in a moment.' }); if (allow && !need.some((x) => allow.includes(x))) return res.status(403).json({ error: 'This screen is not enabled for your login.' }); }
  try { return await fn(req, res); }
  catch (e) { console.error('admin', req.query.a, e.message); return res.status(500).json({ error: 'server' }); }
};
