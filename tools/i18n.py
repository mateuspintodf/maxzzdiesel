#!/usr/bin/env python3
"""Build /es/ and /pt/ versions of the commercial pages.

extract: python3 tools/i18n.py extract out.json   -> list of English units to translate
build:   python3 tools/i18n.py build               -> writes es/*.html and pt/*.html from i18n/es.json, i18n/pt.json
(run after tools/seo_build.py, which only rewrites the English pages)

Units:
 1. inner HTML of text blocks (h1-h4, p, li, dt, dd, summary, label, button, th, td, figcaption, option)
    when it holds no other block (inline tags such as span, a, b, br stay inside the unit)
 2. remaining visible text nodes
 3. alt / placeholder / aria-label / title attributes and meta description / og texts
 4. human strings inside inline <script> data (quoted literals that read like copy)
Anything without a translation stays in English, so a partial dictionary never breaks a page.
"""
import re, json, sys, html
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners',
         'quote', 'tool-sets', 'who-we-serve']
LANGS = {'es': ('es', 'es_ES', 'Español'), 'pt': ('pt-BR', 'pt_BR', 'Português')}
SITE = 'https://www.maxzzdiesel.com'
BLOCK = r'h1|h2|h3|h4|p|li|dt|dd|summary|label|button|th|td|figcaption|option'
BLOCK_RE = re.compile(r'<(' + BLOCK + r')(\s[^>]*)?>((?:(?!<(?:' + BLOCK + r'|div|section|ul|ol|table|form|select|textarea|input|svg|img)\b).)*?)</\1>', re.S | re.I)
SCRIPT_RE = re.compile(r'(<script\b[^>]*>)(.*?)(</script>)', re.S | re.I)
STYLE_RE = re.compile(r'<style\b.*?</style>', re.S | re.I)
HEAD_RE = re.compile(r'<head\b.*?</head>', re.S | re.I)
ATTR_RE = re.compile(r'(\s(?:alt|placeholder|aria-label|title)=")([^"]*[A-Za-z]{2}[^"]*)(")')
META_RE = re.compile(r'(<meta\s+(?:name="description"|property="og:(?:title|description)"|name="twitter:(?:title|description)")\s+content=")([^"]+)(")')
TITLE_RE = re.compile(r'(<title>)(.*?)(</title>)', re.S)
JS_STR = re.compile(r'"((?:[^"\\]|\\.){2,})"|\'((?:[^\'\\]|\\.){2,})\'')

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

def has_words(s):
    t = re.sub(r'<[^>]+>', ' ', s)
    t = re.sub(r'\{\{.*?\}\}', ' ', t)
    return re.search(r'[A-Za-z]{2}', html.unescape(t)) is not None

def copy_like(v):
    if not re.match(r'^[A-Z0-9(+]', v) or not re.search('[A-Za-z]{3}', v): return False
    if re.search(r'[{}<>;=|`]|\.jpg|\.webp|\.png|\.svg|https?:|mg/|\dpx|rgba|#[0-9a-fA-F]{3}|\$\{|cubic|translate|scale\(|--', v): return False
    if re.search(r'[:,+(] *$', v): return False
    if re.match(r'^[A-Z][a-z]+[A-Z]', v): return False  # camelCase identifiers
    return True

def split_regions(src):
    """yield (kind, text) where kind is 'code' (script/style/head) or 'body'"""
    marks = []
    for rx in (SCRIPT_RE, STYLE_RE):
        for m in rx.finditer(src): marks.append((m.start(), m.end()))
    marks.sort(); out = []; pos = 0
    for a, b in marks:
        if a < pos: continue
        out.append(('body', src[pos:a])); out.append(('code', src[a:b])); pos = b
    out.append(('body', src[pos:])); return out

