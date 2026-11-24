// Anonymous browsing belongs to a person once we know who they are.
// A quote or an access request tags the browser's earlier events with the e-mail; approving the account moves them to the company.
const db = require('./db');
const VID = /^[a-z0-9-]{8,40}$/i;

async function tagVisitor(vid, email) {
  if (!db.configured() || !VID.test(String(vid || '')) || !email) return;
  await db.update('events', 'visitor_id=eq.' + encodeURIComponent(vid) + '&user_id=is.null&who=is.null', { who: String(email).toLowerCase().slice(0, 120) }).catch(() => {});
}

async function claimForCompany(people, companyId) {
  if (!db.configured() || !companyId) return;
  for (const p of people || []) {
    if (!p || !p.email) continue;
    await db.update('events', 'who=eq.' + encodeURIComponent(String(p.email).toLowerCase()) + '&company_id=is.null', { company_id: companyId, user_id: p.id || null }).catch(() => {});
  }
}

module.exports = { tagVisitor, claimForCompany };
