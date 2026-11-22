// Marketing e-mail: who receives a campaign, what each person sees, and the sending itself (Resend, in batches).
// A campaign is a list of blocks (content.blocks). Every e-mail carries the unsubscribe link and the company address.
// The CUSTOMER_MAIL switch in lib/mail.js applies here too: while it is off, only team and pilot addresses are sent
// and the rest stay on record as "held".
const crypto = require('crypto');
const db = require('./db');
const { readJson, cached } = require('./store');
const { esc, customerMailOn, internalTo, pilotTo } = require('./mail');
const { hiddenSet } = require('./hidden');
const CAMP = require('./campaigns');
const FIX = require('./catalog-fix');
const { EMAIL } = require('./validate');

const SITE = () => String(process.env.SITE_URL || 'https://www.maxzzdiesel.com').replace(/\/+$/, '');
const IMG = 'https://www.maxzzdiesel.com/assets/email/';
const F = 'Helvetica,Arial,sans-serif';
const FROM = () => process.env.MKT_MAIL_FROM || process.env.PORTAL_MAIL_FROM || 'Maxzz Diesel <portal@maxzzdiesel.com>';
const REPLY = () => process.env.MKT_REPLY_TO || process.env.PORTAL_REPLY_TO || 'sales@maxzzdiesel.com';

// ---- signed links (open pixel, click redirect, unsubscribe) ----------------------------------------------------
function secret() {
  const s = process.env.PORTAL_SECRET || process.env.UNLEASHED_API_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('no signing secret');
  return crypto.createHash('sha256').update('maxzz-mail|' + s).digest();
}
const mac = (s) => crypto.createHmac('sha256', secret()).update(String(s)).digest('base64url').slice(0, 22);
const tok = (id) => id + '.' + mac(id);
function untok(t) {
  const [id, m] = String(t || '').split('.');
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || !m) return null;
  const a = Buffer.from(m), b = Buffer.from(mac(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}
const b64 = (s) => Buffer.from(String(s)).toString('base64url');
const unb64 = (s) => { try { return Buffer.from(String(s), 'base64url').toString(); } catch (e) { return ''; } };
const linkSig = (id, url) => mac(id + '|' + url);

// ---- catalog and prices -------------------------------------------------------------------------------------
async function loadCatalog() {
  let rows = null;
  try { rows = await readJson('catalog/live.json'); } catch (e) { rows = null; }
  if (!Array.isArray(rows) || !rows.length) { try { rows = JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'data', 'catalog.json'), 'utf8')); } catch (e) { rows = []; } }
  rows = await FIX.apply(rows);
  const hid = await hiddenSet().catch(() => new Set()), map = {};
  rows.forEach((r) => { if (!hid.has(r[0])) map[r[0]] = r; });
  const prod = await cached('portal/products.json', 10 * 60 * 1000).catch(() => null);
  const camps = await CAMP.live().catch(() => []);
  return { map, prod: prod || { tiers: [], items: {} }, camps };
}
// "Fuel Injector / Application: 13-18 6.7L DODGE CUMMINS / (= 0.986.435.621)" -> name and application
function nameOf(desc) {
  let d = String(desc || '').replace(/\(=[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const m = d.match(/^(.*?)\s*\/\s*(?:Application|Suitable for|Suitable)\s*:?\s*(.*)$/i);
  let name = m ? m[1] : d, app = m ? m[2] : '';
  name = name.replace(/\s*\/\s*$/, '').trim(); app = app.replace(/\s*\/\s*$/, '').replace(/\s*\/\s*/g, ', ').trim();
  if (name === name.toUpperCase() && name.length > 4) name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Cat|Heui|Cp\d|Hpp|Uis|Ups|Def)\b/g, (x) => x.toUpperCase());
  return { name: name.slice(0, 90), app: app.slice(0, 90) };
}
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// price for one recipient: the tier of their account, the default sell price otherwise; a live campaign lowers it
function priceFor(C, code, tier) {
  const p = C.prod.items[code]; if (!p) return null;
  const idx = tier ? (C.prod.tiers || []).findIndex((t) => String(t).toLowerCase() === String(tier).toLowerCase()) : -1;
  let price = idx >= 0 ? p.t[idx] : null; if (!(price > 0)) price = p.d; if (!(price > 0)) return null;
  price = Math.round(price * 100) / 100;
  const deal = C.camps.length ? CAMP.bestFor(C.camps, code, price) : null;
  return deal ? { now: deal.price, was: price } : { now: price, was: null };
}

// ---- rendering ----------------------------------------------------------------------------------------------
const firstName = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30);
function merge(text, r) {
  const v = { first_name: firstName(r.name) || 'there', name: r.name || '', company: r.company || 'your company', salesperson: r.sp || 'our sales team', tier: r.tier || '' };
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in v ? v[k.toLowerCase()] : m));
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'campaign';
function withUtm(url, c, content) {
  if (!/^https?:\/\//i.test(url)) return url;
  let u; try { u = new URL(url); } catch (e) { return url; }
  if (!/(^|\.)maxzzdiesel\.com$|(^|\.)dieseltechacademy\.(com|online)$|maxzzdiesel[a-z0-9-]*\.vercel\.app$/i.test(u.hostname)) return url;
  if (!u.searchParams.get('utm_source')) { u.searchParams.set('utm_source', 'maxzz_email'); u.searchParams.set('utm_medium', 'email'); u.searchParams.set('utm_campaign', slug(c.name)); if (content) u.searchParams.set('utm_content', content); }
  return u.toString();
}
// simple inline marks in a text block: **bold** and [label](https://link)
function rich(text, link) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<b style="color:#1d2126">$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, l, u) => `<a href="${esc(link(u.replace(/&amp;/g, '&')))}" style="color:#d32a37;text-decoration:underline">${l}</a>`)
    .replace(/\n{2,}/g, '</p><p style="margin:0 0 14px">').replace(/\n/g, '<br>');
}
const btn = (label, href, small) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#d32a37;border-radius:50px"><a href="${esc(href)}" style="display:inline-block;padding:${small ? '10px 18px' : '14px 26px'};color:#ffffff;text-decoration:none;font-weight:600;font-size:${small ? 13 : 15}px;font-family:${F}">${esc(label)}</a></td></tr></table>`;

