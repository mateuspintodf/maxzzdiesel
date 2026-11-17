// The one place that decides whether a signed-in cookie still counts. Every endpoint that needs a user goes through here.
// A cookie is only a claim of who the person is. Whether they may still use the portal is read from the store on every
// request: user approved, company approved, and the session issued after the last time an admin cut that person off.
const { sessionInfo } = require('./session');
const { readJson } = require('./store');
const PS = require('./portal-store');
const SDB = require('./sessions-db');

const DB = 'portal/db.json';
// PORTAL_ADMINS plus the team superadmins (Leise, Michael, marketing@), who see the portal as admins
const admins = () => (String(process.env.PORTAL_ADMINS || '') + ',' + String(process.env.TEAM_SUPERADMINS || 'admin@maxzzdiesel.com,michael@maxzzdiesel.com,marketing@maxzzdiesel.com')).toLowerCase().split(/[,\s]+/).filter(Boolean);
const isAdmin = (email) => !!email && admins().includes(email);

// returns { email, admin, user, account, db } or null
async function authenticate(req, db) {
  if (PS.on()) return authenticateDb(req);
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

// database mode: the session row is the proof, revocation is just ending the row
async function authenticateDb(req) {
  const s = await SDB.lookup(req, 'customer');
  if (!s) return null;
  const { user, account } = await PS.loadOne(s.email);
  const admin = isAdmin(s.email);
  if (!user && !admin) return null;
  if (!admin && (!user || user.status !== 'approved' || !account || account.status !== 'approved')) return null;
  return { email: s.email, admin, user, account, db: null };
}

module.exports = { authenticate, isAdmin, admins };
