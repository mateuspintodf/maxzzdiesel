#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Builds the SEO / AEO pages and patches the shared navigation. Idempotent: run again after any edit.

  python3 tools/pages_build.py

Writes: systems/*.html (6 hubs), training.html, resources.html, resources/*.html (4 guides)
Patches: nav and footer of every English page, home (testimonials, finder shortcut, system links),
         injection-parts (finder, chip links), quote (bulk paste), sitemap.xml, llms.txt.
The shell (head, header, footer, scripts) is taken from partners.html so the new pages look like the rest of the site.
Part numbers come from data/fitment.json, data/specs.json and data/catalog.json; nothing is typed by hand."""
import html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seo_build as SB
import site_content as C

SITE = SB.SITE
E = html.escape
GUIDES_LIVE = True       # guides stay noindex and out of the sitemap until they are reviewed by Waldyr and Arthur
REVIEWED = True          # flips the byline from "review pending" to "reviewed by"
TODAY = '2026-11-16'

CAT = json.load(open(ROOT / 'data/catalog.json', encoding='utf-8'))
SPECS = json.load(open(ROOT / 'data/specs.json', encoding='utf-8'))
FIT = json.load(open(ROOT / 'data/fitment.json', encoding='utf-8'))
ROW = {r[0]: r for r in CAT}
PHOTOS = json.load(open(ROOT / 'data/photos.json', encoding='utf-8'))
PH_BY = {v['code']: (k, v['ext']) for k, v in PHOTOS.items()}
# compact code -> photo path map for the quote page thumbnails (cross-sell)
json.dump({c: f'{k}.{e}' for c, (k, e) in PH_BY.items()}, open(ROOT / 'data/thumbs.json', 'w', encoding='utf-8'), separators=(',', ':'))
COURSE_PH = {'bosch-crin': 'BO.0.445.124.047', 'denso-g2s': 'DN.095000-5550', 'continental-vdo': 'SM.JB3Q-9K546-AB',
             'bosch-crin-2-3': 'BO.0.445.120.384', 'cat-c7-c9': 'DE.EX634763', 'cat-c15': 'CAT.10R8502R',
             'bosch-crin-4-2': 'RB.323.50.40', 'cummins-isx15-xpi': 'CM.2894920', 'denso-g4s': 'DN.295700-0630', 'bosch-piezo': 'BO.0.445.117.043'}
GUIDE_PH = {'detroit-dd15': 'DAP.F.00V.X50.083', 'cummins-isx15': 'CM.2894920', 'bosch-piezo': 'BO.0.445.117.043', 'cp4-pump': 'BO.0.445.010.859'}
TINTS = ['#f1f2f4', '#fde9eb', '#fff1e4', '#e9eafb', '#eaf3ee', '#f4efe6']


def photo(code):
    v = PH_BY.get(code)
    return f'/img/p/{v[0]}.{v[1]}' if v else None


def media(code, alt, tint='#f1f2f4', h=210, cap=''):
    u = photo(code)
    if not u:
        return ''
    c = f'<span style="position:absolute;left:14px;bottom:12px;background:#fff;border-radius:50px;padding:4px 12px;font-size:12px;font-weight:600;color:#1d2126">{E(cap)}</span>' if cap else ''
    return (f'<div style="position:relative;background:{tint};border-radius:20px;height:{h}px;margin:-6px -6px 22px;display:flex;align-items:center;justify-content:center;overflow:hidden">'
            f'<img src="{u}" alt="{E(alt)}" width="400" height="300" loading="lazy" decoding="async" style="max-height:88%;max-width:88%;object-fit:contain">{c}</div>')
FONT = "'BDO Grotesk', 'Helvetica Neue', Arial, sans-serif"
ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>'
CAT_ORDER = ['Injectors', 'Nozzles', 'Control valves', 'Solenoids', 'Injector components', 'Pumps', 'Pump repair kits', 'Pump components',
             'Repair kits', 'Rails and lines', 'Kits', 'Seals and O-rings', 'Shims', 'Sensors and regulators', 'Engine parts']


def slug(s):
    s = re.sub(r'[̀-ͯ]', '', __import__('unicodedata').normalize('NFKD', str(s or '')).lower().replace('&', ' and '))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def tidy(s):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    s = re.sub(r'\s*/\s*(Application|Suitable for|Suitable)\s*:?\s*', ': ', s, flags=re.I)
    return s


def oem(code):
    sp = SPECS.get(code) or {}
    for tok in str(sp.get('title', '')).split():
        t = tok.strip(':,')
        if re.search(r'\d', t) and len(re.sub(r'[^0-9a-z]', '', t, flags=re.I)) >= 4 and not re.match(r'^(ISX|ISL|ISB|QSX|DD|CP|L5P|C)\d*[A-Z]?\d*$', t, re.I):
            return t
    return code.split('.', 1)[-1] if '.' in code else code


def title_of(code):
    sp = SPECS.get(code) or {}
    t = sp.get('title')
    if t:
        t = t.replace('–', ' to ')
        m = t.split(': ')
        if len(m) == 2 and m[0].lower().endswith(m[1].lower()):
            t = m[0]
        return t
    r = ROW.get(code)
    return tidy(r[1]) if r else code


def short_desc(code):
    t = title_of(code)
    t = re.sub(r'^[A-Za-z][A-Za-z .&-]*?\s' + re.escape(oem(code)) + r'\s*:?\s*', '', t, count=1) or t
    return t


def brand_of(code):
    r = ROW.get(code)
    sp = SPECS.get(code) or {}
    if r and r[4]:
        return r[4]
    t = str(sp.get('title', ''))
    return t.split(' ')[0] if t else ''


def btn_add(code, label='Add to quote list', cls='sx-add'):
    return (f'<button type="button" class="{cls}" data-add="{E(code)}" data-name="{E(title_of(code))}" data-pn="{E(code)}" '
            f'data-cat="{E((FIT["items"].get(code) or [0, ""])[1] or (ROW.get(code) or [0]*4)[3])}" data-slug="{E(slug(code))}">{E(label)}</button>')


def btn_custom(cid, name, pn='Part number to confirm', label='Add to quote list', cls='sx-add'):
    return f'<button type="button" class="{cls}" data-add="{E(cid)}" data-name="{E(name)}" data-pn="{E(pn)}" data-cat="Other" data-slug="other">{E(label)}</button>'


# ------------------------------------------------------------------ shell
PARTNERS = (ROOT / 'partners.html').read_text(encoding='utf-8')
_i = PARTNERS.index('<main>')
_j = PARTNERS.index('</main>')
PRE, MID, POST = PARTNERS[:_i], PARTNERS[_i + 6:_j], PARTNERS[_j:]
MODAL = MID[:MID.index('<section style="position: relative; box-sizing: border-box;">')]

