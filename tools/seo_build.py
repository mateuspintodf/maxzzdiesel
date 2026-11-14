#!/usr/bin/env python3
"""SEO pass over the static pages. Idempotent: run it again after editing a page.

1. Text interpolations {{ expr }} become <span v-text="expr"></span>, so crawlers that do not run
   JavaScript never see raw template code. petite-vue fills them in exactly as before.
2. Content that only appears after a click (tabs, accordions) is written once as static HTML
   inside .seo-static. It is hidden as soon as JavaScript runs (html.js), so visitors see the
   same page as today, and crawlers read every tab.
3. <head> gets a canonical URL and the Organization / WholesaleStore JSON-LD.
4. Home: the big "Diesel injection." stays the same visually but becomes a <p>; the real <h1>
   is the descriptive sentence under it.
"""
import html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://www.maxzzdiesel.com'
PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners',
         'policies', 'privacy', 'quote', 'terms', 'tool-sets', 'who-we-serve']

ORG_NODE = {
    '@type': ['Organization', 'WholesaleStore'],
    '@id': SITE + '/#org',
    'name': 'Maxzz Diesel',
    'url': SITE + '/',
    'logo': SITE + '/assets/favicon.svg',
    'image': SITE + '/assets/mg/hero-2.jpg',
    'description': 'Wholesale supplier of diesel fuel injection parts: common rail injectors, high-pressure pumps, nozzles, '
                   'control valves, repair kits, Robiel tool sets, ISO 4113 calibration fluid and SCR / NOx aftertreatment test '
                   'equipment for rebuilders, injection labs, distributors and fleets. Stocked in Coconut Creek, Florida, since 1992.',
    'foundingDate': '1992',
    'founder': [{'@type': 'Person', 'name': 'Waldyr Mazzer'}, {'@type': 'Person', 'name': 'Douglas Mazzer'},
                {'@type': 'Person', 'name': 'Michael Mazzer'}],
    'address': {'@type': 'PostalAddress', 'streetAddress': '6601 Lyons Road, Ste H-6', 'addressLocality': 'Coconut Creek',
                'addressRegion': 'FL', 'postalCode': '33073', 'addressCountry': 'US'},
    'telephone': '+1-954-586-4158',
    'email': 'sales@maxzzdiesel.com',
    'areaServed': ['North America', 'Latin America'],
    'contactPoint': [
        {'@type': 'ContactPoint', 'contactType': 'sales', 'telephone': '+1-954-586-4158', 'email': 'sales@maxzzdiesel.com',
         'availableLanguage': ['English', 'Spanish', 'Portuguese'], 'areaServed': 'US'},
        {'@type': 'ContactPoint', 'contactType': 'sales', 'telephone': '+1-954-371-6996', 'name': 'WhatsApp US',
         'availableLanguage': ['English', 'Spanish', 'Portuguese']},
        {'@type': 'ContactPoint', 'contactType': 'sales', 'telephone': '+1-786-716-4857', 'name': 'WhatsApp Latin America',
         'availableLanguage': ['Spanish', 'Portuguese', 'English'], 'areaServed': 'Latin America'}],
    'memberOf': {'@type': 'Organization', 'name': 'Association of Diesel Specialists (ADS)'},
    'knowsAbout': ['Diesel fuel injection', 'Common rail injectors', 'High-pressure fuel pumps', 'Injector rebuilding',
                   'SCR aftertreatment', 'NOx sensors', 'ISO 4113 calibration fluid', 'Bosch', 'Denso', 'Delphi', 'Robiel',
                   'LEAD', 'Fratelli Bosio', 'SLP'],
    'subOrganization': [{'@type': 'EducationalOrganization', 'name': 'Diesel Tech Academy', 'url': 'https://www.dieseltechacademy.com/'},
                        {'@type': 'Organization', 'name': 'Volvo Engine Kits', 'url': 'https://volvoenginekits.com/'}],
    'sameAs': ['https://www.linkedin.com/company/maxzzdiesel/', 'https://www.instagram.com/maxzzdiesel.us/',
               'https://www.facebook.com/maxzzdiesel'],
}
WEBSITE = {'@type': 'WebSite', '@id': SITE + '/#website', 'url': SITE + '/', 'name': 'Maxzz Diesel',
           'publisher': {'@id': SITE + '/#org'}, 'inLanguage': 'en-US'}
ORG = {'@context': 'https://schema.org', '@graph': [ORG_NODE, WEBSITE]}