def units_in_body(body):
    found = []
    for m in BLOCK_RE.finditer(body):
        inner = m.group(3)
        if has_words(inner): found.append(norm(inner))
    # leftover text nodes outside matched blocks
    rest = BLOCK_RE.sub(' ', body)
    for t in re.findall(r'>([^<>]+)<', rest):
        if has_words(t) and '{{' not in t: found.append(norm(t))
    for m in ATTR_RE.finditer(body):
        if not m.group(2).startswith(('${', '`')): found.append(norm(m.group(2)))
    return found

def js_units(code):
    out = []
    if not code.lower().startswith('<script') or 'src=' in code[:80] or 'ld+json' in code[:80]: return out
    for m in JS_STR.finditer(code):
        v = m.group(1) or m.group(2)
        if copy_like(v): out.append(v)
    return out

def extract(path_out):
    seen = {}
    for pg in PAGES:
        src = (ROOT / f'{pg}.html').read_text(encoding='utf-8')
        hm = HEAD_RE.search(src); head = hm.group(0) if hm else ''
        for m in META_RE.finditer(head): seen.setdefault(norm(m.group(2)), pg)
        tm = TITLE_RE.search(head)
        if tm: seen.setdefault(norm(tm.group(2)), pg)
        body = src[hm.end():] if hm else src
        for kind, part in split_regions(body):
            for u in (units_in_body(part) if kind == 'body' else js_units(part)):
                seen.setdefault(u, pg)
    json.dump(list(seen.keys()), open(path_out, 'w'), ensure_ascii=False, indent=0)
    print(len(seen), sum(len(k) for k in seen))

# ---------- build ----------
def link_fix(s, lang):
    pre = '/' + lang
    def fix(m):
        q, url = m.group(1), m.group(2)
        path = url.split('#')[0].split('?')[0]
        if path in ('/',):
            return f'{q}{pre}{url[len(path):]}'
        name = path.strip('/')
        if name in PAGES and name != 'index':
            return f'{q}{pre}/{name}{url[len(path):]}'
        return m.group(0)
    return re.sub(r'((?:href|:href)=["\']|"ctaHref": ")(/[^"\'\s]*)', fix, s)

def tr_body(body, d):
    body = re.sub(r'<option>([^<]+)</option>', lambda m: f'<option value="{m.group(1)}">{d.get(norm(m.group(1)), m.group(1))}</option>' if norm(m.group(1)) in d else m.group(0), body)
    def blk(m):
        inner = m.group(3); k = norm(inner)
        if k in d: return f'<{m.group(1)}{m.group(2) or ""}>{d[k]}</{m.group(1)}>'
        return m.group(0)
    body = BLOCK_RE.sub(blk, body)
    def txt(m):
        t = m.group(1); k = norm(t)
        if k and k in d:
            lead = t[:len(t) - len(t.lstrip())]; trail = t[len(t.rstrip()):]
            return '>' + lead + d[k] + trail + '<'
        return m.group(0)
    body = re.sub(r'>([^<>]+)<', txt, body)
    body = ATTR_RE.sub(lambda m: m.group(1) + html.escape(html.unescape(d[norm(m.group(2))]), quote=True) + m.group(3) if norm(m.group(2)) in d else m.group(0), body)
    return body

def tr_js(code, d):
    if not code.lower().startswith('<script') or 'src=' in code[:80] or 'ld+json' in code[:80]: return code
    def rep(m):
        v = m.group(1) or m.group(2); q = '"' if m.group(1) is not None else "'"
        if v in d:
            t = d[v].replace('\\', '\\\\').replace(q, '\\' + q)
            return q + t + q
        return m.group(0)
    return JS_STR.sub(rep, code)


LANG_TXT = {'English': 'en', 'Español': 'es', 'Português': 'pt'}
def page_url(pg, lang):
    base = '' if lang == 'en' else '/' + lang
    return (base or '/') if pg == 'index' else f'{base}/{pg}'