CSS = """<style>
.sx{font-family:%(f)s;color:#5a5a60}
.sx a{color:#d32a37}.sx a:hover{color:#a81f2b}
.sx-wrap{max-width:1320px;margin:0 auto}
.sx-pill{display:inline-block;border:1px solid rgba(29,33,38,.2);color:#d32a37;border-radius:50px;padding:0 14px;font-weight:600;font-size:12px;line-height:25px;letter-spacing:.6px;text-transform:uppercase}
.sx-pill.dk{border-color:rgba(255,255,255,.25);color:#fc771d}
.sx-h2{margin:18px 0 0;font-weight:600;color:#1d2126;font-size:clamp(28px,3vw,42px);line-height:1.12;letter-spacing:-.02em}
.sx-h3{margin:0;font-weight:600;color:#1d2126;font-size:21px;line-height:1.25}
.sx-card{background:#fff;border-radius:26px;padding:30px;box-sizing:border-box}
.sx-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.sx-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.sx-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.sx-tw{background:#fff;border-radius:26px;padding:8px 8px 14px;overflow-x:auto}
.sx-t{width:100%%;border-collapse:collapse;font-size:14px;line-height:1.45;min-width:760px}
.sx-t th{text-align:left;font-weight:600;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#8a9099;padding:14px 14px 10px;border-bottom:1px solid #e3e6e9}
.sx-t td{padding:12px 14px;border-bottom:1px solid #f0f2f4;vertical-align:top;color:#3a3f45}
.sx-t td:first-child{white-space:nowrap;font-weight:600;color:#1d2126}
.sx-t tr:last-child td{border-bottom:0}
.sx-t .gr td{background:#f7f8f9;font-weight:600;color:#1d2126;font-size:12px;letter-spacing:.6px;text-transform:uppercase}
.sx-add,.sx-btn{font-family:%(f)s;cursor:pointer;border:0;border-radius:50px;font-weight:500;font-size:13px;line-height:1;white-space:nowrap;transition:background-color .25s,color .25s}
.sx-add{background:#1d2126;color:#fff;padding:10px 16px}.sx-add:hover{background:#d32a37}.sx-add.ok{background:#1f7a4d}
.sx-btn{display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 22px;font-size:14px;text-decoration:none}
.sx-btn.red{background:#d32a37;color:#fff !important}.sx-btn.red:hover{background:#fc771d}
.sx-btn.dk{background:#1d2126;color:#fff !important}.sx-btn.dk:hover{background:#d32a37}
.sx-btn.ol{background:transparent;color:#1d2126 !important;border:1px solid #1d2126}.sx-btn.ol:hover{background:#1d2126;color:#fff !important}
.sx-btn.wh{background:#fff;color:#1d2126 !important}.sx-btn.wh:hover{background:#fc771d;color:#fff !important}
.sx-btn.gh{border:1px solid rgba(255,255,255,.6);color:#fff !important}.sx-btn.gh:hover{background:#fff;color:#1d2126 !important}
.sx-faq details{background:#fff;border-radius:20px;padding:0 26px;margin-bottom:10px}
.sx-faq summary{cursor:pointer;list-style:none;padding:24px 0;font-weight:600;font-size:18px;color:#1d2126;display:flex;justify-content:space-between;gap:16px}
.sx-faq summary::-webkit-details-marker{display:none}
.sx-faq summary:after{content:"+";color:#d32a37;font-size:24px;line-height:1}
.sx-faq details[open] summary:after{content:"\\2212"}
.sx-faq details[open] summary{padding-bottom:12px}
.sx .sx-faq details > p{margin:0 !important;padding:0 40px 28px 0;font-size:16px;line-height:1.7}
.sx-tag{display:inline-block;border:1px solid #dfe3e7;border-radius:50px;padding:3px 14px;font-size:13px;color:#1d2126 !important;background:#fff}
.sx-tag:hover{border-color:#d32a37}
.sx-ans{background:#1d2126;color:#fff;border-radius:26px;padding:0 0 0 38px;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:32px;align-items:stretch;overflow:hidden}.sx-ans>div:first-child{padding:34px 0;align-self:center}
.sx-ans .ph{background:#e9eaec;border-radius:0;min-height:220px;position:relative;overflow:hidden}
.sx-ans .ph img{position:absolute;inset:0;width:100%%;height:100%%;object-fit:cover;object-position:center}
.sx-ans.nophoto{grid-template-columns:1fr;padding:34px 38px}.sx-ans.nophoto>div:first-child{padding:0}@media (max-width:760px){.sx-ans{grid-template-columns:1fr;padding:0;gap:0}.sx-ans>div:first-child{padding:28px 22px}.sx-ans .ph{min-height:200px;order:2}}
.sx-bene{display:flex;flex-wrap:wrap;gap:12px 34px;margin-top:30px;color:#fff;font-size:15px}
.sx-bene span{display:inline-flex;align-items:center;gap:10px}
.sx-bene svg{color:#fc771d;flex:none}
.sx-ans b{display:block;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#fc771d;margin-bottom:10px}
.sx-ans p{margin:0;font-size:18px;line-height:1.6;color:#fff}
.sx-art h2{margin:44px 0 0;font-weight:600;color:#1d2126;font-size:clamp(24px,2.4vw,32px);line-height:1.15;letter-spacing:-.02em}
.sx-art p{margin:16px 0 0;font-size:17px;line-height:1.75}
.sx-art .sx-tw{margin-top:20px}
.sx-aside{position:sticky;top:130px;display:flex;flex-direction:column;gap:14px}
.sx-mini{background:#fff;border-radius:22px;padding:22px}
.sx-mini b{display:block;color:#1d2126;font-size:16px;margin-bottom:6px}
.sx-mini p{margin:0 0 14px;font-size:14px;line-height:1.5}
.sx-draft{background:#fff4e5;border:1px solid #f3c58a;border-radius:16px;padding:14px 18px;font-size:14px;color:#6b4200;margin-top:18px}
@media (max-width:980px){.sx-grid3,.sx-grid4{grid-template-columns:repeat(2,minmax(0,1fr))}.sx-art-grid{grid-template-columns:1fr !important}.sx-aside{position:static}}
@media (max-width:760px){.sx-ans{grid-template-columns:1fr}.sx-ans .ph{height:150px}}
@media (max-width:640px){.sx-grid3,.sx-grid2,.sx-grid4{grid-template-columns:minmax(0,1fr)}.sx-card{padding:24px 20px;min-width:0}.sx-card *{max-width:100%%}.sx button,.sx .btn{min-height:44px}}@media (max-width:760px){body{padding-bottom:88px}}
</style>""" % {'f': FONT}

ADD_JS = """<script>(function(){var QK='mx-quote';function rd(){try{var v=JSON.parse(localStorage.getItem(QK)||'[]');return Array.isArray(v)?v:[]}catch(e){return[]}}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-add]');if(!b)return;e.preventDefault();
var id=b.getAttribute('data-add'),ls=rd(),i=-1;for(var k=0;k<ls.length;k++){if(ls[k].id===id){i=k;break}}
if(i>=0){ls[i].qty=(ls[i].qty||1)+1}else{ls.push({id:id,name:b.getAttribute('data-name')||id,pn:b.getAttribute('data-pn')||id,app:b.getAttribute('data-cat')||'',cat:b.getAttribute('data-cat')||'',slug:b.getAttribute('data-slug')||'other',img:'',pos:'',qty:1})}
try{localStorage.setItem(QK,JSON.stringify(ls))}catch(x){}
try{window.dispatchEvent(new StorageEvent('storage',{key:QK}))}catch(x){}
var t=b.getAttribute('data-l')||b.textContent;b.setAttribute('data-l',t);b.textContent='Added to your list';b.classList.add('ok');
setTimeout(function(){b.textContent=t;b.classList.remove('ok')},1800)});})();</script>"""


def img(name, alt='', cls='', style='', lazy=True, w=1200, h=900):
    base = f'/assets/mg/{name}'
    stem = name.rsplit('.', 1)[0]
    ss = f'/assets/mg/{stem}-480w.webp 480w, /assets/mg/{stem}-800w.webp 800w, {base} {w}w'
    return (f'<img width="{w}" height="{h}" {"loading=\"lazy\" decoding=\"async\" " if lazy else "fetchpriority=\"high\" "}src="{base}" srcset="{ss}" '
            f'sizes="(max-width: 760px) 100vw, 1200px" alt="{E(alt)}" class="{cls}" style="{style}">')


def head_for(path, title, desc, og_img, graph, noindex=False):
    url = SITE + path
    short = title.split(' | ')[0]
    parts = [f'<link rel="canonical" href="{url}">', f'<meta property="og:url" content="{url}">',
             '<meta property="og:site_name" content="Maxzz Diesel"><meta property="og:locale" content="en_US">',
             f'<meta property="og:image" content="{SITE}/assets/mg/{og_img}.jpg">',
             f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{E(short)}">',
             f'<meta name="twitter:description" content="{E(desc)}"><meta name="twitter:image" content="{SITE}/assets/mg/{og_img}.jpg">',
             '<link rel="preload" href="/assets/fonts/BDOGrotesk-Regular.woff2" as="font" type="font/woff2" crossorigin>',
             '<link rel="preload" href="/assets/fonts/BDOGrotesk-Medium.woff2" as="font" type="font/woff2" crossorigin>']
    if noindex:
        parts.append('<meta name="robots" content="noindex,follow">')
    g = [SB.ORG_NODE, SB.WEBSITE] + graph
    parts.append('<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@graph': g}, ensure_ascii=False) + '</script>')
    return SB.HEAD_START + ''.join(parts) + SB.HEAD_END


def webpage(path, title, desc, crumbs, kind='WebPage', extra=None):
    url = SITE + path
    n = {'@type': kind, '@id': url + '#webpage', 'url': url, 'name': title, 'description': desc, 'inLanguage': 'en-US',
         'isPartOf': {'@id': SITE + '/#website'}, 'publisher': {'@id': SITE + '/#org'}}
    n.update(extra or {})
    bc = {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': a, 'item': SITE + b} for i, (a, b) in enumerate(crumbs)]}
    n['breadcrumb'] = {'@id': url + '#breadcrumb'}
    return [n, bc]


def faq_ld(path, faq):
    return {'@type': 'FAQPage', '@id': SITE + path + '#faq', 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]}


def course_ld(c, url, price='297'):
    d = {'@type': 'Course', '@id': url + '#course-' + c['slug'], 'name': c['name'] + ' (Diesel Tech Academy)',
         'description': c['sub'] + '. Online course by the Diesel Tech Academy with lifetime access and a 7-day guarantee.',
         'provider': {'@type': 'EducationalOrganization', 'name': 'Diesel Tech Academy', 'sameAs': 'https://www.dieseltechacademy.com/'},
         'offers': {'@type': 'Offer', 'price': price, 'priceCurrency': 'USD', 'category': 'Paid',
                    'url': C.utm('maxzzdiesel_ld'), 'availability': 'https://schema.org/InStock'},
         'inLanguage': 'en', 'educationalLevel': 'Professional',
         'hasCourseInstance': {'@type': 'CourseInstance', 'courseMode': 'online', 'courseWorkload': 'Self-paced, lifetime access'}}
    if c.get('who'):
        d['hasCourseInstance']['instructor'] = {'@type': 'Person', 'name': c['who']}
    return d


def lang_strip(pre, path):
    pre = re.sub(r'<a class="lang-opt"[^>]*>[^<]*</a>\s*', '', pre)
    pre = pre.replace('<a href="/partners" hreflang="en"', f'<a href="{path}" hreflang="en"')
    pre = re.sub(r'<div class="mn-lang">.*?</div>', f'<div class="mn-lang"><a href="{path}" hreflang="en" lang="en" aria-current="true" style="color: #fc771d;">English</a></div>', pre, flags=re.S)
    return pre