TITLES = {
    'index': 'Wholesale Diesel Injection Parts Since 1992 | Maxzz Diesel',
    'injection-parts': 'Common Rail Injectors, Pumps and Repair Parts | Maxzz Diesel',
    'aftertreatment': 'SCR and NOx Aftertreatment Test Equipment | Maxzz Diesel',
    'fluids': 'ISO 4113 Calibration Fluid and Degreasers | Maxzz Diesel',
    'tool-sets': 'Robiel Injector and Pump Tool Sets | Maxzz Diesel',
    'contamination-kits': 'Fuel System Contamination Kits | Maxzz Diesel',
    'partners': 'Denso, Robiel and SLP Distributor | Maxzz Diesel',
    'who-we-serve': 'Parts Supplier for Diesel Rebuilders and Labs | Maxzz Diesel',
    'about': 'About Maxzz Diesel: Diesel Specialists Since 1992',
    'quote': 'Request a Wholesale Quote for Diesel Injection Parts | Maxzz Diesel',
    'policies': 'Shipping, Returns and Warranty | Maxzz Diesel',
    'terms': 'Terms and Conditions | Maxzz Diesel',
    'privacy': 'Privacy Policy | Maxzz Diesel',
}
OG_IMG = {'index': 'hero-2', 'injection-parts': 'parts-hero', 'aftertreatment': 'nox-final', 'fluids': 'fluids-final',
          'tool-sets': 'toolsets-bench-hero', 'contamination-kits': 'contam-kit', 'about': 'about'}

HEAD_START, HEAD_END = '<!--seo-head-->', '<!--/seo-head-->'
BODY_START, BODY_END = '<!--seo-static-->', '<!--/seo-static-->'
E = html.escape