def lang_switch(s, pg, cur):
    def a(m):
        attrs, label = m.group(1), m.group(2)
        lg = LANG_TXT[label]
        menu = 'padding: 7px 10px' in attrs
        cls = '' if lg == cur else (' class="lang-opt"' if menu else '')
        if menu:
            style = f' style="padding: 7px 10px; border-radius: 8px; color: {"#fc771d" if lg == cur else "#c9cdd2"};"'
        else:
            style = ' style="color: #fc771d;"' if lg == cur else ''
        hl = {'en': 'en', 'es': 'es', 'pt': 'pt-BR'}[lg]
        cur_attr = ' aria-current="true"' if lg == cur else ''
        return f'<a{cls} href="{page_url(pg, lg)}" hreflang="{hl}" lang="{hl}"{cur_attr}{style}>{label}</a>'
    s = re.sub(r'<a((?:\s+(?:class|href|lang|hreflang|style|aria-current)="[^"]*")*)>(English|Español|Português)</a>', a, s)
    s = re.sub(r'(aria-label="(?:Language|Idioma)"[^>]*>(?:(?!</button>).)*?</svg>)(EN|ES|PT)(<svg)', lambda m: m.group(1) + cur.upper() + m.group(3), s, flags=re.S)
    return s

def tr_ld(code, d, lang):
    if 'ld+json' not in code[:80]: return code
    d = dict(d); d.update({norm(re.sub(r'<[^>]+>', '', k)): v for k, v in list(d.items()) if '<' in k})
    def rep(m):
        if m.group(2): return m.group(0)
        try: v = json.loads('"' + m.group(1) + '"')
        except Exception: return m.group(0)
        k = norm(v)
        if k in d: return json.dumps(html.unescape(re.sub(r'<[^>]+>', '', d[k])).replace('\xa0', ' '), ensure_ascii=False)
        return m.group(0)
    code = re.sub(r'"((?:[^"\\]|\\.)*)"(\s*:)?', rep, code)
    for pg in PAGES:
        if pg != 'index': code = re.sub(r'"' + re.escape(SITE) + '/' + pg + r'(?=["#])', '"' + SITE + '/' + lang + '/' + pg, code)
    code = code.replace('"' + SITE + '/#webpage"', '"' + SITE + '/' + lang + '#webpage"').replace('"item": "' + SITE + '/"', '"item": "' + SITE + '/' + lang + '"')
    if '"WebPage"' in code: code = re.sub(r'("@type": "WebPage", "@id": "[^"]*", "url": ")' + re.escape(SITE) + r'/"', r'\1' + SITE + '/' + lang + '"', code)
    return code.replace('"inLanguage": "en-US"', '"inLanguage": "' + {'es': 'es', 'pt': 'pt-BR'}[lang] + '"')

def js_localize():
    sys.path.insert(0, str(ROOT / 'i18n')); import js as JS
    out = {}
    for lang, idx in (('es', 0), ('pt', 1)):
        for f in ('quote-app.js', 'forms.js', 'gate.js', 'motion.js'):
            src = (ROOT / 'js' / f).read_text(encoding='utf-8')
            # exact quoted literals only (a regex scan over a whole file can lose track of quotes in comments)
            for k in sorted(JS.T, key=len, reverse=True):
                for q in ("'", '"'):
                    src = src.replace(q + k + q, q + JS.T[k][idx].replace('\\', '\\\\').replace(q, '\\' + q) + q)
            (ROOT / 'js' / f.replace('.js', f'.{lang}.js')).write_text(src, encoding='utf-8')
        out[lang] = ({k: v[idx] for k, v in JS.RAW.items()}, {k: v[idx] for k, v in JS.EXPR.items()})
    return out