function productCard(C, code, r, o, link, layout) {
  const row = C.map[code]; if (!row) return null;
  const n = nameOf(row[1]), p = C.prod.items[code] || {}, img = p.img && /^https:\/\//.test(p.img) ? p.img : null;
  const href = link(SITE() + '/portal#/p/' + encodeURIComponent(code), code);
  const pr = o.price === 'tier' && r.priced ? priceFor(C, code, r.tier) : null;
  const price = pr ? `<div style="margin:8px 0 0;font-size:17px;font-weight:700;color:#1d2126">${money(pr.now)}${pr.was ? ` <span style="font-size:13px;font-weight:400;color:#8a9097;text-decoration:line-through">${money(pr.was)}</span>` : ''}</div>` : '';
  const brand = row[4] ? `<span style="color:#8a9097"> · ${esc(String(row[4]).toUpperCase())}</span>` : '';
  const head = `<div style="font-family:Menlo,Consolas,monospace;font-size:12px;color:#5f6670">${esc(code)}</div><div style="margin:4px 0 0;font-size:11px;letter-spacing:.06em;font-weight:700;color:#c2410c">${esc(String(row[3] || '').toUpperCase())}${brand}</div>`;
  const title = `<a href="${esc(href)}" style="display:block;margin:6px 0 0;font-size:${layout === 'grid3' ? 14 : 16}px;line-height:1.3;font-weight:600;color:#1d2126;text-decoration:none">${esc(n.name)}</a>${n.app ? `<div style="margin:4px 0 0;font-size:13px;line-height:1.4;color:#5f6670">${esc(n.app)}</div>` : ''}`;
  const pic = (w) => img ? `<a href="${esc(href)}"><img src="${esc(img)}" width="${w}" alt="${esc(n.name)}" style="display:block;border:0;width:100%;max-width:${w}px;height:auto;border-radius:12px;background:#f4f5f6"></a>`
    : `<a href="${esc(href)}" style="display:block;background:#f4f5f6;border-radius:12px;text-align:center;padding:${Math.round(w / 3)}px 8px;font-size:12px;color:#8a9097;text-decoration:none">Photo on request</a>`;
  if (layout === 'list') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:16px"><tr>
<td width="132" valign="top" style="padding:14px 0 14px 14px;width:132px">${pic(118)}</td>
<td valign="top" style="padding:14px 16px;font-family:${F}">${head}${title}${price}<div style="margin:12px 0 0">${btn(o.cta || 'View part', href, true)}</div></td></tr></table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:16px"><tr><td style="padding:12px;font-family:${F}">${pic(layout === 'grid3' ? 170 : 270)}<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>${head}${title}${price}<div style="margin:12px 0 0">${btn(o.cta || 'View part', href, true)}</div></td></tr></table>`;
}
function productsBlock(C, b, r, link) {
  const layout = ['list', 'grid2', 'grid3'].includes(b.layout) ? b.layout : 'list', per = layout === 'grid3' ? 3 : layout === 'grid2' ? 2 : 1;
  const cards = (Array.isArray(b.codes) ? b.codes : []).slice(0, 24).map((c) => productCard(C, c, r, b, link, layout)).filter(Boolean);
  if (!cards.length) return '';
  if (per === 1) return cards.map((c) => `<div style="margin:0 0 12px">${c}</div>`).join('');
  let out = '';
  for (let i = 0; i < cards.length; i += per) {
    const row = cards.slice(i, i + per);
    out += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr>` + row.map((c, j) => `<td class="mx-col" width="${Math.floor(100 / per)}%" valign="top" style="width:${Math.floor(100 / per)}%;padding:0 ${j < per - 1 ? 6 : 0}px 0 ${j ? 6 : 0}px">${c}</td>`).join('') +
      (row.length < per ? Array(per - row.length).fill(`<td class="mx-col" width="${Math.floor(100 / per)}%" style="width:${Math.floor(100 / per)}%">&nbsp;</td>`).join('') : '') + '</tr></table>';
  }
  return out;
}
const BG = { red: ['#d32a37', '#ffffff'], dark: ['#1d2126', '#ffffff'], orange: ['#f08a24', '#1d2126'], soft: ['#f4f5f6', '#1d2126'] };
function blockHtml(C, b, r, c, link) {
  const t = b && b.type;
  if (t === 'heading') return `<h2 style="margin:0 0 12px;font-size:${b.size === 'l' ? 26 : 20}px;line-height:1.25;color:#1d2126;font-family:${F}">${esc(merge(b.text, r))}</h2>`;
  if (t === 'text') return `<div style="font-size:15px;line-height:1.6;color:#3a4048;font-family:${F}"><p style="margin:0 0 14px">${rich(merge(b.text, r), (u) => link(u))}</p></div>`;
  if (t === 'button' && b.label && b.url) return `<div style="margin:6px 0 18px">${btn(merge(b.label, r), link(b.url))}</div>`;
  if (t === 'image' && /^https:\/\//.test(b.src || '')) { const im = `<img src="${esc(b.src)}" width="624" alt="${esc(b.alt || '')}" style="display:block;border:0;width:100%;max-width:624px;height:auto;border-radius:14px">`; return `<div style="margin:0 0 18px">${b.url ? `<a href="${esc(link(b.url))}">${im}</a>` : im}</div>`; }
  if (t === 'banner') { const k = BG[b.bg] || BG.red; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:${k[0]};border-radius:16px;padding:22px 24px;font-family:${F}"><div style="font-size:22px;line-height:1.25;font-weight:700;color:${k[1]}">${esc(merge(b.text, r))}</div>${b.sub ? `<div style="margin:6px 0 0;font-size:14px;line-height:1.5;color:${k[1]};opacity:.9">${esc(merge(b.sub, r))}</div>` : ''}${b.label && b.url ? `<div style="margin:14px 0 0"><a href="${esc(link(b.url))}" style="display:inline-block;padding:11px 20px;border-radius:50px;background:${k[1]};color:${k[0]};font-weight:700;font-size:14px;text-decoration:none">${esc(b.label)}</a></div>` : ''}</td></tr></table>`; }
  if (t === 'products') return productsBlock(C, b, r, link);
  if (t === 'divider') return '<div style="border-top:1px solid #eceef0;margin:8px 0 20px;font-size:0;line-height:0">&nbsp;</div>';
  if (t === 'spacer') return `<div style="height:${Math.max(4, Math.min(80, parseInt(b.h, 10) || 20))}px;line-height:1px;font-size:0">&nbsp;</div>`;
  return '';
}
// r: { email, name, company, tier, sp, priced }   o: { sendId, base } (tracking only when a send id is given)
function render(c, r, C, o) {
  o = o || {}; r = r || {};
  const base = (o.base || SITE()).replace(/\/+$/, ''), id = o.sendId || null, t = id ? tok(id) : null;
  const link = (url, code) => { const u = withUtm(merge(url, r), c, code); return t && /^https?:\/\//i.test(u) ? `${base}/api/e?c=${t}&u=${b64(u)}&s=${linkSig(id, u)}${code ? '&p=' + encodeURIComponent(code) : ''}` : u; };
  const unsub = t ? `${base}/api/e?u=${t}` : `${base}/api/e?u=preview`;
  const blocks = ((c.content && c.content.blocks) || []).map((b) => blockHtml(C, b, r, c, link)).join('\n');
  const pre = merge(c.preheader, r);
  const html = `<!doctype html><html lang="${esc(c.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(merge(c.subject, r))}</title>
<style>@media only screen and (max-width:520px){.mx-col{display:block!important;width:100%!important;padding:0 0 12px 0!important}.mx-pad{padding:22px 18px!important}}</style></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:${F};color:#1d2126;-webkit-text-size-adjust:100%">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(pre)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#1d2126;padding:22px 28px"><a href="${esc(link(SITE()))}" style="text-decoration:none"><img src="${IMG}logo-negative.png" width="136" height="30" alt="Maxzz Diesel" style="display:block;border:0;width:136px;height:auto"></a></td></tr>
<tr><td class="mx-pad" style="padding:30px 28px 18px;font-family:${F}">
${blocks}
</td></tr>
<tr><td style="background:#f7f8f9;border-top:1px solid #eceef0;padding:22px 28px;font-family:${F};font-size:13px;line-height:1.6;color:#5f6670">
<p style="margin:0 0 8px;color:#1d2126;font-weight:700">Maxzz Diesel <span style="color:#d32a37">·</span> <span style="font-weight:400;color:#5f6670">Diesel is all we do. Since 1992.</span></p>
<p style="margin:0">Phone +1 (954) 586-4158 · WhatsApp +1 (954) 371-6996 · <a href="mailto:sales@maxzzdiesel.com" style="color:#1d2126;text-decoration:none">sales@maxzzdiesel.com</a><br>Maxzz Diesel Group, 6601 Lyons Road, Ste H-6, Coconut Creek, FL 33073, United States</p>
<p style="margin:14px 0 0;font-size:12px;color:#8a9097">You are receiving this because you are a Maxzz Diesel customer or asked to hear from us. <a href="${esc(unsub)}" style="color:#5f6670;text-decoration:underline">Unsubscribe</a></p>
</td></tr></table>
</td></tr></table>${t ? `<img src="${base}/api/e?o=${t}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}</body></html>`;
  return { subject: merge(c.subject, r).slice(0, 200), html, unsub };
}

// ---- audience -----------------------------------------------------------------------------------------------
const splitEmails = (s) => String(s || '').toLowerCase().split(/[\s,;]+/).map((e) => e.trim()).filter((e) => EMAIL.test(e));
const uuid = (x) => /^[0-9a-f-]{36}$/i.test(String(x || ''));
// audience: { segments: [id], customers: bool, tiers: [name], salespeople: [name], exclude: [segment id], consent: 'optin' | 'customers' }
async function audience(a) {
  a = a || {};
  const segs = (Array.isArray(a.segments) ? a.segments : []).filter(uuid), excl = (Array.isArray(a.exclude) ? a.exclude : []).filter(uuid);
  const people = new Map(), out = { invalid: 0 };
  const add = (email, x) => { if (!EMAIL.test(email)) { out.invalid++; return; } if (!people.has(email)) people.set(email, Object.assign({ email }, x)); };
  const ulc = await db.selectAll('ul_customers', 'select=code,name,tier,email,contact_name,salesperson,obsolete');
  const byCode = {}; ulc.forEach((u) => { byCode[u.code] = u; });
  const companiesOf = async (ids) => { if (!ids.length) return []; const links = await db.selectAll('company_segments', 'select=company_id&segment_id=in.(' + ids.join(',') + ')'); const cids = [...new Set(links.map((l) => l.company_id))], cos = [];
    for (let i = 0; i < cids.length; i += 100) cos.push(...(await db.select('companies', 'select=id,name,unleashed_code,tier,salesperson,contact_email,contact_name,status&id=in.(' + cids.slice(i, i + 100).join(',') + ')'))); return cos; };
  if (segs.length) {
    const cos = await companiesOf(segs), ids = cos.map((c) => c.id), users = [];
    for (let i = 0; i < ids.length; i += 100) users.push(...(await db.select('users', 'select=company_id,email,name,status&company_id=in.(' + ids.slice(i, i + 100).join(',') + ')')));
    cos.forEach((co) => { const u = byCode[co.unleashed_code] || {}, x = { company: co.name, code: co.unleashed_code || null, tier: co.tier || u.tier || null, sp: co.salesperson || u.salesperson || null, priced: !!(co.unleashed_code) };
      splitEmails(co.contact_email).forEach((e) => add(e, Object.assign({ name: co.contact_name || '' }, x)));
      users.filter((p) => p.company_id === co.id && p.status !== 'disabled' && p.status !== 'rejected').forEach((p) => add(String(p.email).toLowerCase(), Object.assign({ name: p.name || '' }, x))); });
  }
  if (a.customers) ulc.filter((u) => !u.obsolete && u.email).forEach((u) => splitEmails(u.email).forEach((e) => add(e, { name: u.contact_name || '', company: u.name, code: u.code, tier: u.tier || null, sp: u.salesperson || null, priced: true })));
  let list = [...people.values()];
  const tiers = (Array.isArray(a.tiers) ? a.tiers : []).map((t) => String(t).toLowerCase()), sps = Array.isArray(a.salespeople) ? a.salespeople : [];
  if (tiers.length) list = list.filter((p) => tiers.includes(String(p.tier || '(none)').toLowerCase()));
  if (sps.length) list = list.filter((p) => sps.includes(p.sp || '(none)'));
  out.matched = list.length;
  if (excl.length) { const ex = new Set(); const cos = await companiesOf(excl); cos.forEach((co) => splitEmails(co.contact_email).forEach((e) => ex.add(e))); const n0 = list.length; list = list.filter((p) => !ex.has(p.email)); out.excludedList = n0 - list.length; }
  const sup = new Map(); (await db.selectAll('email_suppressions', 'select=email,reason')).forEach((s) => sup.set(String(s.email).toLowerCase(), s.reason));
  const n1 = list.length; out.unsubscribed = list.filter((p) => sup.get(p.email) === 'unsubscribed' || sup.get(p.email) === 'manual').length; out.bounced = list.filter((p) => sup.get(p.email) === 'bounced' || sup.get(p.email) === 'complained').length;
  list = list.filter((p) => !sup.has(p.email));
  if (a.consent !== 'customers') { const ok = new Set((await db.selectAll('email_optins', 'select=email')).map((o) => String(o.email).toLowerCase())); const n2 = list.length; list = list.filter((p) => ok.has(p.email) || internalTo(p.email)); out.noOptin = n2 - list.length; }
  out.count = list.length; out.suppressed = n1 - list.length - (out.noOptin || 0);
  return { list, info: out };
}
async function facets() {
  const ulc = await db.selectAll('ul_customers', 'select=tier,salesperson,email,obsolete');
  const live = ulc.filter((u) => !u.obsolete && u.email), cnt = (k) => { const m = {}; live.forEach((u) => { const v = u[k] || '(none)'; m[v] = (m[v] || 0) + 1; }); return Object.keys(m).sort().map((v) => [v, m[v]]); };
  return { tiers: cnt('tier'), salespeople: cnt('salesperson'), customers: live.length };
}

// ---- sending ------------------------------------------------------------------------------------------------
async function resendBatch(items) {
  const key = process.env.RESEND_API_KEY; if (!key) return { error: 'no RESEND_API_KEY' };
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(items) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: 'Resend ' + r.status + ' ' + String((j && (j.message || j.name)) || '').slice(0, 160) };
    return { ids: ((j && j.data) || []).map((x) => x && x.id) };
  } catch (e) { return { error: 'Resend ' + (e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 120)) }; } finally { clearTimeout(tm); }
}
const mailItem = (c, r, C, o) => { const m = render(c, r, C, o); return { from: FROM(), to: [r.email], subject: m.subject, html: m.html, reply_to: REPLY(), headers: { 'List-Unsubscribe': '<' + m.unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }; };
const allowed = (email) => customerMailOn() || internalTo(email) || pilotTo(email);

// a test goes out now, to a few addresses, with the data of the first person in the audience when there is one
async function sendTest(c, emails, base) {
  const C = await loadCatalog(); let sample = { name: 'Alex Sample', company: 'Sample Diesel Service', tier: null, sp: 'Michael', priced: true };
  try { const a = await audience(c.audience); if (a.list[0]) sample = a.list[0]; } catch (e) { /* the sample person is enough */ }
  const ok = emails.filter(allowed), blocked = emails.filter((e) => !allowed(e));
  if (!ok.length) return { sent: 0, blocked, error: blocked.length ? 'Customer e-mail is switched off: tests only go to team addresses for now.' : 'No address.' };
  const r = await resendBatch(ok.map((e) => { const it = mailItem(Object.assign({}, c, { subject: '[Test] ' + c.subject }), Object.assign({}, sample, { email: e }), C, { base }); return it; }));
  return r.error ? { sent: 0, blocked, error: r.error } : { sent: ok.length, blocked };
}
// puts every person of the audience on the send list of the campaign (once: the pair campaign + e-mail is unique)
async function queue(c) {
  const a = await audience(c.audience);
  for (let i = 0; i < a.list.length; i += 400) await db.insert('email_sends', a.list.slice(i, i + 400).map((p) => ({ campaign_id: c.id, email: p.email, name: p.name || null, company: p.company || null, customer_code: p.code || null, tier: p.tier || null })), { onConflict: 'campaign_id,email', ignoreDuplicates: true });
  await db.update('email_campaigns', 'id=eq.' + c.id, { status: 'sending', started_at: new Date().toISOString() });
  return a.list.length;
}
// sends what is queued, a batch at a time, until the list is empty or the time budget ends
async function processCampaign(c, budgetMs, base) {
  const t0 = Date.now(), C = await loadCatalog(); let sent = 0, held = 0, failed = 0;
  const sps = {}; (await db.selectAll('ul_customers', 'select=code,salesperson')).forEach((u) => { sps[u.code] = u.salesperson; });
  // rows claimed by a run that died are put back after 15 minutes
  await db.update('email_sends', 'campaign_id=eq.' + c.id + '&status=eq.sending&claimed_at=lt.' + new Date(Date.now() - 15 * 60 * 1000).toISOString(), { status: 'queued' }).catch(() => {});
  for (;;) {
    if (Date.now() - t0 > budgetMs) break;
    const next = await db.select('email_sends', 'select=id&campaign_id=eq.' + c.id + '&status=eq.queued&order=created_at&limit=50');
    if (!next.length) break;
    // claim: only the rows this run actually flips from queued to sending are its own
    const mine = await db.update('email_sends', 'status=eq.queued&id=in.(' + next.map((x) => x.id).join(',') + ')', { status: 'sending', claimed_at: new Date().toISOString() });
    if (!Array.isArray(mine) || !mine.length) continue;
    const go = mine.filter((s) => allowed(s.email)), stop = mine.filter((s) => !allowed(s.email));
    if (stop.length) { await db.update('email_sends', 'id=in.(' + stop.map((s) => s.id).join(',') + ')', { status: 'held', error: 'Customer e-mail is switched off' }); held += stop.length; }
    if (!go.length) continue;
    const r = await resendBatch(go.map((s) => mailItem(c, { email: s.email, name: s.name, company: s.company, tier: s.tier, sp: sps[s.customer_code] || null, priced: !!s.customer_code }, C, { sendId: s.id, base })));
    if (r.error) { await db.update('email_sends', 'id=in.(' + go.map((s) => s.id).join(',') + ')', { status: r.error === 'no RESEND_API_KEY' ? 'held' : 'failed', error: r.error }); failed += go.length; if (/ 4(01|03|22|29)\b/.test(r.error) || r.error === 'no RESEND_API_KEY') break; continue; }
    const now = new Date().toISOString();
    for (let i = 0; i < go.length; i += 10) await Promise.all(go.slice(i, i + 10).map((s, j) => db.update('email_sends', 'id=eq.' + s.id, { status: 'sent', sent_at: now, provider_id: r.ids[i + j] || null, error: null }).catch((e) => console.error('send mark', e.message))));
    sent += go.length;
    await new Promise((z) => setTimeout(z, 600)); // stays under the provider's requests per second
  }
  const left = await db.select('email_sends', 'select=id&campaign_id=eq.' + c.id + '&status=in.(queued,sending)&limit=1');
  if (!left.length) await db.update('email_campaigns', 'id=eq.' + c.id + '&status=eq.sending', { status: 'sent', sent_at: new Date().toISOString() });
  return { sent, held, failed, done: !left.length };
}
// what the cron does every few minutes: start the campaigns that are due, keep sending the ones in progress
async function tick(budgetMs, base) {
  const t0 = Date.now(), out = [];
  const due = await db.select('email_campaigns', 'select=*&status=eq.scheduled&scheduled_at=lte.' + new Date().toISOString() + '&order=scheduled_at&limit=5');
  for (const c of due) { const n = await queue(c); out.push({ id: c.id, queued: n }); }
  const run = await db.select('email_campaigns', 'select=*&status=eq.sending&order=started_at&limit=5');
  for (const c of run) { const left = budgetMs - (Date.now() - t0); if (left < 5000) break; out.push(Object.assign({ id: c.id }, await processCampaign(c, left - 3000, base))); }
  return out;
}
function statsOf(sends) {
  const s = { total: sends.length, queued: 0, sent: 0, held: 0, failed: 0, bounced: 0, complained: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0 };
  sends.forEach((x) => { if (x.status === 'sending') s.queued++; else if (s[x.status] != null) s[x.status]++; if (x.delivered_at) s.delivered++; if (x.opened_at) s.opened++; if (x.clicked_at) s.clicked++; if (x.unsubscribed_at) s.unsubscribed++; });
  s.reached = s.sent + s.bounced + s.complained;
  return s;
}

module.exports = { render, loadCatalog, audience, facets, sendTest, queue, processCampaign, tick, statsOf, tok, untok, unb64, linkSig, nameOf, allowed, FROM };
