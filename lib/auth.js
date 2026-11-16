// The one place that decides whether a signed-in cookie still counts. Every endpoint that needs a user goes through here.
// A cookie is only a claim of who the person is. Whether they may still use the portal is read from the store on every
// request: user approved, company approved, and the session issued after the last time an admin cut that person off.
const { sessionInfo } = require('./session');
const { readJson } = require('./store');

const DB = 'portal/db.json';
const admins = () => String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
const isAdmin = (email) => !!email && admins().includes(email);

// returns { email, admin, user, account, db } or null
async function authenticate(req, db) {
  const s = sessionInfo(req);
  if (!s) return null;
  db = db || (await readJson(DB)) || { users: {}, accounts: {} };
  const u = db.users[s.email] || null;
  const admin = isAdmin(s.email);
  if (!u && !admin) return null;
  const acc = u && u.account ? db.accounts[u.account] || null : null;
  if (!admin) {
    if (!u || u.status !== 'approved') return null;
    if (!acc || acc.status !== 'approved') return null;
  }
  // an admin pressed "end sessions" (or rejected the account): any cookie issued before that moment is dead
  const cut = Math.max((u && u.revokedBefore) || 0, (acc && acc.revokedBefore) || 0, (db.revokedBefore && db.revokedBefore[s.email]) || 0);
  if (s.iat < cut) return null;
  return { email: s.email, admin, user: u, account: acc, db };
}

module.exports = { authenticate, isAdmin, admins };
