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
  return { map, prod: prod || { tiers: [], items: {} }, camps, layout: await loadLayout() };
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
  if (!deal) return { now: price, was: null };
  const camp = C.camps.find((x) => x.slug === deal.slug) || {}, off = Math.round((1 - deal.price / price) * 100);
  return { now: deal.price, was: price, badge: String(camp.badge || deal.name || 'Offer').slice(0, 28), off: off > 0 ? off : 0, color: /^#[0-9a-f]{6}$/i.test(camp.color || '') ? camp.color : '#d32a37' };
}

// ---- rendering ----------------------------------------------------------------------------------------------
const firstName = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30);
function merge(text, r) {
  if (r && r.__raw) return String(text || ''); // the designer keeps the {{fields}} as typed
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
const btn = (label, href, small, bg) => `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${bg || '#d32a37'};border-radius:50px"><a href="${esc(href)}" style="display:inline-block;padding:${small ? '10px 18px' : '14px 26px'};color:#ffffff;text-decoration:none;font-weight:600;font-size:${small ? 13 : 15}px;font-family:${F}">${esc(label)}</a></td></tr></table>`;

// ---- product blocks ----------------------------------------------------------------------------------------------
// Every photo comes from /api/img?c=<part>: the store photo (the Unleashed one when there is none) inside a fixed 4:3
// box, as JPEG. The texts have a fixed number of lines, so the cards of one row always have the same height.
const HIDE = ['photo', 'code', 'cat', 'app', 'cta'];
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:/-]+$/, '') + '…' : s; };
// look of a product block, chosen in the designer: "ts:18;tc:#1d2126;xc:#5f6670;bc:#d32a37;r:16;full:1"
const HEX = /^#[0-9a-f]{6}$/i;
function parseLook(v) {
  const o = {}, src = v && typeof v === 'object' ? v : Object.fromEntries(String(v || '').split(';').map((x) => x.split(':')).filter((x) => x.length === 2));
  const n = (k, a, b) => { const x = parseInt(src[k], 10); if (!isNaN(x)) o[k] = Math.max(a, Math.min(b, x)); };
  n('ts', 11, 32); n('r', 0, 28); n('pd', 0, 60); if (['l', 'c', 'r'].includes(src.al)) o.al = src.al; if (['w', 'd', 'b'].includes(src.bx)) o.bx = src.bx; ['tc', 'xc', 'bc'].forEach((k) => { if (HEX.test(src[k] || '')) o[k] = String(src[k]).toLowerCase(); });
  if (src.full === true || src.full === '1' || src.full === 1) o.full = true;
  return o;
}
const ASK = { en: 'Ask for price', es: 'Consultar', pt: 'Consulte' };
function productCard(C, code, r, o, link, layout, base, anyDeal) {
  const row = C.map[code]; if (!row) return null;
  const H = new Set(Array.isArray(o.hide) ? o.hide : []), n = nameOf(row[1]);
  const href = link(SITE() + '/portal#/p/' + encodeURIComponent(code), code);
  const K = o.look || {}, tcol = K.tc || '#1d2126', xcol = K.xc || '#5f6670', bcol = K.bc || '#d32a37', rad = (d) => (K.full ? 0 : K.r != null ? K.r : d);
  const showPrice = o.price === 'tier', pr = showPrice && r.priced ? priceFor(C, code, r.tier) : null, ask = ASK[C.lang] || ASK.en;
  const src = (s) => `${base}/api/img?c=${encodeURIComponent(code)}&s=${s}`;
  const meta = [H.has('cat') ? '' : String(row[3] || '').toUpperCase(), H.has('cat') ? '' : String(row[4] || '').toUpperCase()].filter(Boolean);
  // campaign badge: the name of the campaign and how much it takes off
  const badge = pr && pr.badge ? `<span style="display:inline-block;background:${pr.color};color:#ffffff;border-radius:50px;padding:3px 9px;font-size:11px;line-height:14px;font-weight:700;letter-spacing:.03em;white-space:nowrap;font-family:${F}">${esc(pr.badge)}${pr.off ? ' · -' + pr.off + '%' : ''}</span>` : '';
  const was = (sz) => pr && pr.was ? ` <span style="font-size:${sz}px;font-weight:400;color:#8a9097;text-decoration:line-through">${money(pr.was)}</span>` : '';
  const priceTxt = (sz) => pr ? `<span style="color:${pr.was ? pr.color : '#1d2126'}">${money(pr.now)}</span>${was(sz)}` : `<span style="font-size:${sz + 1}px;font-weight:600;color:#5f6670">${esc(ask)}</span>`;
  if (layout === 'list') {
    const line2 = [H.has('code') ? '' : `<span style="font-family:Menlo,Consolas,monospace;color:#3a4048">${esc(code)}</span>`, meta.length ? `<span style="letter-spacing:.04em;font-size:11px;font-weight:700;color:#c2410c">${esc(meta[0])}</span>${meta[1] ? `<span style="letter-spacing:.04em;font-size:11px;color:#8a9097"> ${esc(meta[1])}</span>` : ''}` : '', !H.has('app') && n.app ? esc(cut(n.app, H.has('code') ? 46 : 28)) : ''].filter(Boolean).join(' <span style="color:#c3c8ce">·</span> ');
    const price = showPrice ? `<div style="margin:0 0 6px;font-size:15px;font-weight:700;color:#1d2126;white-space:nowrap">${priceTxt(12)}</div>` : '';
    return `<tr>${H.has('photo') ? '' : `<td width="88" valign="middle" style="width:88px;padding:12px 0;border-bottom:1px solid #eceef0"><a href="${esc(href)}"><img src="${esc(src('xs'))}" width="72" height="54" alt="${esc(n.name)}" style="display:block;border:0;width:72px;height:54px;border-radius:8px;background:#f4f5f6"></a></td>`}
<td valign="middle" style="padding:12px 12px 12px 0;border-bottom:1px solid #eceef0;font-family:${F}">${badge ? `<div style="margin:0 0 5px">${badge}</div>` : ''}<a href="${esc(href)}" style="display:block;font-size:${K.ts || 15}px;line-height:1.3;font-weight:600;color:${tcol};text-decoration:none">${esc(cut(n.name, 64))}</a>${line2 ? `<div style="margin:3px 0 0;font-size:12.5px;line-height:1.4;color:${xcol}">${line2}</div>` : ''}</td>
${price || !H.has('cta') ? `<td align="right" valign="middle" style="padding:12px 0;border-bottom:1px solid #eceef0;font-family:${F};white-space:nowrap">${price}${H.has('cta') ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr><td style="background:${bcol};border-radius:50px"><a href="${esc(href)}" style="display:inline-block;padding:9px 16px;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;font-family:${F};white-space:nowrap">${esc(o.cta || 'View part')}</a></td></tr></table>`}</td>` : ''}</tr>`;
  }
  if (layout === 'hero') {
    // one part in evidence: the photo fills the block and a white box sits on it (mail programs without background
    // pictures show the box on a dark block)
    const bg = H.has('photo') ? '' : src('xl'), dark = K.bx === 'd', bar = K.bx === 'b', pd = bar ? 0 : K.pd != null ? K.pd : (K.full ? 28 : 16), al = K.al === 'c' ? 'center' : K.al === 'r' ? 'right' : 'left', R0 = rad(18);
    const tc2 = K.tc || (dark ? '#ffffff' : '#1d2126'), xc2 = K.xc || (dark ? '#c9ced3' : '#5f6670');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 ${K.full ? 0 : 12}px"><tr><td ${bg ? `background="${esc(bg)}" ` : ''}valign="bottom" align="${al}" style="background-color:#1d2126;${bg ? `background-image:url('${esc(bg)}');background-size:cover;background-position:center;` : ''}border-radius:${R0}px;padding:${bg ? (K.full ? 240 : 210) : Math.max(pd, 16)}px ${pd}px ${pd}px">
<table role="presentation" ${bar ? 'width="100%"' : `width="330" align="${al}"`} cellpadding="0" cellspacing="0" style="width:100%;${bar ? '' : 'max-width:330px;'}background:${dark ? '#1d2126' : '#ffffff'};border-radius:${bar ? `0 0 ${R0}px ${R0}px` : '14px'}"><tr><td align="left" style="padding:${bar ? '18px 28px 22px' : '18px 20px'};font-family:${F};text-align:left">
${badge ? `<div style="margin:0 0 8px">${badge}</div>` : ''}${H.has('code') ? '' : `<div style="font-family:Menlo,Consolas,monospace;font-size:12px;color:${xc2}">${esc(code)}</div>`}${meta.length ? `<div style="margin:3px 0 0;font-size:11px;letter-spacing:.06em;font-weight:700;color:${dark ? '#f08a24' : '#c2410c'}">${esc(meta[0])}${meta[1] ? `<span style="font-weight:400;color:#8a9097"> · ${esc(meta[1])}</span>` : ''}</div>` : ''}
<a href="${esc(href)}" style="display:block;margin:6px 0 0;font-size:${K.ts || 21}px;line-height:1.2;font-weight:700;color:${tc2};text-decoration:none">${esc(cut(n.name, 60))}</a>${!H.has('app') && n.app ? `<div style="margin:5px 0 0;font-size:13.5px;line-height:1.4;color:${xc2}">${esc(cut(n.app, 70))}</div>` : ''}
${showPrice ? `<div style="margin:10px 0 0;font-size:20px;font-weight:700;color:${tc2}">${dark && !(pr && pr.was) ? priceTxt(14).replace('color:#1d2126', 'color:#ffffff').replace('color:#5f6670', 'color:#c9ced3') : priceTxt(14)}</div>` : ''}${H.has('cta') ? '' : `<div style="margin:14px 0 0">${btn(o.cta || 'View part', href, true, bcol)}</div>`}</td></tr></table></td></tr></table>`;
  }
  const g3 = layout === 'grid3', fs = K.ts || (g3 ? 14 : 16), lh = Math.round(fs * 1.3), pw = g3 ? 180 : 284;
  const line = (h, html, st) => `<div style="height:${h}px;line-height:${h}px;overflow:hidden;${st}">${html || '&nbsp;'}</div>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceef0;border-radius:${rad(16)}px;background:#ffffff"><tr><td style="padding:${g3 ? 10 : 12}px;font-family:${F}">
${H.has('photo') ? '' : `<a href="${esc(href)}" style="display:block;text-decoration:none"><img src="${esc(src(g3 ? 'm' : 'l'))}" width="${pw}" alt="${esc(n.name)}" style="display:block;border:0;width:100%;height:auto;aspect-ratio:4/3;object-fit:contain;border-radius:${Math.max(0, rad(16) - 6)}px;background:#f4f5f6"></a><div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>`}
${anyDeal ? line(22, badge, 'margin:0 0 4px') : ''}${H.has('code') ? '' : line(16, esc(code), 'font-family:Menlo,Consolas,monospace;font-size:12px;color:#5f6670')}
${meta.length ? line(16, `${esc(meta[0])}${meta[1] ? `<span style="font-weight:400;color:#8a9097"> · ${esc(meta[1])}</span>` : ''}`, 'margin:2px 0 0;font-size:11px;letter-spacing:.06em;font-weight:700;color:#c2410c') : ''}
<a href="${esc(href)}" style="display:block;margin:6px 0 0;height:${lh * 2}px;overflow:hidden;font-size:${fs}px;line-height:${lh}px;font-weight:600;color:${tcol};text-decoration:none">${esc(cut(n.name, g3 ? 44 : 60))}</a>
${H.has('app') ? '' : line(18, esc(cut(n.app, g3 ? 26 : 40)), 'margin:4px 0 0;font-size:13px;color:' + xcol)}
${showPrice ? line(24, priceTxt(13), 'margin:8px 0 0;font-size:17px;font-weight:700;color:#1d2126') : ''}
${H.has('cta') ? '' : `<div style="margin:12px 0 0">${btn(o.cta || 'View part', href, true, bcol)}</div>`}</td></tr></table>`;
}
function productsBlock(C, b, r, link, base) {
  const layout = ['list', 'grid2', 'grid3', 'hero'].includes(b.layout) ? b.layout : 'list', per = layout === 'grid3' ? 3 : layout === 'grid2' ? 2 : 1;
  base = String(base || SITE()).replace(/\/+$/, '');
  const codes = (Array.isArray(b.codes) ? b.codes : []).slice(0, 24);
  const anyDeal = b.price === 'tier' && r.priced && codes.some((c) => { const p = C.map[c] && priceFor(C, c, r.tier); return p && p.badge; });
  const cards = codes.map((c) => productCard(C, c, r, b, link, layout, base, anyDeal)).filter(Boolean);
  if (!cards.length) return '';
  if (layout === 'hero') return cards.join('\n');
  if (per === 1) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border-top:1px solid #eceef0">${cards.join('\n')}</table>`;
  let out = '';
  // equal columns with fixed 12px gaps between them (on a phone the gaps go away and the cards stack)
  const gap = '<td class="mx-gap" width="12" style="width:12px;font-size:0;line-height:0">&nbsp;</td>';
  for (let i = 0; i < cards.length; i += per) {
    const row = cards.slice(i, i + per), cells = row.map((c) => `<td class="mx-col" valign="top">${c}</td>`);
    while (cells.length < per) cells.push('<td class="mx-col">&nbsp;</td>');
    out += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin:0 0 12px"><tr>${cells.join(gap)}</tr></table>`;
  }
  return out;
}
const BG = { red: ['#d32a37', '#ffffff'], dark: ['#1d2126', '#ffffff'], orange: ['#f08a24', '#1d2126'], soft: ['#f4f5f6', '#1d2126'] };
function blockHtml(C, b, r, c, link, base) {
  const t = b && b.type;
  if (t === 'heading') return `<h2 style="margin:0 0 12px;font-size:${b.size === 'l' ? 26 : 20}px;line-height:1.25;color:#1d2126;font-family:${F}">${esc(merge(b.text, r))}</h2>`;
  if (t === 'text') return `<div style="font-size:15px;line-height:1.6;color:#3a4048;font-family:${F}"><p style="margin:0 0 14px">${rich(merge(b.text, r), (u) => link(u))}</p></div>`;
  if (t === 'button' && b.label && b.url) return `<div style="margin:6px 0 18px">${btn(merge(b.label, r), link(b.url))}</div>`;
  if (t === 'image' && /^https:\/\//.test(b.src || '')) { const im = `<img src="${esc(b.src)}" width="624" alt="${esc(b.alt || '')}" style="display:block;border:0;width:100%;max-width:624px;height:auto;border-radius:14px">`; return `<div style="margin:0 0 18px">${b.url ? `<a href="${esc(link(b.url))}">${im}</a>` : im}</div>`; }
  if (t === 'banner') { const k = BG[b.bg] || BG.red; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:${k[0]};border-radius:16px;padding:22px 24px;font-family:${F}"><div style="font-size:22px;line-height:1.25;font-weight:700;color:${k[1]}">${esc(merge(b.text, r))}</div>${b.sub ? `<div style="margin:6px 0 0;font-size:14px;line-height:1.5;color:${k[1]};opacity:.9">${esc(merge(b.sub, r))}</div>` : ''}${b.label && b.url ? `<div style="margin:14px 0 0"><a href="${esc(link(b.url))}" style="display:inline-block;padding:11px 20px;border-radius:50px;background:${k[1]};color:${k[0]};font-weight:700;font-size:14px;text-decoration:none">${esc(b.label)}</a></div>` : ''}</td></tr></table>`; }
  if (t === 'products') return productsBlock(C, b, r, link, base);
  if (t === 'divider') return '<div style="border-top:1px solid #eceef0;margin:8px 0 20px;font-size:0;line-height:0">&nbsp;</div>';
  if (t === 'spacer') return `<div style="height:${Math.max(4, Math.min(80, parseInt(b.h, 10) || 20))}px;line-height:1px;font-size:0">&nbsp;</div>`;
  return '';
}
// free design (GrapesJS): the saved HTML with the fields filled in, the links tracked and the product blocks drawn
const attr = (tag, name) => { const m = tag.match(new RegExp(name + '="([^"]*)"')); return m ? m[1].replace(/&amp;/g, '&') : ''; };
function freeHtml(C, c, r, link, base) {
  let h = String(c.content.html || ''); const bm = h.match(/<body[^>]*>([\s\S]*)<\/body>/i); if (bm) h = bm[1];
  const er = {}; ['name', 'company', 'sp', 'tier'].forEach((k) => { er[k] = r[k] ? esc(r[k]) : r[k]; });
  h = merge(h, er);
  h = h.replace(/href="(https?:\/\/[^"]+)"/gi, (m, u) => 'href="' + esc(link(u.replace(/&amp;/g, '&'))) + '"');
  return h.replace(/<table[^>]*data-mx-products="[^"]*"[^>]*>[\s\S]*?<\/table>/gi, (m) => { const tag = m.slice(0, m.indexOf('>') + 1);
    return productsBlock(C, { codes: attr(tag, 'data-mx-products').split(/[\s,;]+/).filter(Boolean), layout: attr(tag, 'data-layout') || 'grid2', price: attr(tag, 'data-price') === 'tier' ? 'tier' : 'none', cta: attr(tag, 'data-cta') || 'View part', hide: attr(tag, 'data-hide').split(',').filter((x) => HIDE.includes(x)), look: parseLook(attr(tag, 'data-look')) }, r, link, base) || ''; });
}
// what the visual designer starts from: the blocks as plain HTML, with a marker where each product block goes
const productMarker = (b) => `<table data-mx-products="${esc((b.codes || []).join(','))}" data-layout="${esc(b.layout || 'grid2')}" data-price="${b.price === 'tier' ? 'tier' : 'none'}" data-cta="${esc(b.cta || 'View part')}" data-hide="${esc((b.hide || []).join(','))}" width="100%" style="width:100%;margin:0 0 12px"></table>`;
function seedHtml(C, c) {
  const raw = { __raw: true }, link = (u) => u;
  const inner = ((c.content && c.content.blocks) || []).map((b) => (b.type === 'products' ? productMarker(b) : blockHtml(C, b, raw, c, link))).join('\n');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr><td style="padding:30px 28px 18px;font-family:${F}">${inner || '<p style="margin:0;font-size:15px;line-height:1.6;color:#3a4048">Drag blocks from the right to start.</p>'}</td></tr></table>`;
}

// ---- standard header and footer (Marketing > Email campaigns > Header and footer) ------------------------------------
// One header and one footer for every campaign and template. The unsubscribe link and the company address always go out.
const LAYOUT0 = { header: { bg: 'dark', align: 'left', links: [] }, footer: { tagline: 'Diesel is all we do. Since 1992.', phone: '+1 (954) 586-4158', whatsapp: '+1 (954) 371-6996', whatsapp2: '+1 (786) 241-2167', email: 'sales@maxzzdiesel.com', website: 'maxzzdiesel.com', address: '6601 Lyons Road, Ste H-6, Coconut Creek, FL 33073', reason: 'You are receiving this because you are a Maxzz Diesel customer or asked to hear from us.',
  linkedin: 'https://www.linkedin.com/company/maxzzdiesel/', instagram: 'https://www.instagram.com/maxzzdiesel.us/', facebook: 'https://www.facebook.com/maxzzdiesel' } };
const t1 = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const links = (l, n) => (Array.isArray(l) ? l : []).map((x) => ({ label: t1(x && x.label, 30), url: t1(x && x.url, 400) })).filter((x) => x.label && /^https:\/\//i.test(x.url)).slice(0, n);
function cleanLayout(L) {
  L = L || {}; const h = L.header || {}, f = L.footer || {}, d = LAYOUT0.footer;
  const or = (k, n) => t1(f[k] == null ? d[k] : f[k], n), url = (k) => { const v = or(k, 300); return /^https:\/\//i.test(v) ? v : ''; };
  return { header: { bg: h.bg === 'light' ? 'light' : 'dark', align: h.align === 'center' ? 'center' : 'left', links: links(h.links, 3) },
    footer: { tagline: or('tagline', 120), phone: or('phone', 40), whatsapp: or('whatsapp', 40), whatsapp2: or('whatsapp2', 40), email: EMAIL.test(t1(f.email, 120)) ? t1(f.email, 120) : d.email, website: or('website', 80).replace(/^https?:\/\//i, '').replace(/\/+$/, ''), address: t1(f.address, 240) || d.address, reason: t1(f.reason, 240) || d.reason, linkedin: url('linkedin'), instagram: url('instagram'), facebook: url('facebook') } };
}
async function loadLayout() { try { const r = await db.select('email_settings', 'select=value&key=eq.layout&limit=1'); return cleanLayout(r[0] && r[0].value); } catch (e) { return cleanLayout(null); } }
function chrome(L, link, unsub, base) {
  L = L || cleanLayout(null); const h = L.header, f = L.footer, dark = h.bg !== 'light', c = h.align === 'center';
  const logo = `<a href="${esc(link(SITE()))}" style="text-decoration:none"><img src="${dark ? IMG + 'logo-negative.png' : String(base || SITE()).replace(/\/+$/, '') + '/assets/email/logo-positive.png'}" width="136" height="30" alt="Maxzz Diesel" style="display:${c ? 'inline-block' : 'block'};border:0;width:136px;height:auto"></a>`;
  const nav = h.links.map((x) => `<a href="${esc(link(x.url))}" style="display:inline-block;margin:0 0 0 ${c ? 9 : 18}px;${c ? 'margin-right:9px;' : ''}font-size:13px;font-weight:600;color:${dark ? '#ffffff' : '#1d2126'};text-decoration:none;font-family:${F}">${esc(x.label)}</a>`).join('');
  const st = `background:${dark ? '#1d2126' : '#ffffff'};${dark ? '' : 'border-bottom:1px solid #eceef0;'}padding:22px 28px`;
  const header = c ? `<tr><td align="center" style="${st};text-align:center">${logo}${nav ? `<div style="margin:14px 0 0">${nav}</div>` : ''}</td></tr>`
    : `<tr><td style="${st}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle">${logo}</td>${nav ? `<td align="right" valign="middle" style="font-family:${F}">${nav}</td>` : ''}</tr></table></td></tr>`;
  const dg = (v) => String(v).replace(/\D/g, ''), a1 = 'color:#1d2126;text-decoration:none', nw = a1 + ';white-space:nowrap';
  const icon = (href, name, alt) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 0 0;text-decoration:none"><img src="${IMG}${name}.png" width="32" height="32" alt="${alt}" style="display:block;border:0;width:32px;height:32px"></a>`;
  const wa = [f.whatsapp ? `<a href="https://wa.me/${dg(f.whatsapp)}" style="${nw}">${esc(f.whatsapp)}</a>${f.whatsapp2 ? ' (US)' : ''}` : '', f.whatsapp2 ? `<a href="https://wa.me/${dg(f.whatsapp2)}" style="${nw}">${esc(f.whatsapp2)}</a> (Latin America)` : ''].filter(Boolean).join(' · ');
  const rows = [f.phone ? `Phone <a href="tel:+${dg(f.phone)}" style="${nw}">${esc(f.phone)}</a>` : '', wa ? 'WhatsApp ' + wa : '', [f.email ? `<a href="mailto:${esc(f.email)}" style="${a1}">${esc(f.email)}</a>` : '', f.website ? `<a href="${esc(link('https://www.' + f.website.replace(/^www\./, '')))}" style="${a1}">${esc(f.website)}</a>` : ''].filter(Boolean).join(' · '), `<a href="https://maps.google.com/?q=${encodeURIComponent(f.address)}" style="color:#5f6670;text-decoration:none">${esc(f.address)}</a>`].filter(Boolean).join('<br>\n');
  const social = [f.linkedin ? icon(f.linkedin, 'linkedin', 'LinkedIn') : '', f.instagram ? icon(f.instagram, 'instagram', 'Instagram') : '', f.facebook ? icon(f.facebook, 'facebook', 'Facebook') : '', f.whatsapp ? icon('https://wa.me/' + dg(f.whatsapp), 'whatsapp', 'WhatsApp') : ''].join('');
  const footer = `<tr><td style="background:#f7f8f9;border-top:1px solid #eceef0;padding:24px 28px;font-family:${F};font-size:13px;line-height:1.6;color:#5f6670">
<p style="margin:0 0 10px;color:#1d2126;font-weight:700">Maxzz Diesel${f.tagline ? ` <span style="color:#d32a37">·</span> <span style="font-weight:400;color:#5f6670">${esc(f.tagline)}</span>` : ''}</p>
<p style="margin:0">${rows}</p>
${social ? `<p style="margin:16px 0 0">${social}</p>` : ''}
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#8a9097">${esc(f.reason)} <a href="${esc(unsub)}" style="color:#5f6670;text-decoration:underline">Unsubscribe</a></p>
</td></tr>`;
  return { header, footer };
}
// the page around the e-mail: colour (or picture) outside, colour of the e-mail itself and its width
function cleanPage(p) { p = p || {}; const w = parseInt(p.width, 10), rr = parseInt(p.radius, 10), pp = parseInt(p.pad, 10); return { align: ['left', 'right'].includes(p.align) ? p.align : 'center', radius: rr >= 0 && rr <= 32 ? rr : 20, pad: pp >= 0 && pp <= 80 ? pp : 28, bg: HEX.test(p.bg || '') ? p.bg : '#f2f3f5', card: HEX.test(p.card || '') ? p.card : '#ffffff', img: /^https:\/\/[^\s"'<>()]+$/.test(p.img || '') ? String(p.img).slice(0, 500) : '', width: w >= 520 && w <= 760 ? w : 680 }; }
// r: { email, name, company, tier, sp, priced }   o: { sendId, base } (tracking only when a send id is given)
function render(c, r, C, o) {
  o = o || {}; r = r || {};
  C.lang = c.lang || 'en';
  const base = (o.base || SITE()).replace(/\/+$/, ''), id = o.sendId || null, t = id ? tok(id) : null;
  const link = (url, code) => { const u = withUtm(merge(url, r), c, code); return t && /^https?:\/\//i.test(u) ? `${base}/api/e?c=${t}&u=${b64(u)}&s=${linkSig(id, u)}${code ? '&p=' + encodeURIComponent(code) : ''}` : u; };
  const unsub = t ? `${base}/api/e?u=${t}` : `${base}/api/e?u=preview`;
  const free = c.content && c.content.mode === 'free' && c.content.html;
  const blocks = free ? freeHtml(C, c, r, link, base) : ((c.content && c.content.blocks) || []).map((b) => blockHtml(C, b, r, c, link, base)).join('\n');
  const pg = cleanPage(c.content && c.content.page);
  const pre = merge(c.preheader, r), ch = chrome(C.layout, link, unsub, base);
  const html = `<!doctype html><html lang="${esc(c.lang || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(merge(c.subject, r))}</title>
<style>@media only screen and (max-width:520px){.mx-col{display:block!important;width:100%!important;padding:0 0 12px 0!important}.mx-gap{display:none!important}.mx-pad{padding:22px 18px!important}}</style></head>
<body style="margin:0;padding:0;background:${pg.bg};font-family:${F};color:#1d2126;-webkit-text-size-adjust:100%">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(pre)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pg.bg}"><tr><td align="${pg.align}" ${pg.img ? `background="${esc(pg.img)}" ` : ''}style="padding:${pg.pad}px 12px;${pg.img ? `background-image:url('${esc(pg.img)}');background-size:cover;background-position:center top;` : ''}">
<table role="presentation" width="${pg.width}" align="${pg.align}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${pg.width}px;background:${pg.card};border-radius:${pg.radius}px;overflow:hidden">
${c.content && c.content.noHeader ? '' : ch.header}
<tr><td${free ? '' : ' class="mx-pad"'} style="padding:${free ? '0' : '30px 28px 18px'};font-family:${F}">
${blocks}
</td></tr>
${ch.footer}</table>
</td></tr></table>${t ? `<img src="${base}/api/e?o=${t}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ''}</body></html>`;
  return { subject: merge(c.subject, r).slice(0, 200), html, unsub };
}

// ---- audience -----------------------------------------------------------------------------------------------
const splitEmails = (s) => String(s || '').toLowerCase().split(/[\s,;]+/).map((e) => e.trim()).filter((e) => EMAIL.test(e));
const uuid = (x) => /^[0-9a-f-]{36}$/i.test(String(x || ''));
// audience: { segments: [id], customers: bool, tiers: [name], salespeople: [name], exclude: [segment id], consent: 'optin' | 'customers' }
// exception entries: an e-mail, a whole domain (@shop.com) or a customer code, one per line
function cleanSkip(v) { const L = Array.isArray(v) ? v : String(v || '').split(/[\n,;]+/); return [...new Set(L.map((x) => String(x || '').trim().toLowerCase().slice(0, 160)).filter((x) => x && !/[<>"'\s]/.test(x)))].slice(0, 2000); }
async function loadSkip() { try { const r = await db.select('email_settings', 'select=value&key=eq.exceptions&limit=1'); return cleanSkip(r[0] && r[0].value && r[0].value.items); } catch (e) { return []; } }
const PROFILES = ['Reseller', 'Rebuilder', 'Reseller/Rebuilder', 'Other', '(none)'];
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
  // customer profile (Reseller, Rebuilder, Reseller/Rebuilder, Other): the classification kept per customer code
  const profs = (Array.isArray(a.profiles) ? a.profiles : []).filter((x) => PROFILES.includes(x));
  if (profs.length) { const sg = {}; (await db.selectAll('customer_segments', 'select=code,segment').catch(() => [])).forEach((x) => { sg[x.code] = x.segment; }); list = list.filter((p) => profs.includes((p.code && sg[p.code]) || '(none)')); }
  out.matched = list.length;
  if (excl.length) { const ex = new Set(); const cos = await companiesOf(excl); cos.forEach((co) => splitEmails(co.contact_email).forEach((e) => ex.add(e))); const n0 = list.length; list = list.filter((p) => !ex.has(p.email)); out.excludedList = n0 - list.length; }
  // exceptions: the standing list (every campaign) plus the ones written on this e-mail
  const skip = new Set([...(await loadSkip()), ...cleanSkip(a.skip)]);
  if (skip.size) { const n9 = list.length; list = list.filter((p) => !(skip.has(p.email) || skip.has('@' + String(p.email).split('@')[1]) || (p.code && skip.has(String(p.code).toLowerCase())))); out.skipped = n9 - list.length; }
  const sup = new Map(); (await db.selectAll('email_suppressions', 'select=email,reason')).forEach((s) => sup.set(String(s.email).toLowerCase(), s.reason));
  const n1 = list.length; out.unsubscribed = list.filter((p) => sup.get(p.email) === 'unsubscribed' || sup.get(p.email) === 'manual').length; out.bounced = list.filter((p) => sup.get(p.email) === 'bounced' || sup.get(p.email) === 'complained').length;
  list = list.filter((p) => !sup.has(p.email));
  if (a.consent !== 'customers') { const ok = new Set((await db.selectAll('email_optins', 'select=email')).map((o) => String(o.email).toLowerCase())); const n2 = list.length; list = list.filter((p) => ok.has(p.email) || internalTo(p.email)); out.noOptin = n2 - list.length; }
  // at most this many campaigns per person in 7 days (0 or empty: no limit)
  const cap = parseInt(a.maxPerWeek, 10) || 0;
  if (cap > 0 && list.length) { const cnt = {}; (await db.selectAll('email_sends', 'select=email&status=eq.sent&sent_at=gte.' + new Date(Date.now() - 7 * 864e5).toISOString(), 100000)).forEach((s) => { const e = String(s.email).toLowerCase(); cnt[e] = (cnt[e] || 0) + 1; }); const n3 = list.length; list = list.filter((p) => (cnt[p.email] || 0) < cap); out.capped = n3 - list.length; }
  out.count = list.length; out.suppressed = n1 - list.length - (out.noOptin || 0);
  return { list, info: out };
}
async function facets() {
  const ulc = await db.selectAll('ul_customers', 'select=code,tier,salesperson,email,obsolete');
  const sg = {}; (await db.selectAll('customer_segments', 'select=code,segment').catch(() => [])).forEach((x) => { sg[x.code] = x.segment; });
  const live = ulc.filter((u) => !u.obsolete && u.email).map((u) => Object.assign(u, { profile: sg[u.code] || null })), cnt = (k) => { const m = {}; live.forEach((u) => { const v = u[k] || '(none)'; m[v] = (m[v] || 0) + 1; }); return Object.keys(m).sort().map((v) => [v, m[v]]); };
  const pm = {}; cnt('profile').forEach((x) => { pm[x[0]] = x[1]; });
  return { tiers: cnt('tier'), salespeople: cnt('salesperson'), profiles: PROFILES.filter((k) => pm[k]).map((k) => [k, pm[k]]), customers: live.length, standing: await loadSkip() };
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
  if (budgetMs - (Date.now() - t0) > 20000) { const d = await syncDelivery(null, 24).catch(() => null); if (d && d.checked) out.push({ delivery: d.checked }); }
  return out;
}
// delivery status asked from Resend one e-mail at a time (no webhook needed): delivered, bounced or reported as spam
async function syncDelivery(campaignId, max) {
  const key = process.env.RESEND_API_KEY; if (!key) return { checked: 0 };
  const rows = await db.select('email_sends', 'select=id,email,provider_id,campaign_id&status=eq.sent&delivered_at=is.null&provider_id=not.is.null&sent_at=gte.' + new Date(Date.now() - 5 * 864e5).toISOString() + (campaignId ? '&campaign_id=eq.' + campaignId : '') + '&order=sent_at&limit=' + (max || 30));
  let checked = 0; const now = () => new Date().toISOString();
  for (let i = 0; i < rows.length; i += 2) {
    await Promise.all(rows.slice(i, i + 2).map(async (s) => { try {
      const r = await fetch('https://api.resend.com/emails/' + encodeURIComponent(s.provider_id), { headers: { Authorization: 'Bearer ' + key } }); if (!r.ok) return; const ev = String((await r.json()).last_event || ''); checked++;
      if (ev === 'bounced') { await db.update('email_sends', 'id=eq.' + s.id, { status: 'bounced', error: 'Bounced' }); await db.insert('email_suppressions', [{ email: String(s.email).toLowerCase(), reason: 'bounced', campaign_id: s.campaign_id }], { onConflict: 'email', ignoreDuplicates: true }); }
      else if (ev === 'complained') { await db.update('email_sends', 'id=eq.' + s.id, { status: 'complained', error: 'Marked as spam' }); await db.insert('email_suppressions', [{ email: String(s.email).toLowerCase(), reason: 'complained', campaign_id: s.campaign_id }], { onConflict: 'email' }); }
      else if (['delivered', 'opened', 'clicked'].includes(ev)) await db.update('email_sends', 'id=eq.' + s.id, { delivered_at: now() });
    } catch (e) { /* asked again on the next round */ } }));
    await new Promise((z) => setTimeout(z, 1050)); // two requests per second at most
  }
  return { checked, left: rows.length === (max || 30) };
}
function statsOf(sends) {
  const s = { total: sends.length, queued: 0, sent: 0, held: 0, failed: 0, bounced: 0, complained: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0 };
  sends.forEach((x) => { if (x.status === 'sending') s.queued++; else if (s[x.status] != null) s[x.status]++; if (x.delivered_at) s.delivered++; if (x.opened_at) s.opened++; if (x.clicked_at) s.clicked++; if (x.unsubscribed_at) s.unsubscribed++; });
  s.reached = s.sent + s.bounced + s.complained;
  return s;
}

module.exports = { cleanSkip, loadSkip, PROFILES, cleanPage, parseLook, cleanLayout, chrome, HIDE, seedHtml, productsHtml: (C, b, r, base) => productsBlock(C, b, r || {}, (u) => u, base), syncDelivery, render, loadCatalog, audience, facets, sendTest, queue, processCampaign, tick, statsOf, tok, untok, unb64, linkSig, nameOf, allowed, FROM };
