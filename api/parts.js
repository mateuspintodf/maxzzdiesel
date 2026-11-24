// Public, server-rendered parts catalog for search engines and visitors.
// Routes (see vercel.json rewrites):
//   /parts                    all categories, vehicles and engines
//   /parts/c/<category>       one category, every part number
//   /parts/v/<vehicle>        parts for a vehicle family (from the reviewed SEO sheet)
//   /parts/e/<engine>         parts for one engine and year range
//   /parts/<part-number>      one part
//   /sitemap-parts.xml        every indexable URL above
// No prices or stock. Part pages without reviewed copy are served with noindex.
// Set PARTS_NOINDEX=1 in Vercel to hide the whole catalog from search engines.
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.maxzzdiesel.com';
let DB = null;

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Hp|Hd|Lb|Ll|Nox|Scr|Dpf|Def|Egr|Vgt|Cr|Hpcr|Heui|Hpop|Ecm|Pcm|Oem|Usa|Us|Bosch|Ii|Iii|Iv)\b/g, (m) => ({ Bosch: 'Bosch', Ii: 'II', Iii: 'III', Iv: 'IV' }[m] || m.toUpperCase()));

const CATS = {
  Injector: { s: 'injectors', l: 'Diesel fuel injectors', d: 'New and remanufactured diesel fuel injectors from Bosch, Denso, Delphi and other makers, by part number.' },
  Pump: { s: 'pumps', l: 'High-pressure fuel pumps', d: 'Common rail and high-pressure diesel fuel pumps, new and remanufactured, by part number.' },
  Nozzle: { s: 'nozzles', l: 'Injector nozzles', d: 'Diesel injector nozzles for common rail and mechanical injectors, by part number.' },
  Rail: { s: 'rails', l: 'Common rails and lines', d: 'Common rails, pressure lines and rail parts for diesel engines.' },
  'Repair part': { s: 'repair-parts', l: 'Injector and pump repair parts', d: 'Control valves, shims, seals, repair kits and rebuild parts for diesel injectors and pumps.' },
  Tool: { s: 'tool-sets', l: 'Injector and pump tools', d: 'Robiel tool sets and bench tools for diesel injector and pump repair.' },
  Fluid: { s: 'fluids', l: 'Test bench fluids', d: 'Calibration fluid and degreasers for diesel test benches.' },
  Kit: { s: 'contamination-kits', l: 'Contamination kits', d: 'Fuel system contamination kits.' }
};

function load() {
  if (DB) return DB;
  const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8')).filter((r) => r[2] !== 'engine'); // engine parts are sold on volvoenginekits.com, not here
  const specs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'specs.json'), 'utf8'));
  const bySlug = {}, byCode = {}, cats = {}, makes = {}, engs = {}, oem = {};
  const clean = (sp) => {
    if (!sp) return null;
    sp = Object.assign({}, sp);
    sp.desc = String(sp.desc || '').replace(/<p>\s*Unleashed reference:[^<]*<\/p>/gi, '').replace(/for the Bench \/ shop use/g, 'for bench and shop use');
    sp.faq = String(sp.faq || '').replace(/A:\s*\.\s*/g, 'A: ');
    const t = String(sp.title || ''); const m = t.split(': ');
    if (m.length === 2 && m[0].toLowerCase().endsWith(m[1].toLowerCase())) sp.title = m[0];
    sp.engHub = String(sp.eng || '').replace(/^Bench \/ shop use( \/ )?/, '').trim();
    return sp;
  };
  rows.forEach((r) => {
    const sp = clean(specs[r[0]]);
    const p = { code: r[0], name: r[1], cat: r[3], brand: r[4] || '', sp, slug: slug(r[0]) };
    p.title = sp && sp.title ? sp.title : tidy(r[1]) + ' ' + r[0];
    const tok = (p.title.match(/^\S+\s+(\S+)/) || [])[1] || '';
    p.oem = sp && /\d/.test(tok) && tok.replace(/[^0-9a-z]/gi, '').length >= 5 ? tok.replace(/[:,]$/, '') : p.code;
    if (bySlug[p.slug] && bySlug[p.slug].sp && !sp) return;
    bySlug[p.slug] = p; byCode[p.code] = p;
    oem[slug(p.oem).replace(/-/g, '')] = oem[slug(p.oem).replace(/-/g, '')] || p.slug;
    (cats[r[3]] = cats[r[3]] || []).push(p);
    if (sp && sp.make && sp.make !== 'Rebuilder Supply') { const k = slug(sp.make); (makes[k] = makes[k] || { l: sp.make, items: [] }).items.push(p); }
    if (sp && sp.engHub) { const k = slug(sp.engHub); (engs[k] = engs[k] || { l: sp.engHub, make: sp.make, items: [] }).items.push(p); }
  });
  Object.values(cats).forEach((a) => a.sort((x, y) => (y.sp ? 1 : 0) - (x.sp ? 1 : 0) || x.code.localeCompare(y.code)));
  DB = { bySlug, byCode, cats, makes, engs, oem };
  return DB;
}