def build():
    RAW = js_localize()
    for lang, (code, locale, label) in LANGS.items():
        dpath = ROOT / 'i18n' / f'{lang}.json'
        if not dpath.exists(): continue
        d = {norm(k): v for k, v in json.load(open(dpath, encoding='utf-8')).items() if v}
        outdir = ROOT / lang; outdir.mkdir(exist_ok=True)
        for pg in PAGES:
            src = (ROOT / f'{pg}.html').read_text(encoding='utf-8')
            hm = HEAD_RE.search(src); head = hm.group(0); body = src[hm.end():]
            parts = []
            for kind, part in split_regions(body):
                parts.append(tr_body(part, d) if kind == 'body' else tr_ld(tr_js(part, d), d, lang))
            body = ''.join(parts)
            # head: title, metas, canonical, og:url, hreflang
            head = TITLE_RE.sub(lambda m: m.group(1) + html.escape(d.get(norm(m.group(2)), html.unescape(m.group(2)))) + m.group(3), head, count=1)
            head = META_RE.sub(lambda m: m.group(1) + html.escape(d.get(norm(html.unescape(m.group(2))), html.unescape(m.group(2))), quote=True) + m.group(3), head)
            en_url = SITE + ('/' if pg == 'index' else '/' + pg)
            loc_url = SITE + f'/{lang}' + ('' if pg == 'index' else '/' + pg)
            head = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{loc_url}">', head)
            head = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{loc_url}">', head)
            head = head.replace('<meta property="og:locale" content="en_US">', f'<meta property="og:locale" content="{locale}">')
            src2 = src[:hm.start()] + head + body
            src2 = re.sub(r'<html lang="[^"]*">', f'<html lang="{code}">', src2, count=1)
            src2 = link_fix(src2, lang)
            src2 = lang_switch(src2, pg, lang)
            for a, b in RAW[lang][0].items(): src2 = src2.replace(a, b)
            EX = RAW[lang][1]
            src2 = re.sub(r'((?:v-text|v-html|:[a-z-]+)=")([^"]*)(")', lambda m: m.group(1) + re.sub(r"'([^'\\]*)'", lambda n: "'" + EX[n.group(1)].replace("'", "\\'") + "'" if n.group(1) in EX else n.group(0), m.group(2)) + m.group(3), src2)
            src2 = re.sub(r'/js/(quote-app|forms|gate|motion)\.js', lambda m: f'/js/{m.group(1)}.{lang}.js', src2)
            src2 = re.sub(r'<script type="application/ld\+json">.*?</script>', lambda m: tr_ld(m.group(0), d, lang), src2, flags=re.S)
            (outdir / f'{pg}.html').write_text(src2, encoding='utf-8')
    # hreflang on every version
    for pg in PAGES:
        f0 = ROOT / f'{pg}.html'; f0.write_text(lang_switch(f0.read_text(encoding='utf-8'), pg, 'en'), encoding='utf-8')
        alts = {'en': SITE + ('/' if pg == 'index' else '/' + pg)}
        for lang, (code, _, _) in LANGS.items():
            if (ROOT / lang / f'{pg}.html').exists():
                alts[code] = SITE + f'/{lang}' + ('' if pg == 'index' else '/' + pg)
        tags = ''.join(f'<link rel="alternate" hreflang="{c}" href="{u}">' for c, u in alts.items()) + f'<link rel="alternate" hreflang="x-default" href="{alts["en"]}">'
        files = [ROOT / f'{pg}.html'] + [ROOT / lang / f'{pg}.html' for lang in LANGS if (ROOT / lang / f'{pg}.html').exists()]
        for f in files:
            s = f.read_text(encoding='utf-8')
            s = re.sub(r'<!--hreflang-->.*?<!--/hreflang-->', '', s, flags=re.S)
            if len(alts) > 1: s = s.replace('</head>', '<!--hreflang-->' + tags + '<!--/hreflang--></head>', 1)
            f.write_text(s, encoding='utf-8')
    print('built')

if __name__ == '__main__':
    if sys.argv[1] == 'extract': extract(sys.argv[2])
    else: build()