def page_shell(path, title, desc, og_img, graph, body, noindex=False, page_id='Page'):
    pre = PRE
    pre = re.sub(r'<title>.*?</title>', '<title>' + E(title) + '</title>', pre, count=1, flags=re.S)
    pre = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="' + E(desc) + '">', pre, count=1)
    pre = re.sub(r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="' + E(title.split(' | ')[0]) + '">', pre, count=1)
    pre = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="' + E(desc) + '">', pre, count=1)
    pre = re.sub(re.escape(SB.HEAD_START) + '.*?' + re.escape(SB.HEAD_END), '', pre, flags=re.S)
    pre = re.sub(r'<!--hreflang-->.*?<!--/hreflang-->', '', pre, flags=re.S)
    pre = pre.replace('</head>', head_for(path, title, desc, og_img, graph, noindex) + '</head>', 1)
    pre = lang_strip(pre, path)
    post = re.sub(re.escape(SB.BODY_START) + '.*?' + re.escape(SB.BODY_END), '', POST, flags=re.S)
    post = post.replace('const PAGE = {"id": "Partners", "label": "Partners", "slug": "other"};', f'const PAGE = {{"id": "{page_id}", "label": "{page_id}", "slug": "other"}};')
    post = post.replace('</body>', ADD_JS + '\n</body>', 1) if '</body>' in post else post + ADD_JS
    return pre + '<main>\n' + MODAL + CSS + '\n' + body + '\n' + post


BENE = [('<path d="M18.2 7.8a4.5 4.5 0 1 0 0 8.4c2-1.5 3.3-4.2 3.3-4.2s-1.3-2.7-3.3-4.2zM5.8 7.8a4.5 4.5 0 1 1 0 8.4C3.8 14.7 2.5 12 2.5 12s1.3-2.7 3.3-4.2z"/>', 'Lifetime access'),
        ('<path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>', '7-day guarantee'),
        ('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>', '50% off your second course, by email'),
        ('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>', 'Student discounts on Robiel tools and parts')]


def bene_row():
    return '<div class="sx-bene">' + ''.join(
        f'<span><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{p}</svg>{t}</span>' for p, t in BENE) + '</div>'


def hero(crumbs, h1, lead, ctas, image='diesel-injection-test-bench-equipment.webp', eyebrow=None, extra=''):
    bc = '<span style="margin: 0 10px;">/</span>'.join(
        (f'<a href="{b}" style="color: #b9b9be;">{E(a)}</a>' if b else f'<span style="color: #ffffff;">{E(a)}</span>') for a, b in crumbs)
    return f"""<section style="position: relative; box-sizing: border-box;">
<div class="l-hero" style="position: relative; min-height: 560px; background: #0e0f11; border-radius: 0 0 30px 30px; overflow: hidden; display: flex; align-items: center;">
{img(image, '', 'kb', 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 50%; opacity: .55;', lazy=False)}
<span style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(14,15,17,0.86) 0%, rgba(14,15,17,0.62) 45%, rgba(14,15,17,0.9) 100%);"></span>
<div style="position: relative; width: 100%; box-sizing: border-box; padding: 0 20px;"><div style="max-width: 1320px; margin: 0 auto; padding: 190px 40px 80px; box-sizing: border-box;">
<div style="font-family: {FONT}; font-size: 13px; color: #8a9099; letter-spacing: 0.4px;">{bc}</div>
{f'<span class="sx-pill dk" style="margin-top:22px;font-family:{FONT}">{E(eyebrow)}</span>' if eyebrow else ''}
<h1 style="margin: 22px 0 0; font-family: {FONT}; font-weight: 700; color: #ffffff; font-size: clamp(32px, 4.4vw, 62px); line-height: 1.06; letter-spacing: -0.03em; max-width: 980px;">{h1}</h1>
<p style="margin: 22px 0 0; max-width: 720px; color: #dedede; font-size: 18px; line-height: 1.65;">{lead}</p>
<div style="display: flex; flex-wrap: wrap; gap: 14px; margin-top: 34px;">{ctas}</div>{extra}
</div></div></div></section>"""


def cta_red(href, label, target=''):
    return (f'<a class="btn b-red" href="{href}"{target} style="display: inline-flex; align-items: center; gap: 15px; background: #d32a37; color: #ffffff; border-radius: 50px; padding: 5px 5px 5px 30px; font-family: {FONT}; font-size: 15px; height: 60px; box-sizing: border-box; white-space: nowrap;">{label}'
            f'<span class="ic" style="width: 50px; height: 50px; border-radius: 50%; background: #ffffff; color: #d32a37; display: flex; align-items: center; justify-content: center;">{ARROW}</span></a>')


def cta_ghost(href, label, target=''):
    return (f'<a class="btn b-ghost" href="{href}"{target} style="display: inline-flex; align-items: center; border: 1px solid rgba(255,255,255,0.6); color: #ffffff; border-radius: 50px; padding: 0 30px; font-family: {FONT}; font-size: 15px; height: 60px; box-sizing: border-box; white-space: nowrap;">{label}</a>')


def band(title, text, ctas):
    return f"""<section style="padding: 0 20px 120px; box-sizing: border-box;">
<div style="position: relative; max-width: 1320px; margin: 0 auto; background: #d32a37; border-radius: 30px; padding: 80px clamp(20px, 6vw, 80px); box-sizing: border-box; overflow: hidden; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 30px;">
<img width="900" height="700" loading="lazy" decoding="async" src="/assets/bp-a.svg" alt="" aria-hidden="true" style="position: absolute; right: -60px; top: -80px; width: 640px; opacity: 0.22; filter: brightness(3); pointer-events: none; height: auto;">
<div style="position: relative; max-width: 640px;"><h2 style="margin: 0; font-family: {FONT}; font-weight: 600; color: #ffffff; font-size: clamp(30px, 3.2vw, 46px); line-height: 1.12; letter-spacing: -0.02em;">{title}</h2><p style="margin: 14px 0 0; color: #ffe1e3; font-size: 17px;">{text}</p></div>
<div style="position: relative; display: flex; flex-wrap: wrap; gap: 14px;">{ctas}</div></div></section>"""


def band_ctas():
    return (f'<a class="btn b-white" href="/quote" style="display: inline-flex; align-items: center; gap: 15px; background: #ffffff; color: #1d2126; border-radius: 50px; padding: 5px 5px 5px 30px; font-family: {FONT}; font-size: 15px; height: 60px; box-sizing: border-box; white-space: nowrap;">Request a quote'
            f'<span class="ic" style="width: 50px; height: 50px; border-radius: 50%; background: #d32a37; color: #ffffff; display: flex; align-items: center; justify-content: center;">{ARROW}</span></a>'
            f'<a class="btn b-ghost" href="tel:+19545864158" style="display: inline-flex; align-items: center; gap: 12px; border: 1px solid rgba(255,255,255,0.6); color: #ffffff; border-radius: 50px; padding: 0 28px; font-family: {FONT}; font-size: 15px; height: 60px; box-sizing: border-box; white-space: nowrap;">+1 (954)&nbsp;586-4158</a>')


# ------------------------------------------------------------------ system hubs
def hub_rows(s):
    gens = set(s['gens'])
    by = {}
    for code, (g, cat, _) in FIT['items'].items():
        if set(g) & gens and cat in CAT_ORDER:
            by.setdefault(cat, []).append(code)
    rows = []
    for cat in CAT_ORDER:
        codes = by.get(cat, [])
        codes.sort(key=lambda c: (0 if c in SPECS else 1, 0 if brand_of(c) in ('Bosch', 'Denso', 'Delphi') else 1, c))
        for c in codes[:s['per_cat']]:
            rows.append((cat, c))
    return rows[:s['total']]


def cross(code):
    out = []
    for r in (FIT['rel'].get(code) or []):
        o = oem(r)
        if o != oem(code) and o not in out:
            out.append(o)
    return ', '.join(out[:3])


def parts_table(rows, extra=None, with_group=True):
    out = ['<div class="sx-tw"><table class="sx-t"><thead><tr><th>Part number</th><th>Type</th><th>Description and application</th><th>Cross-reference</th><th></th></tr></thead><tbody>']
    last = None
    for cat, code in rows:
        if with_group and cat != last:
            out.append(f'<tr class="gr"><td colspan="5">{E(cat)}</td></tr>')
            last = cat
        sp = SPECS.get(code)
        pn = f'<a href="/parts/{slug(code)}">{E(oem(code))}</a>' if sp else E(oem(code))
        out.append(f'<tr><td>{pn}</td><td>{E(brand_of(code) or "")}</td><td>{E(short_desc(code))}</td><td>{E(cross(code))}</td><td>{btn_add(code)}</td></tr>')
    for x in (extra or []):
        out.append(f'<tr><td>{E(x["pn"])}</td><td>{E(x["type"])}</td><td>{E(x["desc"])}</td><td>{E(x["cross"])}</td><td>{btn_custom(x["id"], x["desc"], x["pn"])}</td></tr>')
    out.append('</tbody></table></div>')
    return ''.join(out)


def triad(s):
    c = C.COURSE_BY[s['course']]
    c2 = C.COURSE_BY.get(s.get('course2'))
    tools = []
    for code in s['tools']:
        tools.append(f'<li style="margin-bottom:8px"><a href="/parts/{slug(code)}">{E(oem(code) if False else code.split(".", 1)[1])}</a> {E(re.sub(r"^Tool (Set|Kit)\s*[/:]\s*(Application:)?\s*", "", tidy((ROW.get(code) or [0, ""])[1])).title())}'
                     f'<div style="margin-top:6px">{btn_add(code, "Add tool set")}</div></li>')
    fl = ''.join(f'<li style="margin-bottom:8px">{E(n)}<div style="font-size:13px;color:#8a9099">{E(d)}</div>'
                 f'<div style="margin-top:6px">{btn_add(code, "Add fluid")}</div></li>' for code, n, d in C.FLUIDS)
    parts_codes = [code for _, code in hub_rows(s)[:0]]
    parts_card = (f'<div class="sx-card"><span class="sx-pill">1. The parts</span><h3 class="sx-h3" style="margin-top:16px">Parts from our Florida stock and partner network</h3>'
                  f'<p style="margin:12px 0 18px">Genuine and aftermarket components for {E(s["apps"])}, matched by part number and shipped from Coconut Creek, FL. Most in-stock orders ship the same business day.</p>'
                  f'<a class="sx-btn red" href="#parts">See the part numbers</a> <a class="sx-btn ol" href="/quote" style="margin-top:8px">Request a quote</a></div>')
    tool_card = (f'<div class="sx-card"><span class="sx-pill">2. Bench tooling and fluids</span><h3 class="sx-h3" style="margin-top:16px">Robiel tools and Maxzz fluids</h3>'
                 f'<ul style="list-style:none;margin:16px 0 0;padding:0;font-size:15px">{"".join(tools)}</ul>'
                 f'<div style="height:1px;background:#e3e6e9;margin:14px 0"></div><ul style="list-style:none;margin:0;padding:0;font-size:15px">{fl}</ul></div>')
    link = C.utm('system_hub', s['slug'])
    courses = f'<p style="margin:12px 0 0"><b style="color:#1d2126">{E(c["name"])}</b><br>{E(c["sub"])}.{(" Instructor: " + E(c["who"]) + ".") if c.get("who") else ""}</p>'
    if c2:
        courses += f'<p style="margin:12px 0 0"><b style="color:#1d2126">{E(c2["name"])}</b><br>{E(c2["sub"])}. Instructor: {E(c2["who"])}.</p>'
    dta_card = (f'<div class="sx-card" style="background:#1e1e87;color:#dfe0ff"><span class="sx-pill dk" style="color:#fff;border-color:rgba(255,255,255,.4)">3. Official training</span>'
                f'<h3 class="sx-h3" style="margin-top:16px;color:#fff">Diesel Tech Academy: $297</h3>{courses.replace("color:#1d2126", "color:#fff")}'
                f'<p style="margin:14px 0 18px;font-size:14px">Lifetime access, 7-day guarantee, and a 50% off voucher for your second course sent by email after your first purchase.</p>'
                f'<a class="sx-btn wh" href="{link}" target="_blank" rel="noopener">Enroll Now ($297) &#8599;</a> '
                f'<a class="sx-btn gh" href="/training" style="margin-top:8px">All 10 courses</a></div>')
    return f'<div class="sx-grid3" style="align-items:stretch">{parts_card}{tool_card}{dta_card}</div>'


def build_system(s, rel_links):
    path = f'/systems/{s["slug"]}'
    rows = hub_rows(s)
    sections = []
    ctas = cta_red('/quote', 'Request a quote') + cta_ghost('#parts', 'Part numbers and cross-reference')
    crumbs = [('Home', '/'), ('Parts', '/injection-parts'), (s['crumb'], None)]
    h = hero(crumbs, E(s['title']), E(s['lead']), ctas, image=s.get('img', 'common-rail-diesel-injector-test-bench.webp'), eyebrow=s['apps'])
    facts = ''.join(f'<div class="sx-card" style="padding:22px 24px"><div style="font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:#8a9099;font-weight:600">{E(k)}</div>'
                    f'<div style="margin-top:6px;color:#1d2126;font-weight:600;font-size:16px;line-height:1.4">{E(v)}</div></div>' for k, v in s['facts'])
    tbl = parts_table(rows, s.get('extra_rows'))
    faq = ''.join(f'<details{" open" if i == 0 else ""}><summary>{E(q)}</summary><p>{E(a)}</p></details>' for i, (q, a) in enumerate(s['faq']))
    links = ''.join(f'<a class="sx-tag" href="/systems/{o["slug"]}">{E(o["crumb"])}</a> ' for o in rel_links if o['slug'] != s['slug'])
    guide = f'<p style="margin:18px 0 0">Technical guide: <a href="{s["guide"]}">{E(C.GUIDE_BY[s["guide"].rsplit("/", 1)[1]]["short"])}</a></p>' if s.get('guide') and GUIDES_LIVE else ''
    body = f"""{h}
<section class="sx" style="padding: 70px 20px 0; box-sizing: border-box;"><div class="sx-wrap"><div class="sx-grid4">{facts}</div></div></section>
<section id="parts" class="sx" style="padding: 100px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">Cross-reference</span><h2 class="sx-h2">Part numbers for the {E(s["crumb"])}</h2>
<p style="margin:16px 0 28px;max-width:760px">Real part numbers from our catalog. Press the button to add a line to your quote list, then send the list for pricing and stock in one business day. The cross-reference column shows the related numbers we match to the same application.</p>
{tbl}
<p style="margin:16px 0 0;font-size:14px">Do not see your number? <a href="/quote">Add it as a custom line</a> or <a href="/parts">browse the full parts catalog</a>.</p>
</div></section>
<section class="sx" style="padding: 100px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">The Maxzz ecosystem</span><h2 class="sx-h2">Parts, bench tooling and training in one place</h2>
<p style="margin:16px 0 28px;max-width:760px">A rebuilder needs three things for this application: the right components, the right tools and fluids on the bench, and a procedure that works. We supply all three.</p>
{triad(s)}</div></section>
<section class="sx" style="padding: 100px 20px 120px; box-sizing: border-box;"><div class="sx-wrap" style="max-width:900px">
<span class="sx-pill">Technical FAQ</span><h2 class="sx-h2">Questions rebuilders ask about the {E(s["crumb"])}</h2>
<div class="sx-faq" style="margin-top:28px">{faq}</div>{guide}
<div style="margin-top:34px"><div style="font-weight:600;color:#1d2126;margin-bottom:10px">Other systems</div>{links}</div></div></section>
{band('Send us your part numbers.', 'We check availability across our partners and answer in one business day. Stocked in Coconut Creek, FL.', band_ctas())}"""
    # JSON-LD
    url = SITE + path
    prods = [{'@type': 'ListItem', 'position': i + 1, 'item': {
        '@type': 'Product', '@id': f'{SITE}/parts/{slug(code)}#product', 'name': title_of(code), 'sku': code, 'mpn': oem(code),
        'category': cat, 'brand': {'@type': 'Brand', 'name': brand_of(code) or 'Maxzz Diesel'}, 'url': f'{SITE}/parts/{slug(code)}'}}
        for i, (cat, code) in enumerate(rows[:20])]
    g = webpage(path, s['title'], s['meta'], [('Home', '/'), ('Parts', '/injection-parts'), (s['crumb'], path)], 'CollectionPage',
                {'about': {'@type': 'Thing', 'name': s['apps']}, 'mainEntity': {'@id': url + '#parts'}})
    g.append({'@type': 'ItemList', '@id': url + '#parts', 'name': f'Part numbers for the {s["crumb"]}', 'numberOfItems': len(prods), 'itemListElement': prods})
    g.append(course_ld(C.COURSE_BY[s['course']], url))
    g.append(faq_ld(path, s['faq']))
    title = s['title'] + ' | Maxzz Diesel'
    return page_shell(path, title if len(title) <= 80 else s['crumb'] + ' Parts, Tools & Training | Maxzz Diesel', s['meta'], 'maxzz-diesel-og', g, body, page_id='Systems')


# ------------------------------------------------------------------ training
DTAB = 'https://cdn.prod.website-files.com/6ab3455fb5d6a607904368e0/'
COURSE_IMG = {'bosch-crin': '6ad140e762b51980de1948a6_crinBosh.webp', 'denso-g2s': '6ac51c1ab365ff2655ce9726_dta-course-denso-g2s.webp',
              'continental-vdo': '6ac51c1af4061657b86fcec0_dta-course-continental.webp', 'bosch-crin-2-3': '6ac51c1b6c0b41d04758bd42_dta-course-bosch-crin23.webp',
              'cat-c7-c9': '6ac51c1b6c0b41d04758bd6f_dta-course-cat-c7c9.webp', 'cat-c15': '6ac51c1b6c0b41d04758bd91_dta-course-cat-c15.webp',
              'bosch-crin-4-2': '6ac51c1ca45cd972b9cec118_dta-course-bosch-crin42.webp', 'cummins-isx15-xpi': '6ac51c1ddba3bdd15fe00aed_dta-course-isx15.webp',
              'denso-g4s': '6ac51c1e5073e85ab360e8ee_dta-course-denso-g4s.webp', 'bosch-piezo': '6ac51c1eb365ff2655ce9854_dta-course-bosch-piezo.webp'}
INST_IMG = {'Arthur Bonachella': '6ac51c16250466db9735d02b_dta-instructor-arthur.webp', 'Waldyr Mazzer': '6ac51c163009c482aaaa9806_dta-instructor-waldyr.webp'}
TESTI_IMG = {'Robert Bratton': '6ac51c1ee4e6bfaaa54e7ad5_dta-t-robert-bratton.webp', 'Fred Dreis': '6ac51c203acc6ceeb6552792_dta-t-fred-dreis.webp',
             'Jose Escoto': '6ac51c1f15250c3dc7c01c86_dta-t-jose-escoto.webp', 'Deep Gidda': '6ac51c1e3acc6ceeb655267b_dta-t-deep-gidda.webp',
             'Raj Gidda': '6ac51c1e213486199b57d20c_dta-t-raj-gidda.webp', 'Jacob Kidd': '6ac51c203acc6ceeb655275d_dta-t-jacob-kidd.webp'}


def testi_block(eyebrow_style, h2_style, heading='What our students say', foot=''):
    cards = ''
    for n, who, q in C.TESTIMONIALS:
        img = TESTI_IMG.get(n)
        av = (f'<img src="{DTAB}{img}" alt="{E(n)}" width="44" height="44" loading="lazy" decoding="async" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none;background:#3a414c">' if img else '')
        cards += (f'<figure style="margin:0;background:#2e343e;border-radius:18px;padding:26px 26px 24px;display:flex;flex-direction:column;box-sizing:border-box;min-width:0">'
                  f'<div style="color:#f5b301;letter-spacing:2px;font-size:18px;line-height:1">&#9733;&#9733;&#9733;&#9733;&#9733;</div>'
                  f'<blockquote style="margin:16px 0 22px;font-size:17px;line-height:1.55;font-weight:600;color:#fff;flex:1">&ldquo;{E(q)}&rdquo;</blockquote>'
                  f'<figcaption style="display:flex;align-items:center;gap:12px">{av}<span style="font-size:13px;line-height:1.4;color:#a0a7b1"><b style="display:block;color:#fff;font-size:14px">{E(n)}</b>{E(who)}</span></figcaption></figure>')
    return (f'<div style="background:#22272f;border-radius:30px;padding:clamp(24px,4vw,48px);box-sizing:border-box">'
            f'<span style="{eyebrow_style}">Diesel Tech Academy</span><h2 style="{h2_style}">{heading}</h2>'
            f'<style>.tb-grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:28px}}@media (max-width:900px){{.tb-grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}@media (max-width:600px){{.tb-grid{{grid-template-columns:minmax(0,1fr)}}}}</style><div class="tb-grid">{cards}</div>{foot}</div>')


def instructors_block():
    bios = {'Arthur Bonachella': 'Instructor at ROBIEL, the tooling manufacturer whose kits are used in every course. Teaches Bosch Piezo, Denso G4S, ISX15, Bosch CRIN 4.2, CAT C15 Series and CAT C7/C9.',
            'Waldyr Mazzer': '40+ years in diesel injection. Former Bosch and Delphi senior instructor across Latin America, now teaching the Diesel Tech Academy bench courses.'}
    out = ''
    for n in ('Arthur Bonachella', 'Waldyr Mazzer'):
        out += (f'<article style="position:relative;border-radius:24px;overflow:hidden;min-height:420px;display:flex;align-items:flex-end;background:#2e343e url({DTAB}{INST_IMG[n]}) 50% 30%/cover no-repeat">'
                f'<div style="position:absolute;inset:0;background:linear-gradient(rgba(25,28,33,0) 35%,rgba(25,28,33,.92))"></div>'
                f'<div style="position:relative;padding:32px;max-width:460px"><h3 style="margin:0;color:#fff;font-size:28px;line-height:1.1;font-weight:700;letter-spacing:-.02em">{n}</h3>'
                f'<p style="margin:10px 0 0;color:#e6e8eb;font-size:15px;line-height:1.55">{E(bios[n])}</p></div></article>')
    return f'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:20px;margin-top:30px">{out}</div>'


def course_card(c):
    quote_attrs = []
    for code, _ in c['tools']:
        if code.startswith('CUSTOM:'):
            quote_attrs.append(('custom-' + c['slug'], code[7:], 'Part number to confirm'))
        else:
            quote_attrs.append((code, title_of(code), code))
    data = json.dumps([{'id': i, 'name': n, 'pn': p} for i, n, p in quote_attrs], ensure_ascii=False)
    who = f'<div style="margin-top:12px;font-size:14px;color:#1d2126"><b>Instructor:</b> {E(c["who"])}</div>' if c.get('who') else ''
    ci = COURSE_IMG.get(c['slug'])
    m = (f'<div style="border-radius:20px;overflow:hidden;margin:-6px -6px 22px;aspect-ratio:344/238;background:#1d2126"><img src="{DTAB}{ci}" alt="{E(c["name"])} course" width="688" height="476" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block"></div>') if ci else ''
    return f"""<div class="sx-card" style="display:flex;flex-direction:column;gap:0">
{m}<h3 class="sx-h3">{E(c["name"])}</h3>
<p style="margin:10px 0 0;font-size:15px">{E(c["sub"])}.</p>{who}
<div style="margin-top:auto;padding-top:22px;display:flex;flex-direction:column;gap:10px">
<a class="sx-btn red" href="{C.utm('training_catalog')}" target="_blank" rel="noopener" style="justify-content:center">Enroll Now ($297) &#8599;</a>
<button type="button" class="sx-btn ol" style="cursor:pointer;background:transparent;font-family:{FONT};justify-content:center" data-bulk='{E(data)}'>Quote Parts &amp; Robiel Tools for this Unit</button>
</div></div>"""


BULK_JS = """<script>(function(){var QK='mx-quote';function rd(){try{var v=JSON.parse(localStorage.getItem(QK)||'[]');return Array.isArray(v)?v:[]}catch(e){return[]}}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-bulk]');if(!b)return;e.preventDefault();
var items=[];try{items=JSON.parse(b.getAttribute('data-bulk'))}catch(x){}var ls=rd();
items.forEach(function(it){var i=-1;for(var k=0;k<ls.length;k++){if(ls[k].id===it.id){i=k;break}}
if(i>=0){ls[i].qty=(ls[i].qty||1)+1}else{ls.push({id:it.id,name:it.name,pn:it.pn,app:'Diesel Tech Academy',cat:'Tool sets and tools',slug:it.id.indexOf('custom-')===0?'other':it.id.toLowerCase().replace(/[^a-z0-9]+/g,'-'),img:'',pos:'',qty:1})}});
try{localStorage.setItem(QK,JSON.stringify(ls))}catch(x){}try{window.dispatchEvent(new StorageEvent('storage',{key:QK}))}catch(x){}
var t=b.getAttribute('data-l')||b.textContent;b.setAttribute('data-l',t);b.textContent='Added to your quote list';setTimeout(function(){b.textContent=t},1800)});})();</script>"""


def testimonial_cards(dark=False):
    out = []
    for n, who, q in C.TESTIMONIALS:
        out.append(f'<figure class="sx-card" style="margin:0"><blockquote style="margin:0;font-size:16px;line-height:1.65;color:#1d2126">&ldquo;{E(q)}&rdquo;</blockquote>'
                   f'<figcaption style="margin-top:16px;font-size:14px"><b style="color:#1d2126">{E(n)}</b><br>{E(who)}</figcaption></figure>')
    return ''.join(out)


def build_training():
    path = '/training'
    title = 'Diesel Tech Academy: Official Training by Maxzz Diesel'
    desc = 'Ten injector courses from the Diesel Tech Academy at $297 each, with lifetime access, a 7-day guarantee and Robiel tools and parts through Maxzz Diesel.'
    h = hero([('Home', '/'), ('Training', None)], 'Diesel Tech Academy: <span style="color:#fc771d">Official Training</span> by Maxzz Diesel',
             'Ten online courses by injector family, taught at a working bench. $297 each, lifetime access and a 7-day guarantee. After your first purchase we email you a 50% off voucher for the second course.',
             cta_red(C.utm('training_hero'), 'Browse the courses', ' target="_blank" rel="noopener"') + cta_ghost('#bundles', 'Course bundles'),
             image='diesel-tech-academy-injector-repair-course.webp', eyebrow='Diesel Tech Academy', extra=bene_row())
    cards = ''.join(course_card(c) for c in C.COURSES)
    TESTI = testi_block('display:inline-block;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:50px;padding:0 14px;font-weight:600;font-size:12px;line-height:25px;letter-spacing:.6px;text-transform:uppercase', f'margin:18px 0 0;font-family:{FONT};font-weight:600;color:#fff;font-size:clamp(28px,3vw,42px);line-height:1.12;letter-spacing:-.02em')
    bund = ''
    for b in C.BUNDLES:
        items = ''.join(f'<li style="margin-bottom:6px">{E(x)}</li>' for x in b['list'])
        bund += (f'<div class="sx-card"><span class="sx-pill">{E(b["courses"])}</span><h3 class="sx-h3" style="margin-top:16px">{E(b["name"])}</h3>'
                 f'<div style="margin-top:10px;font-size:40px;font-weight:700;color:#1d2126;letter-spacing:-.02em">${b["price"]:,}</div>'
                 f'<div style="color:#d32a37;font-weight:600">Save ${b["save"]:,}</div>'
                 f'<ul style="margin:18px 0 22px;padding-left:18px;font-size:15px">{items}</ul>'
                 f'<a class="sx-btn red" href="{C.utm("training_bundle", slug(b["name"]))}" target="_blank" rel="noopener">Choose {E(b["name"].split()[0])} &#8599;</a></div>')
    body = f"""{h}
<section class="sx" style="padding: 100px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">10 courses by injector family</span><h2 class="sx-h2">Pick the injector you rebuild</h2>
<p style="margin:16px 0 30px;max-width:760px">Each course is $297. Students get special purchasing conditions on specialized Robiel tools and parts through Maxzz Diesel.</p>
<div class="sx-grid3">{cards}</div>
<div style="margin-top:56px">{TESTI}</div></div></section>
<section id="bundles" class="sx" style="padding: 110px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">Course bundles</span><h2 class="sx-h2">Three plans, from light duty to the full catalog</h2>
<div class="sx-grid3" style="margin-top:30px">{bund}</div></div></section>
<section class="sx" style="padding: 110px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<div class="sx-card" style="background:#1d2126;color:#dedede;padding:clamp(28px,5vw,60px);display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:30px;align-items:center">
<div><span class="sx-pill dk">Private onsite training</span><h2 class="sx-h2" style="color:#fff">Train your team at your bench or in Florida</h2>
<p style="margin:16px 0 0;color:#dedede">Our instructor comes to your shop and trains your team at your own test bench. Tell us the injector families and the number of technicians and we build the program.</p></div>
<div style="display:flex;flex-direction:column;gap:14px;align-items:flex-end;text-align:right">{cta_red("https://www.dieseltechacademy.com/onsite-training", "Request onsite training", ' target="_blank" rel="noopener"')}
<p style="margin:0;color:#dedede;font-size:15px">Prefer to talk? Call <a href="tel:+19545864158" style="color:#fff;font-weight:600;white-space:nowrap">+1 (954)&nbsp;586-4158</a></p></div></div></div></section>
<section class="sx" style="padding: 110px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">Tools and parts for your course</span><h2 class="sx-h2">Student pricing on the right tooling</h2>
<p style="margin:16px 0 0;max-width:760px">Students get discounted prices on specialized Robiel tools and parts through Maxzz Diesel (not included in the course price). Use the Quote Parts &amp; Robiel Tools button on any course to add the tool set to your list, or see the <a href="/systems/cummins-isx15-xpi">system hubs</a> for the part numbers.</p></div></section>
<section class="sx" style="padding: 110px 20px 120px; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">The instructors</span><h2 class="sx-h2">People who do this work</h2>{instructors_block()}</div></section>
{band('Questions about a course?', 'Our team answers in English, Spanish and Portuguese.', band_ctas())}
{BULK_JS}"""
    url = SITE + path
    g = webpage(path, title, desc, [('Home', '/'), ('Training', path)], 'CollectionPage')
    g.append({'@type': 'ItemList', '@id': url + '#courses', 'name': 'Diesel Tech Academy courses', 'numberOfItems': len(C.COURSES),
              'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'item': course_ld(c, url)} for i, c in enumerate(C.COURSES)]})
    return page_shell(path, title + ' | Maxzz Diesel' if False else 'Diesel Tech Academy Training | Maxzz Diesel', desc, 'diesel-tech-academy-injector-repair-course', g, body, page_id='Training')


# ------------------------------------------------------------------ resources
def build_resources():
    path = '/resources'
    title = 'Technical Guides for Diesel Injection Rebuilders | Maxzz Diesel'
    desc = 'Technical guides on common rail injector rebuilds, failure symptoms, piezo injector cleaning and CP4 pump failure, with part numbers and bench tooling.'
    h = hero([('Home', '/'), ('Technical Guides', None)], 'Technical Guides for <span style="color:#fc771d">Diesel Injection</span> Rebuilders',
             'Rebuild procedures, failure symptoms and part numbers for the injectors and pumps shops see every day, written for the bench.',
             cta_red('/quote', 'Request a quote') + cta_ghost('/training', 'Diesel Tech Academy courses'), eyebrow='Maxzz Diesel Resources')
    cards = ''
    for g_ in C.GUIDES:
        _u = photo(GUIDE_PH.get(g_['ph']))
        _img = (f'<div class="rg-img" style="background:{TINTS[C.GUIDES.index(g_) % len(TINTS)]}"><img src="{_u}" alt="{E(g_["short"])}" width="400" height="300" loading="lazy" decoding="async"></div>') if _u else ''
        cards += (f'<a class="sx-card rg-card" href="/resources/{g_["slug"]}" style="color:#5a5a60 !important;text-decoration:none">' + _img +
                  f'<div class="rg-txt"><span class="sx-pill" style="align-self:flex-start">Technical guide</span>'
                  f'<h3 class="sx-h3" style="margin-top:14px">{E(g_["title"])}</h3>'
                  f'<p style="margin:10px 0 0;font-size:15px">{E(g_["meta"])}</p>'
                  f'<span style="margin-top:16px;color:#d32a37;font-weight:600">Read the guide &rarr;</span></div></a>')
    rg_css = ('<style>.rg-card{display:grid !important;grid-template-columns:230px minmax(0,1fr);gap:24px;align-items:center}'
              '.rg-img{width:230px;height:230px;border-radius:16px;position:relative;overflow:hidden}.rg-txt .sx-h3{font-size:20px !important;line-height:1.25 !important}.rg-txt p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}'
              '.rg-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
              '.rg-txt{display:flex;flex-direction:column;min-width:0}'
              '@media (max-width:560px){.rg-card{grid-template-columns:1fr !important}.rg-img{width:100%;height:auto;aspect-ratio:16/10}}</style>')
    sysl = ''.join(f'<a class="sx-tag" href="/systems/{s["slug"]}">{E(s["crumb"])}</a> ' for s in C.SYSTEMS)
    body = f"""{h}
<section class="sx" style="padding: 100px 20px 0; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">Guides</span><h2 class="sx-h2">Start with the system you work on</h2>
{rg_css}<div class="sx-grid2" style="margin-top:30px">{cards}</div></div></section>
<section class="sx" style="padding: 100px 20px 120px; box-sizing: border-box;"><div class="sx-wrap">
<span class="sx-pill">System hubs</span><h2 class="sx-h2">Part numbers by engine</h2>
<p style="margin:16px 0 20px;max-width:760px">Every hub has a cross-reference table, the matching Robiel tooling and the Diesel Tech Academy course for the injector.</p>{sysl}</div></section>
{band('Need parts for a rebuild?', 'Send the part numbers and we answer in one business day.', band_ctas())}"""
    g = webpage(path, title, desc, [('Home', '/'), ('Technical Guides', path)], 'CollectionPage')
    if GUIDES_LIVE:
        g.append({'@type': 'ItemList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/resources/{x["slug"]}', 'name': x['title']} for i, x in enumerate(C.GUIDES)]})
    return page_shell(path, title, desc, 'maxzz-diesel-og', g, body, page_id='Resources')


def guide_table(t):
    head = ''.join(f'<th>{E(x)}</th>' for x in t['head'])
    rows = ''.join('<tr>' + ''.join(f'<td>{E(c)}</td>' for c in r) + '</tr>' for r in t['rows'])
    return f'<div class="sx-tw"><table class="sx-t" style="min-width:560px"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'


def triple_block(g, compact=False):
    s = C.SYS_BY[g['sys']]
    c = C.COURSE_BY[g['course']]
    parts = hub_rows(s)[:0]
    tools = s['tools'][:1]
    tool_btns = ''.join(btn_add(t, 'Add Robiel tool set') + ' ' for t in tools)
    fl = ' '.join(btn_add(code, 'Add ' + n.replace('Maxzz Fluid Series ', '')) for code, n, d in C.FLUIDS)
    pc = f'/systems/{s["slug"]}#parts'
    a = (f'<div class="sx-mini"><b>1. Quote the parts in this guide</b><p>Part numbers from the table, matched by number.</p>'
         f'<a class="sx-btn red" href="{pc}">See the parts table</a></div>')
    b = (f'<div class="sx-mini"><b>2. Quote Robiel tools and Maxzz fluids</b><p>4113 CAL, 2271 Sonic and 2221S Solv.</p>'
         f'<div style="display:flex;flex-wrap:wrap;gap:8px">{tool_btns}{fl}</div></div>')
    d = (f'<div class="sx-mini" style="background:#1e1e87;color:#dfe0ff"><b style="color:#fff">3. Enroll in the course ($297)</b>'
         f'<p>{E(c["name"])}{(", with " + E(c["who"])) if c.get("who") else ""}.</p>'
         f'<a class="sx-btn wh" href="{C.utm("guide", g["slug"][:40])}" target="_blank" rel="noopener">Enroll Now ($297) &#8599;</a></div>')
    return a + b + d


def build_guide(g):
    path = f'/resources/{g["slug"]}'
    s = C.SYS_BY[g['sys']]
    codes = []
    for cat in g['parts']['cats']:
        cs = [c for (ct, c) in [(FIT['items'][c][1], c) for c in FIT['items'] if set(FIT['items'][c][0]) & set(s['gens'])] if ct == cat]
        cs.sort(key=lambda c: (0 if c in SPECS else 1, c))
        codes += [(cat, c) for c in cs[:max(2, g['parts']['n'] // len(g['parts']['cats']))]]
    codes = codes[:g['parts']['n']]
    ptable = parts_table(codes, None)
    reviewed = REVIEWED
    gph = photo(GUIDE_PH.get(g['ph']))
    byline = ('Technical review: ' if reviewed else 'Technical review pending: ') + (
        'Waldyr Mazzer (40+ years in diesel injection, former Bosch and Delphi senior instructor) and Arthur Bonachella (Robiel and Diesel Tech Academy instructor).')
    secs = ''
    for sec in g['sections']:
        head, paras = sec[0], sec[1]
        secs += f'<h2>{E(head)}</h2>' + ''.join(f'<p>{E(p)}</p>' for p in paras)
        if len(sec) > 2:
            secs += guide_table(sec[2])
    faq = ''.join(f'<details{" open" if i == 0 else ""}><summary>{E(q)}</summary><p>{E(a)}</p></details>' for i, (q, a) in enumerate(g['faq']))
    draft = ('' if GUIDES_LIVE else '<div class="sx-draft"><b>Draft.</b> This guide is waiting for technical review by Waldyr Mazzer and Arthur Bonachella. It is not indexed by search engines yet.</div>')
    body = f"""<style>.util a,.lang button{{color:#4a5058 !important}}.util a:hover{{color:#d32a37 !important}}</style><section style="padding: 150px 20px 0; box-sizing: border-box;"><div class="sx sx-wrap" style="padding:0 40px">
<div style="font-size:14px;color:#5a6169"><a href="/" style="color:#5a6169">Home</a> / <a href="/resources" style="color:#5a6169">Technical Guides</a> / <span style="color:#1d2126">{E(g["short"])}</span></div>
<span class="sx-pill" style="margin-top:22px">Technical guide</span>
<h1 style="margin:16px 0 0;font-family:{FONT};font-weight:700;color:#1d2126;font-size:clamp(28px,3.4vw,46px);line-height:1.1;letter-spacing:-.02em;max-width:1000px">{E(g["title"])}</h1>
<p style="margin:16px 0 0;font-size:14px;max-width:900px"><b style="color:#1d2126">By the Maxzz Diesel technical team.</b> {E(byline)}</p>{draft}
</div></section>
<section class="sx" style="padding: 40px 20px 0; box-sizing: border-box;"><div class="sx-wrap sx-art-grid" style="display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:40px;align-items:start">
<article class="sx-art" style="min-width:0">
<div class="sx-ans{'' if gph else ' nophoto'}"><div><b>Direct answer</b><p>{E(g["answer"])}</p></div>{('<div class="ph"><img src="' + gph + '" alt="' + E(g["short"]) + '" width="300" height="300" loading="lazy"></div>') if gph else ''}</div>
{secs}
<h2>Part numbers</h2><p>Real part numbers from our catalog for this application. Press the button to add a line to your quote list.</p>{ptable}
<h2>Frequently asked questions</h2><div class="sx-faq" style="margin-top:18px">{faq}</div>
</article>
<aside class="sx-aside" aria-label="Quote and training">{triple_block(g)}</aside>
</div></section>
<section class="sx" style="padding: 80px 20px 120px; box-sizing: border-box;"><div class="sx-wrap">
<h2 class="sx-h2" style="margin-bottom:24px">Next steps for this repair</h2><div class="sx-grid3">{triple_block(g)}</div>
<p style="margin:24px 0 0;font-size:14px">More on this engine: <a href="/systems/{s["slug"]}">{E(s["crumb"])} part numbers and tooling</a>.</p></div></section>"""
    url = SITE + path
    gdesc = g['meta']
    graph = webpage(path, g['title'], gdesc, [('Home', '/'), ('Technical Guides', '/resources'), (g['short'], path)], 'WebPage')
    art = {'@type': 'TechArticle', '@id': url + '#article', 'headline': g['title'][:110], 'description': gdesc, 'url': url,
           'inLanguage': 'en-US', 'datePublished': TODAY, 'dateModified': TODAY, 'mainEntityOfPage': {'@id': url + '#webpage'},
           'author': {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Maxzz Diesel'}, 'publisher': {'@id': SITE + '/#org'},
           'abstract': g['answer']}
    graph += [art, faq_ld(path, g['faq']), course_ld(C.COURSE_BY[g['course']], url)]
    return page_shell(path, g['short'] + ' | Maxzz Diesel', gdesc, 'maxzz-diesel-og', graph, body, noindex=not GUIDES_LIVE, page_id='Guide')


# ------------------------------------------------------------------ patches on existing pages
NAV_OLD = '<a class="navl" href="https://www.dieseltechacademy.com/" target="_blank" rel="noopener" style="padding: 0 11px; line-height: 100px;">Training</a>'
NAV_NEW = ('<a class="navl" href="/training" style="padding: 0 11px; line-height: 100px;">Training</a>'
           '<a class="navl" href="/resources" style="padding: 0 11px; line-height: 100px;">Guides</a>')
MN_RE = re.compile(r'<a class="mn-link" href="https://www\.dieseltechacademy\.com/" target="_blank" rel="noopener">Diesel Tech Academy(<span class="mn-ar">.*?</span>)</a>', re.S)
FOOT_OLD = '<a class="foot-link" href="/guides/diesel-fuel-injection">Diesel injection&nbsp;guide</a>'
FOOT_NEW = FOOT_OLD + '\n<a class="foot-link" href="/resources">Technical&nbsp;Guides</a>\n<a class="foot-link" href="/training">Training</a>'
HUB_LINK = {'Cummins': '/systems/cummins-6-7-bosch-crin', 'Power Stroke': '/systems/ford-6-7-powerstroke-cp4', 'Duramax': '/systems/duramax-l5p-denso-g4s',
            'ISX15 and XPI': '/systems/cummins-isx15-xpi', 'CP3': '/systems/cummins-6-7-bosch-crin', 'CP4': '/systems/ford-6-7-powerstroke-cp4'}
EN_PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners', 'policies', 'privacy',
            'quote', 'terms', 'tool-sets', 'who-we-serve', 'training', 'resources']


UTIL_CSS = '<style id="util-css">.util a{color:rgba(255,255,255,.72);transition:color .25s}.util a:hover{color:#fc771d}.util svg{flex:none}@media (max-width:1100px){.util-mail span{display:none}}</style>'
IC = lambda d: f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>'
UTIL_LEFT = ('<div class="util util-left" style="display:flex;align-items:center;gap:22px;margin-right:22px;font-family:' + FONT + ';font-weight:500;font-size:12px;letter-spacing:.3px;">'
             '<a href="tel:+19545864158" style="display:flex;align-items:center;gap:8px;white-space:nowrap">' + IC('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>') + '+1 (954)&nbsp;586-4158</a>'
             '<a class="util-mail" href="mailto:sales@maxzzdiesel.com" aria-label="Email" style="display:flex;align-items:center;gap:8px;white-space:nowrap">' + IC('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>') + '<span>sales@maxzzdiesel.com</span></a>'
             '</div>')
UTIL_RIGHT = ('<div class="util" style="display:flex;align-items:center;gap:22px;font-family:' + FONT + ';font-weight:500;font-size:12px;letter-spacing:.3px;">'
              '<a href="/resources">Guides</a><a href="https://maxzzdiesel.store.unleashedsoftware.com/home" target="_blank" rel="noopener">B2B portal</a>')


def patch_header(src):
    if 'class="util util-left"' in src:
        src = re.sub(r'<span style="display:flex;align-items:center;gap:14px"><a href="https://www\.linkedin\.com.*?</span>', '', src, count=1, flags=re.S)
        src = src.replace('class="util util-left" style="display:flex;align-items:center;gap:22px;font-family', 'class="util util-left" style="display:flex;align-items:center;gap:22px;margin-right:22px;font-family')
        src = src.replace('class="lang-bar" style="max-width: 1320px; margin: 0 auto; height: 30px; display: flex; justify-content: space-between;', 'class="lang-bar" style="max-width: 1320px; margin: 0 auto; height: 30px; display: flex; justify-content: flex-end;')
        return src
    a = src.find('<div class="lang-bar"')
    if a < 0:
        return src
    tag_end = src.index('>', a)
    bar = src[a:tag_end]
    bar2 = bar
    lang_i = src.index('<div class="lang"', tag_end)
    src = src[:a] + bar2 + '>' + UTIL_LEFT + '<div style="display:flex;align-items:center;gap:22px">' + UTIL_RIGHT + '</div>' + src[lang_i:]
    # close the extra wrappers right after the language block: lang-bar ends with two </div> after menu
    end = src.index('</div></div></div>', lang_i) + len('</div></div>')
    src = src[:end] + '</div>' + src[end:]
    src = re.sub(r'<a class="nav-phone"[^>]*>.*?</a>\s*', '', src, count=1, flags=re.S)
    src = re.sub(r'<a class="navl" href="/resources"[^>]*>Guides</a>\s*', '', src)
    if 'id="util-css"' not in src:
        src = src.replace('</head>', UTIL_CSS + '</head>', 1)
    return src


def patch_nav(src):
    src = src.replace(NAV_OLD, NAV_NEW)
    src = patch_header(src)
    if 'href="/training">Training<span class="mn-ar">' not in src:
        src = MN_RE.sub(lambda m: (f'<a class="mn-link" href="/training">Training{m.group(1)}</a>'
                                   f'<a class="mn-link" href="/resources">Technical Guides{m.group(1)}</a>' + m.group(0)), src, count=1)
    if '>Technical&nbsp;Guides</a>' not in src:
        src = src.replace(FOOT_OLD, FOOT_NEW)
    return src


TAG_RE = re.compile(r'<span style="(border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px;)">(' + '|'.join(map(re.escape, HUB_LINK)) + r')</span>')


def patch_tags(src):
    return TAG_RE.sub(lambda m: f'<a href="{HUB_LINK[m.group(2)]}" style="{m.group(1)} color: #1d2126;">{m.group(2)}</a>', src)


FINDER_BAND = f"""<!-- QUICK PART FINDER -->
<section id="finder-shortcut" style="padding: 40px 20px 0; box-sizing: border-box;"><form action="/injection-parts" method="get" style="max-width: 1320px; margin: 0 auto; background: #1d2126; border-radius: 26px; padding: 26px clamp(20px, 3vw, 40px); box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 16px;" role="search">
<label for="home-finder" style="font-family: {FONT}; font-weight: 600; font-size: 18px; color: #ffffff;">Find a part</label>
<input id="home-finder" name="q" type="search" autocomplete="off" placeholder="Engine, system or part number (e.g., 2872405, CRIN 4.2, ISX15, CP4)" aria-label="Search by engine, system or part number" style="flex: 1 1 340px; min-width: 0; height: 52px; border-radius: 50px; border: 0; padding: 0 24px; font-family: {FONT}; font-size: 15px; box-sizing: border-box;">
<button type="submit" style="height: 52px; border: 0; border-radius: 50px; background: #d32a37; color: #ffffff; padding: 0 28px; font-family: {FONT}; font-size: 15px; cursor: pointer;">Search parts</button>
</form></section>
"""


def patch_home(src):
    src = re.sub(r'<!-- QUICK PART FINDER -->\s*<section id="finder-shortcut".*?</form></section>\s*', '', src, flags=re.S)
    if '<!--pf-start-->' in src:
        src = re.sub(r'<!--pf-start-->.*?<!--pf-end-->', lambda m: FINDER_SECTION, src, flags=re.S)
    else:
        src = src.replace('<!-- PRODUCT LINES: The Maxzz', FINDER_SECTION + '<!-- PRODUCT LINES: The Maxzz', 1)
    if '/js/finder.js' not in src:
        src = src.replace('<script src="/js/dc.js"></script>', '<script src="/js/dc.js"></script>\n<script src="/js/finder.js?v=3" defer></script>', 1)
    src = re.sub(r'<section id="dta-testimonials".*?</section>\n?', '', src, flags=re.S)
    eb = f'display:inline-block;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:50px;padding:0 14px;font-family:{FONT};font-weight:600;font-size:12px;line-height:25px;letter-spacing:.6px;text-transform:uppercase'
    h2 = f'margin:18px 0 0;font-family:{FONT};font-weight:600;color:#fff;font-size:clamp(28px,3vw,42px);line-height:1.12;letter-spacing:-.02em'
    foot = '<div style="margin-top:26px"><a href="/training" style="color:#fff;font-weight:600;border-bottom:1px solid #d32a37;padding-bottom:2px">See all 10 courses &rarr;</a></div>'
    block = f'<section id="dta-testimonials" style="padding: 0 20px 120px; box-sizing: border-box;"><div style="max-width: 1320px; margin: 0 auto;">{testi_block(eb, h2, foot=foot)}</div></section>\n'
    src = src.replace('<!-- VOLVO ENGINE KITS -->', block + '<!-- VOLVO ENGINE KITS -->', 1)
    return patch_tags(src)


FINDER_SECTION = f"""<!--pf-start-->
<section id="finder" style="padding: 60px 20px 0; box-sizing: border-box;"><div style="max-width: 1320px; margin: 0 auto; background: #ffffff; border-radius: 30px; padding: clamp(24px, 4vw, 50px); box-sizing: border-box;">
<span style="display: inline-block; border: 1px solid rgba(29,33,38,0.2); color: #d32a37; border-radius: 50px; padding: 0 14px; font-family: {FONT}; font-weight: 600; font-size: 12px; line-height: 25px; letter-spacing: 0.6px; text-transform: uppercase;">Quick part finder</span>
<h2 style="margin: 16px 0 0; font-family: {FONT}; font-weight: 600; color: #1d2126; font-size: clamp(26px, 2.8vw, 38px); line-height: 1.12; letter-spacing: -0.02em;">Search by engine, system or part number</h2>
<div style="margin-top: 22px; position: relative;"><input id="pf-q" type="search" autocomplete="off" placeholder="Search by Engine, System or OEM / Bosch / Denso Part Number (e.g., 2872405, CRIN 4.2, ISX15, CP4)..." aria-label="Search by engine, system or part number" style="width: 100%; height: 60px; border-radius: 50px; border: 1px solid #d3d7dc; padding: 0 28px; font-family: {FONT}; font-size: 16px; box-sizing: border-box;"></div>
<div id="pf-out" aria-live="polite" style="margin-top: 14px;"></div>
<div style="margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-family: {FONT}; font-size: 13px; color: #8a9099;">Brands: @@BRANDS@@</div>
<div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-family: {FONT}; font-size: 13px; color: #8a9099;">Popular systems: <a class="sx-tag" href="/systems/cummins-isx15-xpi" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">Cummins ISX15 XPI</a><a href="/systems/detroit-dd15-bosch-crin-4-2" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">Detroit DD15 CRIN 4.2</a><a href="/systems/duramax-l5p-denso-g4s" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">Duramax L5P</a><a href="/systems/cummins-6-7-bosch-crin" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">Ram 6.7L Cummins</a><a href="/systems/ford-6-7-powerstroke-cp4" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">Ford 6.7L Power Stroke</a><a href="/systems/caterpillar-c15-c7-c9" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126;">CAT C15 / C7 / C9</a></div>
</div></section>
@@PFCSS@@
"""


BR = ''.join(f'<button type="button" data-q="{b}" style="border: 1px solid #dfe3e7; border-radius: 50px; padding: 3px 14px; color: #1d2126; background: #fff; font-family: {FONT}; font-size: 13px; cursor: pointer;">{b}</button>' for b in ['Bosch', 'Denso', 'Delphi', 'Cummins', 'Caterpillar', 'LEAD', 'Robiel', 'Fratelli Bosio', 'Java', 'Maxzz'])
FINDER_SECTION = FINDER_SECTION.replace('@@BRANDS@@', BR) + '<!--pf-end-->'
FINDER_SECTION = FINDER_SECTION.replace("@@PFCSS@@", '<style>#pf-out .pf-r{display:flex;align-items:center;gap:14px;padding:12px 4px;border-bottom:1px solid #eceef0}#pf-out .pf-r b{color:#1d2126;font-size:15px}#pf-out .pf-r span{flex:1;min-width:0;font-size:14px;color:#5a5a60}#pf-out button{font-family:FONTX;cursor:pointer;border:0;border-radius:50px;background:#1d2126;color:#fff;padding:10px 16px;font-size:13px;white-space:nowrap}#pf-out button:hover{background:#d32a37}#pf-out .pf-c{background:#d32a37;padding:14px 22px;font-size:15px}</style>'.replace("FONTX", FONT))


def patch_parts(src):
    src = re.sub(r'<!-- QUICK PART FINDER -->\s*<section id="finder".*?</style>\s*', '', src, count=1, flags=re.S)
    if '<!--pf-start-->' in src:
        src = re.sub(r'<!--pf-start-->.*?<!--pf-end-->', lambda m: FINDER_SECTION, src, flags=re.S)
    else:
        # after the first hero section
        i = src.index('</section>', src.index('<section style="position: relative; box-sizing: border-box;">')) + len('</section>')
        src = src[:i] + '\n' + FINDER_SECTION + src[i:]
    if '/js/finder.js' not in src:
        src = src.replace('<script src="/js/dc.js"></script>', '<script src="/js/dc.js"></script>\n<script src="/js/finder.js?v=3" defer></script>', 1)
    # chips become links to the system hubs
    old = '<div style="display: contents" v-for="ch in cur.chips"><span style="border: 1px solid #d3d7dc;'
    if old in src and ':href="ch.href"' not in src:
        m = re.search(r'<div style="display: contents" v-for="ch in cur\.chips">(<span style="border: 1px solid #d3d7dc;[^>]*>)<span v-text="ch\.t"></span></span></div>', src)
        if m:
            style = re.search(r'style="([^"]*)"', m.group(1)).group(1)
            new = (f'<div style="display: contents" v-for="ch in cur.chips"><a v-if="ch.href" :href="ch.href" style="{style}"><span v-text="ch.t"></span></a>'
                   f'<span v-if="!ch.href" style="{style}"><span v-text="ch.t"></span></span></div>')
            src = src.replace(m.group(0), new, 1)
    if 'CHIP_HREF' not in src:
        src = src.replace('const QK = \'mx-quote\';', 'const CHIP_HREF = ' + json.dumps(SB.CHIP_HREF) + ';\nconst QK = \'mx-quote\';', 1)
        src = src.replace("chips: (c.chips || []).map((t) => ({ t: t }))", "chips: (c.chips || []).map((t) => ({ t: t, href: CHIP_HREF[t] || '' }))", 1)
    return src


def patch_quote(src):
    src = src.replace('<summary style="cursor:pointer;font-size:14px;font-weight:500">Paste a list of part numbers</summary>',
                      '<summary style="cursor:pointer;font-size:15px;font-weight:600">Have a list of part numbers? Paste multiple part numbers &amp; quantities</summary>')
    src = src.replace('<details style="margin-top:14px"><summary style="cursor:pointer;font-size:15px', '<details open style="margin-top:14px"><summary style="cursor:pointer;font-size:15px')
    badge = ('<span class="qx-stock"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>'
             'Stocked in Coconut Creek, FL: Same-Business-Day Shipping on most in-stock orders</span>')
    if 'qx-stock' not in src:
        src = src.replace('<div class="qx-trust">\n', '<div class="qx-trust">\n' + badge + '\n', 1)
        src = src.replace('.qx-paste summary{padding:8px 0}', '.qx-paste summary{padding:8px 0}.qx-stock{display:inline-flex;align-items:center;gap:8px;background:#1d2126;color:#fff;border-radius:50px;padding:8px 16px;font-weight:600}', 1)
    src = src.replace('border-radius:0 0 30px 30px;padding:122px 20px 28px', 'border-radius:0 0 30px 30px;padding:160px 20px 28px')
    return src


def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')
    print('wrote', path, len(text))


def main():
    for s in C.SYSTEMS:
        write(f'systems/{s["slug"]}.html', build_system(s, C.SYSTEMS))
    write('training.html', build_training())
    write('resources.html', build_resources())
    for g in C.GUIDES:
        write(f'resources/{g["slug"]}.html', build_guide(g))
    # patches
    for pg in EN_PAGES:
        p = ROOT / f'{pg}.html'
        if not p.exists():
            continue
        src = p.read_text(encoding='utf-8')
        new = patch_nav(src)
        if pg == 'index':
            new = patch_home(new)
        if pg == 'injection-parts':
            new = patch_parts(new)
        if pg == 'quote':
            new = patch_quote(new)
        if new != src:
            p.write_text(new, encoding='utf-8')
            print('patched', pg)
    # nav on the generated pages that live in sub folders
    for d in ('systems', 'resources'):
        for p in (ROOT / d).glob('*.html'):
            s0 = p.read_text(encoding='utf-8')
            s1 = patch_nav(s0)
            if s1 != s0:
                p.write_text(s1, encoding='utf-8')


if __name__ == '__main__':
    main()