const noindexAll = () => process.env.PARTS_NOINDEX === '1';
// a part page is indexed only when it has reviewed copy worth reading: fitment and a real description (thin pages stay noindex, follow)
const GOOD_DESC = 300;
const goodPage = (p) => !!(p.sp && p.sp.fit && String(p.sp.desc || '').replace(/<[^>]+>/g, ' ').trim().length > GOOD_DESC);
// stock on hand and photos, read from the private store the crons keep (10 min memo); a failure means "unknown", never "in stock"
let LIVE = { at: 0, qty: null, items: null };
async function live() {
  if (LIVE.qty && Date.now() - LIVE.at < 10 * 60e3) return LIVE;
  const { readJson, cached } = require('../lib/store');
  const [st, prod] = await Promise.all([readJson('portal/stock.json').catch(() => null), cached('portal/products.json', 10 * 60e3).catch(() => null)]);
  LIVE = { at: Date.now(), qty: (st && st.qty) || null, items: (prod && prod.items) || null };
  return LIVE;
}
const UPDATED = '2026-11-14';
const ORG = {
  '@type': ['Organization', 'WholesaleStore'], '@id': SITE + '/#org', name: 'Maxzz Diesel', url: SITE + '/', logo: SITE + '/assets/favicon.svg', image: SITE + '/assets/mg/diesel-injectors-and-fuel-rails-test-bench.jpg',
  foundingDate: '1992', telephone: '+1-954-586-4158', email: 'sales@maxzzdiesel.com', areaServed: ['North America', 'Latin America'],
  address: { '@type': 'PostalAddress', streetAddress: '6601 Lyons Road, Ste H-6', addressLocality: 'Coconut Creek', addressRegion: 'FL', postalCode: '33073', addressCountry: 'US' },
  sameAs: ['https://www.linkedin.com/company/maxzzdiesel/', 'https://www.instagram.com/maxzzdiesel.us/', 'https://www.facebook.com/maxzzdiesel']
};
const WEBSITE = { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'Maxzz Diesel', publisher: { '@id': SITE + '/#org' }, inLanguage: 'en-US' };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:.\s]+$/, '') + '…'; };