def head_block(page):
    url = SITE + '/' if page == 'index' else f'{SITE}/{page}'
    title = TITLES.get(page, 'Maxzz Diesel')
    img = f"{SITE}/assets/mg/{OG_IMG.get(page, 'hero-2')}.jpg"
    parts = [f'<link rel="canonical" href="{url}">',
             f'<meta property="og:url" content="{url}">',
             f'<meta property="og:site_name" content="Maxzz Diesel"><meta property="og:locale" content="en_US">',
             f'<meta property="og:image" content="{img}"><meta name="twitter:card" content="summary_large_image">',
             '<link rel="preload" href="/assets/fonts/BDOGrotesk-Regular.woff2" as="font" type="font/woff2" crossorigin>',
             '<link rel="preload" href="/assets/fonts/BDOGrotesk-Medium.woff2" as="font" type="font/woff2" crossorigin>',
             "<script>document.documentElement.classList.add('js')</script>",
             '<style>.js .seo-static{display:none}.seo-static{max-width:1100px;margin:40px auto;padding:0 24px;font-family:Arial,sans-serif;color:#1d2126}</style>']
    graph = [ORG_NODE, WEBSITE]
    if page != 'index':
        graph.append({'@type': 'WebPage', '@id': url + '#webpage', 'url': url, 'name': title, 'inLanguage': 'en-US',
                      'isPartOf': {'@id': SITE + '/#website'}, 'publisher': {'@id': SITE + '/#org'},
                      'breadcrumb': {'@type': 'BreadcrumbList', 'itemListElement': [
                          {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': SITE + '/'},
                          {'@type': 'ListItem', 'position': 2, 'name': title.split(' | ')[0], 'item': url}]}})
    parts.append('<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False) + '</script>')
    return HEAD_START + ''.join(parts) + HEAD_END


def js_const(src, name):
    m = re.search(r'const ' + name + r' = (\[.*?\]);\n', src, re.S)
    if not m: return None
    try: return json.loads(m.group(1))
    except json.JSONDecodeError: return None


def tabs_html(tabs):
    out = []
    for t in tabs:
        out.append('<article>')
        if t.get('eyebrow'): out.append(f'<p>{E(t["eyebrow"])}</p>')
        out.append(f'<h3>{E(t.get("title") or t.get("label", ""))}</h3>')
        if t.get('text'): out.append(f'<p>{E(t["text"])}</p>')
        if t.get('checks'): out.append('<ul>' + ''.join(f'<li>{E(c)}</li>' for c in t['checks']) + '</ul>')
        if t.get('rows'): out.append('<table>' + ''.join(f'<tr><th>{E(r[0])}</th><td>{E(r[1])}</td></tr>' for r in t['rows']) + '</table>')
        if t.get('chips'): out.append(f'<p>{E(t.get("chipsLabel") or "")}</p><ul>' + ''.join(f'<li>{E(c)}</li>' for c in t['chips']) + '</ul>')
        if t.get('code'): out.append(f'<p>{E(t.get("codeEyebrow", ""))} {E(t["code"])} {E(t.get("codeSub", ""))}</p>')
        href = t.get('ctaHref') or '/quote'
        out.append(f'<p><a href="{E(href)}">{E(t.get("ctaLabel") or "Add to my quote")}</a></p>')
        out.append('</article>')
    return ''.join(out)


def index_courses(src):
    m = re.search(r'const list = \[(.*?)\];', src, re.S)
    if not m: return ''
    items = re.findall(r"\['((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\]", m.group(1))
    if not items: return ''
    return ('<h3>Diesel Tech Academy courses</h3><dl>' +
            ''.join(f'<dt>{E(a)}</dt><dd>{E(b.replace(chr(92) + "u00a0", " "))}</dd>' for a, b in items) + '</dl>')


def kits_html(src):
    kits = js_const(src, 'KITS')
    if not kits: return ''
    rows = []
    for k in kits:
        if isinstance(k, dict):
            name = k.get('lbl') or k.get('name') or k.get('title') or ''
            extra = k.get('pn') or k.get('code') or ''
            rows.append(f'<li>{E(name)}{(" " + E(extra)) if extra else ""}</li>')
    return '<h3>Robiel tool sets</h3><ul>' + ''.join(rows) + '</ul>' if rows else ''


def process(page):
    p = ROOT / f'{page}.html'
    src = p.read_text(encoding='utf-8')
    orig = src
    # 1. interpolations -> v-text (only in text, never inside tags)
    chunks = re.split(r'(<script\b.*?</script>|<style\b.*?</style>)', src, flags=re.S)
    src = ''.join(c if c.startswith(('<script', '<style')) else
                  re.sub(r'\{\{\s*(.+?)\s*\}\}', lambda m: f'<span v-text="{m.group(1)}"></span>', c) for c in chunks)
    # 2. head block
    src = re.sub(re.escape(HEAD_START) + '.*?' + re.escape(HEAD_END), '', src, flags=re.S)
    src = src.replace('</head>', head_block(page) + '</head>', 1)
    t = TITLES.get(page)
    if t:
        src = re.sub(r'<title>.*?</title>', '<title>' + E(t) + '</title>', src, count=1, flags=re.S)
        src = re.sub(r'<meta property="og:title" content="[^"]*">', '<meta property="og:title" content="' + E(t.split(' | ')[0]) + '">', src, count=1)
    src = src.replace('<html lang="en">', '<html lang="en-US">', 1)
    # 3. static content block
    src = re.sub(re.escape(BODY_START) + '.*?' + re.escape(BODY_END), '', src, flags=re.S)
    static = ''
    tabs = js_const(src, 'TABS')
    if tabs: static += tabs_html(tabs)
    if page == 'index': static += index_courses(src)
    if page == 'tool-sets': static += kits_html(src)
    if static:
        block = f'{BODY_START}<section class="seo-static" aria-hidden="true">{static}</section>{BODY_END}'
        # place it after the app root, before the page scripts
        src = src.replace('<script src="/js/petite-vue.iife.js"></script>', block + '\n<script src="/js/petite-vue.iife.js"></script>', 1)
    # 4. home H1
    if page == 'index' and '<h1 style=' in src and 'Diesel&nbsp;injection.</h1>' in src:
        src = re.sub(r'<h1 (style="[^"]*")>Diesel&nbsp;injection\.</h1>', lambda m: '<p ' + m.group(1)[:-1] + '; letter-spacing: -0.02em; text-wrap: balance">Diesel&nbsp;injection.</p>', src, count=1)
        old = re.search(r'<p (style="[^"]*")>Injectors, pumps, rails, kits, fluids and repair parts for rebuilders, injection labs and distributors\. Stocked in Florida\. Most orders ship the same business&nbsp;day\.</p>', src)
        if old:
            st = old.group(1)
            st2 = st[:-1] + ('; font-weight: inherit' if 'font-weight' not in st else '') + '; letter-spacing: normal; text-wrap: pretty"'
            new = (f'<h1 {st2}>Diesel injectors, pumps, common rail rebuild parts and test bench supplies '
                   f'for rebuilders and injection labs. Stocked in Florida. Most orders ship the same business&nbsp;day.</h1>')
            src = src.replace(old.group(0), new, 1)
    if src != orig:
        p.write_text(src, encoding='utf-8')
    left = len(re.findall(r'\{\{', src))
    return page, left, bool(static)


if __name__ == '__main__':
    for pg in PAGES:
        print(*process(pg))
