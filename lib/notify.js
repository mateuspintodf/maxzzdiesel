// Internal alerts to the sales team for every new request coming from the site (quote or B2B access).
// Production: Leise and Michael (TEAM_NOTIFY overrides the list) plus PORTAL_ADMINS. Previews: only PORTAL_ADMINS, so tests never reach the team.
const { send, esc } = require('./mail');

const HUB = process.env.HUBSPOT_PORTAL_ID || '14488732';
const TEAM = () => String(process.env.TEAM_NOTIFY || 'admin@maxzzdiesel.com,michael@maxzzdiesel.com').toLowerCase().split(/[,\s]+/).filter(Boolean);
const ADMINS = () => String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
function recipients() {
  const list = process.env.VERCEL_ENV === 'production' ? TEAM().concat(ADMINS()) : ADMINS();
  return Array.from(new Set(list));
}
const hubDeal = (id) => id ? `https://app.hubspot.com/contacts/${HUB}/record/0-3/${id}` : '';
const hubContact = (id) => id ? `https://app.hubspot.com/contacts/${HUB}/record/0-1/${id}` : '';

// links: [{ label, url }] shown as buttons; facts: [[label, value]]
async function notifyTeam(subject, title, facts, links, extraHtml) {
  const to = recipients();
  if (!to.length) return;
  const rows = facts.filter((f) => f && f[1]).map((f) => `<tr><td style="padding:3px 12px 3px 0;color:#8a9097;font-size:13px;white-space:nowrap;vertical-align:top">${esc(f[0])}</td><td style="padding:3px 0;font-size:14px;color:#1d2126">${esc(String(f[1]))}</td></tr>`).join('');
  links = (links || []).concat([{ label: 'Open Unleashed', url: 'https://go.unleashedsoftware.com/v2' }]);
  const btns = links.filter((l) => l && l.url).map((l) => `<a href="${esc(l.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:40px;background:#1d2126;color:#ffffff;text-decoration:none;font-size:14px">${esc(l.label)}</a>`).join('');
  const body = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${rows}</table>${extraHtml || ''}${btns ? `<p style="margin:16px 0 0">${btns}</p>` : ''}`;
  try { await send(to, subject, title, body, null, { internal: true }); } catch (e) { console.error('team notify', e.message); }
}
module.exports = { notifyTeam, hubDeal, hubContact };
