// Webflow: the form answers of the Diesel Tech Academy site, read through the Webflow Data API (v2).
// The token lives only in Vercel: WEBFLOW_TOKEN (site token with read access to forms). WEBFLOW_DTA_SITE can replace the site id.
const db = require('./db');
const SITE = () => process.env.WEBFLOW_DTA_SITE || '6ab3455fb5d6a607904368e0';
const configured = () => !!process.env.WEBFLOW_TOKEN;
const t = (v, n) => { const x = String(v == null ? '' : v).trim(); return x ? x.slice(0, n || 200) : null; };
// a tag is only kept when it is a real value: ad platforms sometimes leave the placeholder ({{campaign.name}}) in the link
const tag = (v) => { let x = String(v == null ? '' : v).trim(); if (!x || /\{\{|\}\}/.test(x)) return ''; x = x.replace(/\+/g, ' '); try { x = decodeURIComponent(x); } catch (e) {} return x.trim().slice(0, 160); };
const HOSTS = [[/facebook\.|fb\.com|fb\.me/, 'fb'], [/instagram\./, 'ig'], [/google\./, 'google'], [/bing\./, 'bing'], [/youtube\.|youtu\.be/, 'youtube'], [/linkedin\.|lnkd\.in/, 'linkedin'], [/tiktok\./, 'tiktok'], [/chatgpt\.|openai\./, 'chatgpt'], [/hotmart\./, 'hotmart']];

// one form answer -> one row. The visit source comes from the hidden fields; when they are empty, from the tags left in the referrer; then from the referring site.
function fromSubmission(sub) {
  const f = sub.formResponse || {}, g = (...k) => { for (const x of k) { if (f[x] != null && String(f[x]).trim() !== '') return f[x]; } return null; };
  const email = t(g('email', 'Email'), 200); if (!sub.id) return null;
  const onsite = /onsite/i.test(sub.displayName || '');
  const u = { source: tag(f.utm_source), medium: tag(f.utm_medium), campaign: tag(f.utm_campaign), content: tag(f.utm_content), term: tag(f.utm_term) };
  const ref = String(f.Referrer || '');
  if (!u.source || !u.campaign) { const q = ref.split('?')[1] || ''; q.split('&').forEach((kv) => { const m = /^utm_(source|medium|campaign|content|term)=(.*)$/.exec(kv); if (m && !u[m[1]]) u[m[1]] = tag(m[2]); }); }
  if (!u.source && ref) { let host = ''; try { host = new URL(ref.replace(/^android-app:\/\//, 'https://')).hostname.replace(/^(www|m|l|lm)\./, ''); } catch (e) {} if (host && !/dieseltechacademy\./.test(host)) { const h = HOSTS.find((x) => x[0].test(host)); u.source = h ? h[1] : host; u.medium = u.medium || (f.fbclid || f.gclid ? 'paid' : h && /google|bing/.test(h[1]) ? 'organic' : 'referral'); } }
  if (!u.source && (f.fbclid || f.gclid)) { u.source = f.gclid ? 'google' : 'fb'; u.medium = u.medium || 'paid'; }
  const row = { id: String(sub.id), kind: onsite ? 'onsite' : 'course', form_name: t(sub.displayName, 80), submitted_at: sub.dateSubmitted || new Date().toISOString(), name: t(g('Field', 'Name', 'name'), 160), email: email && email.toLowerCase(), phone: t(g('phone', 'Phone'), 40), company: t(g('Company'), 160),
    course: t(g('Course'), 160), value: Number(g('Value')) || null, voucher: t(g('Voucher'), 60), checkout_url: t(g('Checkout URL'), 300), page: t(g('Page') || sub.publishedPath, 200), landing: t(g('Landing page'), 200), referrer: t(ref.split('?')[0], 300),
    utm_source: u.source.toLowerCase() || null, utm_medium: u.medium.toLowerCase() || null, utm_campaign: u.campaign || null, utm_content: u.content || null, utm_term: u.term || null, click_id: f.gclid ? 'gclid' : f.fbclid ? 'fbclid' : null, data: null, updated_at: new Date().toISOString() };
  if (onsite) { const d = {}; Object.keys(f).forEach((k) => { if (!/^(name|email|phone|company|consent)$/i.test(k)) d[k] = String(f[k]).slice(0, 2000); }); row.data = d; }
  return row;
}
// Reads the answers, newest first. full = every page (first import); otherwise only the newest page.
async function sync({ full, budgetMs } = {}) {
  if (!configured()) return { error: 'Webflow is not connected yet.' };
  const t0 = Date.now(); let rows = 0, offset = 0, total = 0;
  for (let i = 0; i < 60; i++) {
    if (Date.now() - t0 > (budgetMs || 15000)) return { ok: true, partial: true, rows, total };
    const r = await fetch('https://api.webflow.com/v2/sites/' + SITE() + '/form_submissions?limit=100&offset=' + offset, { headers: { Authorization: 'Bearer ' + process.env.WEBFLOW_TOKEN, accept: 'application/json' } });
    if (r.status === 429) { await new Promise((z) => setTimeout(z, 1500)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: 'Webflow answered ' + r.status + (r.status === 401 || r.status === 403 ? '. The token was not accepted or cannot read forms.' : '.') + (j.message ? ' ' + String(j.message).slice(0, 140) : ''), rows };
    const seen = {}, batch = (j.formSubmissions || []).map(fromSubmission).filter((x) => x && !seen[x.id] && (seen[x.id] = 1));
    // deal_id is left out so an answer already turned into a deal keeps its link
    if (batch.length) await db.insert('dta_leads', batch, { onConflict: 'id' });
    rows += batch.length; total = (j.pagination && j.pagination.total) || rows; offset += 100;
    if (!full || offset >= total || !(j.formSubmissions || []).length) break;
  }
  return { ok: true, rows, total };
}
module.exports = { configured, sync, fromSubmission };