function page({ title, desc, canon, body, ld, index = true, crumbs = [] }) {
  const robots = !index || noindexAll() ? 'noindex, follow' : 'index, follow, max-image-preview:large';
  const bc = crumbs.length ? { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) } : null;
  const graph = [ORG, WEBSITE].concat(ld || [], bc ? [bc] : []);
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots}">
${canon ? `<link rel="canonical" href="${SITE + canon}">` : ''}<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:site_name" content="Maxzz Diesel"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE + (canon || '/parts')}"><meta property="og:locale" content="en_US"><meta property="og:image" content="${SITE}/assets/mg/maxzz-diesel-og.jpg"><meta name="twitter:card" content="summary_large_image">
${graph.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="preload" href="/assets/fonts/BDOGrotesk-Regular.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/assets/fonts/BDOGrotesk-Medium.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'BDO Grotesk';src:url('/assets/fonts/BDOGrotesk-Regular.woff2') format('woff2');font-weight:400;font-display:swap}@font-face{font-family:'BDO Grotesk';src:url('/assets/fonts/BDOGrotesk-Medium.woff2') format('woff2');font-weight:500;font-display:swap}@font-face{font-family:'BDO Grotesk';src:url('/assets/fonts/BDOGrotesk-DemiBold.woff2') format('woff2');font-weight:600;font-display:swap}
*{box-sizing:border-box}body{margin:0;background:#eef0f2;color:#1d2126;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:#d32a37;text-decoration:none}a:hover{text-decoration:underline}
.h{background:#1d2126;color:#fff}.h-in{max-width:1240px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;gap:28px;flex-wrap:wrap}.h img{height:34px;display:block}.h nav{display:flex;gap:22px;flex-wrap:wrap;flex:1}.h nav a{color:#c9cdd2;font-size:15px}.h nav a:hover{color:#fff;text-decoration:none}
.btn{display:inline-flex;align-items:center;justify-content:center;height:46px;padding:0 22px;border-radius:50px;font-weight:500;font-size:15px;border:1px solid transparent;transition:transform .25s,background-color .2s}.btn:hover{text-decoration:none;transform:translateY(-1px)}.red{background:#d32a37;color:#fff}.red:hover{background:#b71f2b}.ghost{border-color:#c9ced3;color:#1d2126;background:#fff}.ghost:hover{border-color:#1d2126}.h .ghost{background:transparent;color:#fff;border-color:#4a525b}
.w{max-width:1240px;margin:0 auto;padding:28px 24px 64px}.crumb{font-size:13px;color:#6b7178;margin-bottom:14px}.crumb a{color:#6b7178}
h1{font-size:clamp(28px,4vw,42px);line-height:1.12;font-weight:500;letter-spacing:-.015em;margin:0 0 12px}h2{font-size:24px;font-weight:500;margin:0 0 14px}h3{font-size:18px;font-weight:500;margin:22px 0 8px}
.lead{font-size:18px;color:#3e444b;max-width:820px;margin:0 0 20px}.card{background:#fff;border-radius:12px;padding:28px;margin-top:16px}
.g2{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}.pn{display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;font-size:20px;background:#f4f5f6;border-radius:6px;padding:8px 12px;margin:4px 0 16px}
.tag{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#c25a12;font-weight:600}
.pp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:28px;align-items:center;background:#fff;border-radius:20px;padding:24px}.pp-ph{background:#f4f5f6;border-radius:14px;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;overflow:hidden}.pp-ph img{width:100%;height:100%;object-fit:contain;display:block}
.pp-no{display:flex;flex-direction:column;align-items:center;gap:6px;color:#8a9099;font-size:14px}.pp-no b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;color:#5f656c}.pp-in h1{font-size:clamp(24px,3vw,34px);margin:8px 0 12px}
.pp-pn{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}.pp-pn .pn{margin:0}.pp-oem{font-size:14px;color:#5f656c}.st{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500;color:#5f656c;background:#f4f5f6;border-radius:50px;padding:7px 14px}.st i{width:8px;height:8px;border-radius:50%;background:#9aa1ab}.st.ok{color:#1a7f3c;background:#e8f5ec}.st.ok i{background:#1f9d55}
.pp-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;margin:18px 0 0}.pp-k div{min-width:0}.pp-k dt{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8a9099;font-weight:600}.pp-k dd{margin:2px 0 0;font-size:15px;color:#1d2126}
.pp-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.btn.dk{background:#fff;color:#1d2126;border-color:#d3d7dc}.pp-note{font-size:13px;color:#6b7178;margin:12px 0 0}
@media (max-width:820px){.pp{grid-template-columns:1fr;padding:16px}.pp-k{grid-template-columns:1fr 1fr}}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:10px 8px;border-bottom:1px solid #eef0f2;text-align:left;vertical-align:top}th{font-weight:500;color:#5f656c;width:38%}
.list td:first-child{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;white-space:nowrap}
.cta{display:flex;flex-direction:column;gap:10px}.cta p{margin:0;color:#5f656c;font-size:14px}.ul{columns:2;gap:24px;padding-left:18px}.ul li{margin:0 0 4px;break-inside:avoid}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips a{background:#fff;border:1px solid #dfe2e6;border-radius:50px;padding:8px 14px;color:#1d2126;font-size:14px}.chips a:hover{border-color:#1d2126;text-decoration:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}.it{background:#fff;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:6px;color:#1d2126;transition:transform .3s,box-shadow .3s}.it:hover{transform:translateY(-3px);box-shadow:0 14px 30px rgba(29,33,38,.09);text-decoration:none}.it b{font-weight:500;line-height:1.3}.it code{font-size:12.5px;color:#d32a37;font-weight:600}
.faq details{border-bottom:1px solid #eef0f2;padding:12px 0}.faq summary{cursor:pointer;font-weight:500}.desc ul{padding-left:20px}
.pg{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.pg a,.pg b{min-width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:50px;background:#fff;color:#1d2126;font-weight:500}.pg b{background:#1d2126;color:#fff}
.f{background:#1d2126;color:#b9b9be;font-size:14px}.f-in{max-width:1240px;margin:0 auto;padding:32px 24px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}.f a{color:#e3e5e8}
@media (max-width:820px){.g2{grid-template-columns:1fr}.ul{columns:1}.card{padding:20px}.h nav{order:3;width:100%;gap:16px}}
</style></head><body>
<header class="h"><div class="h-in"><a href="/" aria-label="Maxzz Diesel home"><img src="/assets/logo-negative.svg" alt="Maxzz Diesel" width="150" height="34"></a>
<nav aria-label="Main"><a href="/injection-parts">Injection parts</a><a href="/parts">Parts catalog</a><a href="/aftertreatment">Aftertreatment</a><a href="/about">About</a></nav>
<span data-search-slot></span><a class="btn ghost" href="/portal">Wholesale login</a><a class="btn red" href="/portal">Request a quote</a></div></header>
<main class="w">${body}</main>
<footer class="f"><div class="f-in"><div><b style="color:#fff">Maxzz Diesel</b><br>6601 Lyons Road, Ste H-6, Coconut Creek, FL 33073<br>In-stock orders placed by 3 pm Eastern ship the same day.</div><div><a href="tel:+19545864158">+1 (954) 586-4158</a><br><a href="mailto:sales@maxzzdiesel.com">sales@maxzzdiesel.com</a><br><a href="/parts">Parts catalog</a> · <a href="/policies">Shipping and returns</a></div></div></footer>
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-T8J8922X"></script><script>window.dataLayer=window.dataLayer||[];dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});</script>
<script type="text/javascript" id="hs-script-loader" async defer src="https://js.hs-scripts.com/14488732.js"></script>
<script src="/js/sitesearch.js?v=2" defer></script>
</body></html>`;
}


function itemCard(p) {
  return `<a class="it" href="/parts/${p.slug}"><code>${esc(p.code)}</code><b>${esc(p.title)}</b>${p.sp && p.sp.fit ? `<span style="font-size:13px;color:#6b7178">${esc(p.sp.fit)}</span>` : ''}</a>`;
}

function partPage(p, db, lv) {
  const sp = p.sp || {};
  lv = lv || {};
  const qty = lv.qty ? Number(lv.qty[p.code]) || 0 : null, inStock = qty > 0;
  const hasPhoto = require('../lib/photo').has(p.code, lv.items), img = hasPhoto ? '/api/img?c=' + encodeURIComponent(p.code) + '&s=l' : '';
  const cat = CATS[p.cat] || { s: slug(p.cat), l: p.cat };
  const typ = sp.type || cat.l;
  const brand = p.brand && !String(p.oem).toLowerCase().startsWith(p.brand.toLowerCase()) ? p.brand : '';
  const lead = (String(sp.desc || '').match(/<p>(.*?)<\/p>/) || [])[1] || '';
  const desc = sp.desc ? clip(lead.replace(/<[^>]+>/g, '') + ' Wholesale from Coconut Creek, Florida.', 155)
    : clip(`${tidy(p.name)}, part number ${p.code}. Wholesale from Maxzz Diesel in Coconut Creek, Florida. Request a quote and we reply within one business day.`, 155);
  let short = [p.oem, brand, typ].filter(Boolean).join(' ');
  if (sp.engHub && (short + ', ' + sp.engHub).length <= 66) short += ', ' + sp.engHub;
  const facts = [['Part number', p.code], ['OEM number', p.oem !== p.code ? p.oem : ''], ['Type', typ], ['Brand', p.brand], ['Condition', sp.cond], ['Engine', sp.eng], ['Vehicles', sp.models], ['Years', sp.y0 && sp.y1 ? sp.y0 + '–' + sp.y1 : ''], ['Fitment', sp.fit]].filter((r) => r[1]);
  const xref = String(sp.eq || sp.inj || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  const faqs = String(sp.faq || '').split(/\n?Q:\s*/).filter(Boolean).map((b) => { const m = b.split(/\n?A:\s*/); return [m[0].trim(), (m[1] || '').trim()]; }).filter((f) => f[0] && f[1].length > 8);
  const rel = String(sp.rel || '').split(',').map((x) => db.byCode[x.trim()]).filter(Boolean).slice(0, 8);
  const more = (db.cats[p.cat] || []).filter((x) => x !== p && x.sp && (!sp.make || x.sp.make === sp.make)).slice(0, 8);
  const engKey = sp.engHub ? slug(sp.engHub) : '', makeKey = sp.make && sp.make !== 'Rebuilder Supply' ? slug(sp.make) : '';
  const digits = String(p.oem).replace(/[^0-9a-z]/gi, '');
  const spaced = /^\d{10}$/.test(digits) ? digits.replace(/^(\d)(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : '';
  const codeDigits = String(p.code).replace(/[^0-9a-z]/gi, ''), codeBare = codeDigits.replace(/^[a-z]{2,4}(?=\d)/i, '');
  const aka = [...new Set([p.oem, digits, spaced, p.code, codeDigits, codeBare.length >= 5 ? codeBare : ''].filter(Boolean))];
  const ship = inStock ? 'Maxzz Diesel has it in stock in Coconut Creek, Florida, and orders placed by 3 pm Eastern ship the same day.' : 'Maxzz Diesel supplies it from Coconut Creek, Florida. Ask for a quote and we confirm stock and lead time within one business day.';
  const answer = (sp.fit ? `${p.oem} is a ${String(sp.cond || 'new').toLowerCase()} ${p.brand ? p.brand + ' ' : ''}${typ.toLowerCase()} for ${sp.fit}. ` : `${p.oem} is a ${p.brand ? p.brand + ' ' : ''}${typ.toLowerCase()}. `) + ship;
  const crumbs = [['Home', '/'], ['Parts catalog', '/parts'], [cat.l, '/parts/c/' + cat.s], [p.code, '/parts/' + p.slug]];
  const product = { '@type': 'Product', '@id': SITE + '/parts/' + p.slug + '#product', name: p.title, sku: p.code, mpn: p.oem, description: desc, category: typ, url: SITE + '/parts/' + p.slug };
  if (aka.length > 1) product.alternateName = aka.filter((x) => x !== p.title);
  if (p.brand) { product.brand = { '@type': 'Brand', name: p.brand }; product.manufacturer = { '@type': 'Organization', name: p.brand }; }
  if (sp.cond) product.itemCondition = /reman/i.test(sp.cond) ? 'https://schema.org/RefurbishedCondition' : 'https://schema.org/NewCondition';
  const props = [sp.eng && { '@type': 'PropertyValue', name: 'Engine', value: sp.eng }, sp.y0 && { '@type': 'PropertyValue', name: 'Years', value: sp.y0 + '–' + sp.y1 }, sp.models && { '@type': 'PropertyValue', name: 'Vehicles', value: sp.models }].filter(Boolean);
  if (props.length) product.additionalProperty = props;
  if (img) product.image = SITE + img;
  if (rel.length) product.isRelatedTo = rel.map((r) => ({ '@id': SITE + '/parts/' + r.slug + '#product' }));
  const ld = [product];
  if (faqs.length) ld.push({ '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) });
  const keyf = [['Engine', sp.eng], ['Vehicles', sp.models], ['Years', sp.y0 && sp.y1 ? sp.y0 + '–' + sp.y1 : ''], ['Condition', sp.cond], ['Brand', p.brand]].filter((r) => r[1]).slice(0, 4);
  const stockLine = inStock ? '<span class="st ok"><i></i>In stock in Florida · ships the same day if ordered by 3 pm ET</span>'
    : qty === 0 ? '<span class="st"><i></i>Available to order · we confirm the lead time within one business day</span>'
    : '<span class="st"><i></i>Ask for stock and lead time · we reply within one business day</span>';
  const body = `<div class="crumb">${crumbs.slice(0, -1).map((c) => `<a href="${c[1]}">${esc(c[0])}</a>`).join(' / ')} / ${esc(p.code)}</div>
<div class="pp">
<div class="pp-ph">${img ? `<img src="${img}" alt="${esc(p.title)}" width="640" height="480" fetchpriority="high">` : `<div class="pp-no"><b>${esc(p.oem)}</b><span>${esc(typ)}</span></div>`}</div>
<div class="pp-in">
<span class="tag"><a href="/parts/c/${cat.s}" style="color:inherit">${esc(cat.l)}</a>${p.brand ? ' · ' + esc(p.brand) : ''}</span>
<h1>${esc(p.title)}</h1>
<div class="pp-pn"><span class="pn">${esc(p.code)}</span>${p.oem !== p.code ? `<span class="pp-oem">OEM ${esc(p.oem)}</span>` : ''}</div>
${stockLine}
${keyf.length ? `<dl class="pp-k">${keyf.map((f) => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>` : ''}
<div class="pp-cta"><a class="btn red" href="/portal?add=${encodeURIComponent(p.code)}">Add to a quote request</a><a class="btn ghost dk" href="/portal#/p/${encodeURIComponent(p.code)}">See price in the wholesale store</a></div>
<p class="pp-note">Wholesale prices and live stock for approved repair shops, injection labs, distributors and fleets. Questions? <a href="tel:+19545864158">+1 (954) 586-4158</a> · <a href="mailto:sales@maxzzdiesel.com">sales@maxzzdiesel.com</a></p>
</div></div>
<p class="lead" style="font-size:17px;margin-top:28px">${esc(answer)}</p>
<p style="font-size:14px;color:#5f656c;margin:-8px 0 16px">Also listed as: ${aka.map(esc).join(' · ')}</p>
<div class="g2"><div>
${sp.desc ? `<div class="card desc" style="margin-top:0">${sp.desc}</div>` : `<div class="card" style="margin-top:0"><p style="margin:0">${esc(tidy(p.name))}. Part number ${esc(p.code)}. Ask our team to confirm fitment with your current part number or VIN.</p></div>`}
${xref.length ? `<div class="card"><h2>Cross references</h2><ul class="ul">${xref.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
${faqs.length ? `<div class="card faq"><h2>Questions about ${esc(p.oem)}</h2>${faqs.map((f) => `<details><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join('')}</div>` : ''}
</div><aside><div class="card" style="margin-top:0"><h2>Specifications</h2><table>${facts.map((f) => `<tr><th>${f[0]}</th><td>${esc(f[1])}</td></tr>`).join('')}</table></div>
<div class="chips" style="margin-top:14px"><a href="/parts/c/${cat.s}">All ${esc(cat.l.toLowerCase())}</a>${makeKey ? `<a href="/parts/v/${makeKey}">${esc(sp.make)} parts</a>` : ''}${engKey && db.engs[engKey] && db.engs[engKey].items.length >= 3 ? `<a href="/parts/e/${engKey}">${esc(sp.engHub)}</a>` : ''}</div>
</aside></div>
${rel.length ? `<h2 style="margin-top:36px">Often needed with this part</h2><div class="grid">${rel.map(itemCard).join('')}</div>` : ''}
${more.length ? `<h2 style="margin-top:36px">More ${esc(cat.l.toLowerCase())}</h2><div class="grid">${more.map(itemCard).join('')}</div>` : ''}`;
  return page({ title: short + ' | Maxzz Diesel', desc, canon: '/parts/' + p.slug, body, ld, index: goodPage(p), crumbs });
}

const PER = 300;
function listPage({ title, h1, lead, canon, items, crumbs, pageNo, index = true }) {
  const pages = Math.max(1, Math.ceil(items.length / PER)); const n = pageNo || 1;
  if (n > pages) return null;
  const slice = items.slice((n - 1) * PER, n * PER);
  const top = slice.filter((p) => p.sp).slice(0, 24);
  const body = `<div class="crumb">${crumbs.slice(0, -1).map((c) => `<a href="${c[1]}">${esc(c[0])}</a>`).join(' / ')} / ${esc(crumbs[crumbs.length - 1][0])}</div>
<h1>${esc(h1)}</h1><p class="lead">${esc(lead)}</p>
<p><a class="btn red" href="/portal">Request a quote</a> <a class="btn ghost" href="/portal">Wholesale login</a></p>
${top.length && n === 1 ? `<h2 style="margin-top:28px">Popular part numbers</h2><div class="grid">${top.map(itemCard).join('')}</div>` : ''}
<div class="card"><h2>${items.length} part numbers${pages > 1 ? `, page ${n} of ${pages}` : ''}</h2><table class="list"><thead><tr><th style="width:auto">Part number</th><th style="width:auto">Description</th><th style="width:auto"></th></tr></thead><tbody>
${slice.map((p) => p.sp ? `<tr><td><a href="/parts/${p.slug}">${esc(p.code)}</a></td><td>${esc(p.title)}</td><td></td></tr>` : `<tr><td>${esc(p.code)}</td><td>${esc(tidy(p.name))}</td><td><a href="/portal?add=${encodeURIComponent(p.code)}" rel="nofollow">Quote</a></td></tr>`).join('')}
</tbody></table>${pages > 1 ? `<div class="pg">${Array.from({ length: pages }, (_, i) => i + 1).map((i) => i === n ? `<b>${i}</b>` : `<a href="${canon}${i > 1 ? '?page=' + i : ''}">${i}</a>`).join('')}</div>` : ''}</div>`;
  const ld = [{ '@type': 'CollectionPage', name: h1, url: SITE + canon + (n > 1 ? '?page=' + n : ''), isPartOf: { '@id': SITE + '/#website' } }];
  if (top.length) ld.push({ '@type': 'ItemList', itemListElement: top.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + '/parts/' + p.slug, name: p.title })) });
  return page({ title: (n > 1 ? `${title}, page ${n}` : title) + ' | Maxzz Diesel', desc: clip(lead, 155), canon: canon + (n > 1 ? '?page=' + n : ''), body, ld, crumbs, index });
}

const bigEngs = (db) => Object.entries(db.engs).filter(([, e]) => e.items.length >= 3);
function hubPage(db) {
  const makes = Object.entries(db.makes).sort((a, b) => b[1].items.length - a[1].items.length);
  const engs = bigEngs(db).sort((a, b) => a[1].l.localeCompare(b[1].l));
  const catList = Object.entries(CATS).filter(([k]) => db.cats[k]);
  const body = `<div class="crumb"><a href="/">Home</a> / Parts catalog</div>
<h1>Diesel injection parts catalog</h1>
<p class="lead">Fuel injectors, high-pressure pumps, nozzles, control valves, repair kits and tools, stocked in Coconut Creek, Florida, since 1992. Search by part number, vehicle or engine, then request a quote. We reply within one business day.</p>
<p><a class="btn red" href="/portal">Request a quote</a> <a class="btn ghost" href="/portal">Wholesale login</a></p>
<h2 style="margin-top:32px">By category</h2><div class="grid">${catList.map(([k, c]) => `<a class="it" href="/parts/c/${c.s}"><b>${esc(c.l)}</b><span style="font-size:14px;color:#6b7178">${db.cats[k].length} part numbers</span></a>`).join('')}</div>
<h2 style="margin-top:32px">By vehicle</h2><div class="chips">${makes.map(([k, m]) => `<a href="/parts/v/${k}">${esc(m.l)} (${m.items.length})</a>`).join('')}</div>
<h2 style="margin-top:32px">By engine</h2><div class="chips">${engs.map(([k, e]) => `<a href="/parts/e/${k}">${esc(e.l)}</a>`).join('')}</div>`;
  const ld = [{ '@type': 'CollectionPage', name: 'Diesel injection parts catalog', url: SITE + '/parts', isPartOf: { '@id': SITE + '/#website' } },
    { '@type': 'ItemList', itemListElement: catList.map(([, c], i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + '/parts/c/' + c.s, name: c.l })) }];
  return page({ title: 'Diesel Injection Parts Catalog by Part Number | Maxzz Diesel', desc: 'Diesel fuel injectors, pumps, nozzles, valves, repair kits and tools by part number, vehicle and engine. Wholesale from Coconut Creek, Florida, since 1992.', canon: '/parts', body, ld, crumbs: [['Home', '/'], ['Parts catalog', '/parts']] });
}

// a copy of the index without the products an admin hid
function visible(d, hid) {
  const keep = (arr) => arr.filter((p) => !hid.has(p.code));
  const out = Object.assign({}, d, { bySlug: {}, byCode: {}, cats: {}, makes: {}, engs: {} });
  Object.entries(d.bySlug).forEach(([k, p]) => { if (!hid.has(p.code)) out.bySlug[k] = p; });
  Object.entries(d.byCode).forEach(([k, p]) => { if (!hid.has(p.code)) out.byCode[k] = p; });
  Object.entries(d.cats).forEach(([k, a]) => { const v = keep(a); if (v.length) out.cats[k] = v; });
  Object.entries(d.makes).forEach(([k, m]) => { const v = keep(m.items); if (v.length) out.makes[k] = Object.assign({}, m, { items: v }); });
  Object.entries(d.engs).forEach(([k, e]) => { const v = keep(e.items); if (v.length) out.engs[k] = Object.assign({}, e, { items: v }); });
  return out;
}
function sitemap(db) {
  const urls = ['/parts'];
  Object.entries(CATS).forEach(([k, c]) => { if (db.cats[k]) { const n = Math.ceil(db.cats[k].length / PER); for (let i = 1; i <= n; i++) urls.push('/parts/c/' + c.s + (i > 1 ? '?page=' + i : '')); } });
  Object.keys(db.makes).forEach((k) => urls.push('/parts/v/' + k));
  bigEngs(db).forEach(([k]) => urls.push('/parts/e/' + k));
  Object.values(db.bySlug).forEach((p) => { if (goodPage(p)) urls.push('/parts/' + p.slug); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => `  <url><loc>${SITE}${esc(u)}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n') + '\n</urlset>\n';
}

function redirect(res, to) { res.statusCode = 301; res.setHeader('Location', to); res.setHeader('Cache-Control', 'public, s-maxage=86400'); res.end(); }

module.exports = async (req, res) => {
  try {
    const hid = await require('../lib/hidden').hiddenSet();
    const db = hid.size ? visible(load(), hid) : load();
    const u = new URL(req.url, 'http://x');
    const kind = u.searchParams.get('k') || '';
    const raw = u.searchParams.get('id') || '';
    const id = slug(raw);
    const pq = u.searchParams.get('page');
    const pageNo = pq == null ? 1 : parseInt(pq, 10);
    const base = { c: '/parts/c/', v: '/parts/v/', e: '/parts/e/', p: '/parts/' }[kind];
    if (base && raw && raw !== id && id) return redirect(res, base + id + (pq && pageNo > 1 ? '?page=' + pageNo : ''));
    if (pq != null && (pageNo === 1 || !(pageNo > 1))) return redirect(res, (base || '/parts') + (base ? id : ''));
    let html = null;
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    if (kind === 'sitemap') {
      if (noindexAll()) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'application/xml; charset=utf-8'); return res.end(sitemap(db));
    }
    if (!kind) html = hubPage(db);
    else if (kind === 'c') {
      const e = Object.entries(CATS).find(([, c]) => c.s === id);
      if (e && db.cats[e[0]]) html = listPage({ title: e[1].l, h1: e[1].l, lead: e[1].d + ' Wholesale from Coconut Creek, Florida. Request a quote and we reply within one business day.', canon: '/parts/c/' + id, items: db.cats[e[0]], crumbs: [['Home', '/'], ['Parts catalog', '/parts'], [e[1].l, '/parts/c/' + id]], pageNo });
    } else if (kind === 'v' && db.makes[id]) {
      const m = db.makes[id];
      html = listPage({ title: `${m.l} Diesel Injection Parts`, h1: `${m.l} diesel injection parts`, lead: `Fuel injectors, pumps, nozzles, valves and repair parts for ${m.l} diesel engines, by part number. Wholesale from Coconut Creek, Florida.`, canon: '/parts/v/' + id, items: m.items, crumbs: [['Home', '/'], ['Parts catalog', '/parts'], [m.l, '/parts/v/' + id]], pageNo });
    } else if (kind === 'e' && db.engs[id]) {
      const e = db.engs[id];
      html = listPage({ title: `${e.l} Injectors, Pumps and Parts`, h1: `${e.l} injection parts`, lead: `Fuel injectors, pumps and rebuild parts for the ${e.l}, by part number. Match your current part number or send us your VIN and we confirm fitment.`, canon: '/parts/e/' + id, items: e.items, crumbs: [['Home', '/'], ['Parts catalog', '/parts'], [e.l, '/parts/e/' + id]], pageNo, index: e.items.length >= 3 });
    } else if (kind === 'p') {
      if (db.bySlug[id]) { const lv = await live().catch(() => ({})); res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400'); html = partPage(db.bySlug[id], db, lv); }
      else { const o = db.oem[id.replace(/-/g, '')]; if (o) return redirect(res, '/parts/' + o); }
    }
    if (!html) {
      res.statusCode = 404; res.setHeader('Cache-Control', 'public, s-maxage=600');
      html = page({ title: 'Part not found | Maxzz Diesel', desc: 'Part not found.', canon: '', index: false, body: '<h1>We could not find that part</h1><p class="lead">Search the catalog or send us the part number and we look it up for you.</p><p><a class="btn red" href="/parts">Parts catalog</a> <a class="btn ghost" href="/portal">Request a quote</a></p>' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    console.error('parts', e.message);
    res.statusCode = 500; res.end('Error');
  }
};
