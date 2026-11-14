"""Builds guides/diesel-fuel-injection.html (EN) from the policies.html shell and adds ES/PT strings to i18n dicts.
Run: python3 tools/guide_build.py && python3 tools/i18n.py build"""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import guide_content as G

SITE = 'https://www.maxzzdiesel.com'
URL = f'{SITE}/{G.SLUG}'
IMG = '/assets/mg/diesel-injection-common-rail-injector-bench.webp'
F = "font-family: 'BDO Grotesk', 'Helvetica Neue', Arial, sans-serif;"
ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>'
DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>'

es, pt = (json.load(open(ROOT / 'i18n' / f'{l}.json', encoding='utf-8')) for l in ('es', 'pt'))
def T(t):
    en, e, p = t; es[en] = e; pt[en] = p; return en
def K(t):  # translate without overwriting a key the rest of the site already uses
    en, e, p = t; es.setdefault(en, e); pt.setdefault(en, p); return en
_seen = [set(), set(), set()]
def link1(text, li):
    # link the first plain mention of each term on the page; skip <strong> and existing links
    parts = re.split(r'(<strong>.*?</strong>|<a\b.*?</a>)', text)
    for terms, href in G.LINKS:
        term = terms[li]
        if term in _seen[li]: continue
        for k, seg in enumerate(parts):
            if seg.startswith('<'): continue
            m = re.search(r'(?<![\w-])' + re.escape(term) + r'(?![\w-])', seg)
            if m:
                parts[k] = seg[:m.start()] + f'<a href="{href}">{term}</a>' + seg[m.end():]
                _seen[li].add(term); break
        parts = re.split(r'(<strong>.*?</strong>|<a\b.*?</a>)', ''.join(parts))
    return ''.join(parts)
def L(t):
    return T(tuple(link1(x, i) for i, x in enumerate(t)))

src = (ROOT / 'policies.html').read_text(encoding='utf-8')
title_en = T(G.TITLE); desc = T(G.DESC)
es[title_en + ' | Maxzz Diesel'] = G.TITLE[1] + ' | Maxzz Diesel'; pt[title_en + ' | Maxzz Diesel'] = G.TITLE[2] + ' | Maxzz Diesel'

# ---- head
old_t = re.search(r'<title>(.*?) \| Maxzz Diesel</title>', src).group(1)
old_d = re.search(r'<meta name="description" content="([^"]*)"', src).group(1)
src = src.replace(f'<title>{old_t} | Maxzz Diesel</title>', f'<title>{title_en} | Maxzz Diesel</title>')
src = src.replace(f'"{old_t}"', f'"{title_en}"').replace(f'"{old_t} | Maxzz Diesel"', f'"{title_en} | Maxzz Diesel"')
src = src.replace(f'"{old_d}"', f'"{desc}"')
src = src.replace(f'{SITE}/policies', URL)
src = src.replace('<meta property="og:type" content="website">', '<meta property="og:type" content="article">')
src = re.sub(r'(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*', r'\g<1>' + SITE + IMG.replace('.webp', '.jpg'), src)
art = {"@type": "Article", "@id": URL + "#article", "headline": G.TITLE[0], "description": G.DESC[0], "image": SITE + IMG.replace('.webp', '.jpg'),
       "datePublished": G.DATE, "dateModified": G.DATE, "inLanguage": "en-US", "mainEntityOfPage": {"@id": URL + "#webpage"},
       "author": {"@id": SITE + "/#org"}, "publisher": {"@id": SITE + "/#org"},
       "about": [{"@type": "Thing", "name": n} for n in ("Diesel fuel injection", "Common rail", "Diesel injector", "High-pressure fuel pump")]}
terms = {"@type": "DefinedTermSet", "@id": URL + "#glossary", "name": G.GLOSS_T[0], "hasDefinedTerm": [{"@type": "DefinedTerm", "name": t[0], "description": d[0]} for t, d in G.GLOSSARY]}
art["hasPart"] = {"@id": URL + "#glossary"}
src = src.replace(']}</script><!--/seo-head-->', ', ' + json.dumps(terms, ensure_ascii=False) + ']}</script><!--/seo-head-->', 1)
src = src.replace(']}</script><!--/seo-head-->', ', ' + json.dumps(art, ensure_ascii=False) + ']}</script><!--/seo-head-->', 1)
src = src.replace('"name": "' + title_en + '", "item"', '"name": "' + T(G.CRUMB_PAGE) + '", "item"')

# ---- hero
a = src.index('<section style="position: relative; box-sizing: border-box;">\n<div class="l-hero"')
b = src.index('</section>', a) + len('</section>')
hero = src[a:b]
hero = re.sub(r'<img (?:fetchpriority="high" )?width="\d+" height="\d+" src="[^"]*"(?: srcset="[^"]*" sizes="[^"]*")?', f'<img fetchpriority="high" width="1376" height="768" src="{IMG}"', hero, count=1)
hero = hero.replace('<span style="color: #b9b9be;">Company</span>', f'<span style="color: #b9b9be;">{T(G.CRUMB)}</span>')
hero = hero.replace('<span style="color: #ffffff;">Policies</span>', f'<span style="color: #ffffff;">{G.CRUMB_PAGE[0]}</span>')
hero = re.sub(r'(<h1 [^>]*>).*?(</h1>)', lambda m: m.group(1) + T(G.H1) + m.group(2), hero, flags=re.S)
hero = re.sub(r'(<p class="ld ld3" [^>]*>).*?(</p>)', lambda m: m.group(1) + T(G.LEAD) + m.group(2), hero, flags=re.S)

# ---- detail: aside (table of contents + call card) and article
c = src.index('<section style="padding: 120px 20px; box-sizing: border-box;">', b)
d = src.index('</section>', c) + len('</section>')
detail = src[c:d]
aside = re.search(r'<aside .*?</aside>', detail, re.S).group(0)
toc = ''.join(f'<a class="l-side" href="#{sid}" style="display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: 16px; background: transparent; color: #1d2126; {F} font-weight: 600; font-size: 13px; letter-spacing: 0.4px; text-transform: uppercase;"><span style="flex: 1;">{T(h2)}</span><span class="l-side-ic" style="display: flex;">{DOWN}</span></a>' for sid, h2, _, _ in G.SECTIONS)
toc += f'<a class="l-side" href="#{G.GLOSS_ID}" style="display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: 16px; background: transparent; color: #1d2126; {F} font-weight: 600; font-size: 13px; letter-spacing: 0.4px; text-transform: uppercase;"><span style="flex: 1;">{T(G.GLOSS_T)}</span><span class="l-side-ic" style="display: flex;">{DOWN}</span></a>'
toc += f'<a class="l-side" href="#faq" style="display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: 16px; background: transparent; color: #1d2126; {F} font-weight: 600; font-size: 13px; letter-spacing: 0.4px; text-transform: uppercase;"><span style="flex: 1;">FAQ</span><span class="l-side-ic" style="display: flex;">{DOWN}</span></a>'
aside = re.sub(r'(<div style="padding: 0 18px 14px;[^>]*>)Legal(</div>)', lambda m: m.group(1) + T(G.TOC_T) + m.group(2), aside)
aside = re.sub(r'<nav aria-label="Legal"([^>]*)>.*?</nav>', lambda m: f'<nav aria-label="{G.TOC_T[0]}"{m.group(1)}>{toc}</nav>', aside, flags=re.S)

CARD = 'background: #ffffff; border-radius: 30px; padding: 34px 34px 30px; box-sizing: border-box; scroll-margin-top: 150px;'
H2S = f'margin: 0; {F} font-weight: 600; font-size: 26px; line-height: 1.25; color: #1d2126; letter-spacing: -0.01em;'
def block(bl):
    kind = bl[0]
    if kind == 'p': return f'<p style="margin: 14px 0 0;">{L(bl[1])}</p>'
    if kind == 'ul': return '<ul class="g-list">' + ''.join(f'<li>{L(i)}</li>' for i in bl[1]) + '</ul>'
    if kind == 'table':
        head = ''.join(f'<th scope="col">{T(h)}</th>' for h in bl[1])
        rows = ''.join('<tr>' + ''.join((f'<th scope="row">{T(cell)}</th>' if i == 0 else f'<td><span class="g-lbl">{bl[1][i][0]}</span><span>{T(cell)}</span></td>') for i, cell in enumerate(r)) + '</tr>' for r in bl[2])
        return f'<div class="g-tw"><table class="g-table"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
cards = ''
for sid, h2, lead, blocks in G.SECTIONS:
    cards += f'<section id="{sid}" style="{CARD}"><h2 style="{H2S}">{T(h2)}</h2><p style="margin: 14px 0 0;">{L(lead)}</p>{"".join(block(x) for x in blocks)}</section>'
take = (f'<div class="g-take"><h2 class="g-take-t">{T(G.TAKE_T)}</h2><ul class="g-list">' + ''.join(f'<li>{T(x)}</li>' for x in G.TAKEAWAYS) + '</ul></div>')
gl = ''.join(f'<div class="g-term"><dt>{T(t)}</dt><dd>{T(dfn)}</dd></div>' for t, dfn in G.GLOSSARY)
cards += f'<section id="{G.GLOSS_ID}" style="{CARD}"><h2 style="{H2S}">{T(G.GLOSS_T)}</h2><dl class="g-gloss">{gl}</dl></section>'
hub = ''.join(f'<a class="g-hub-i" href="{href}"><span class="g-hub-n">{K(n)}</span><span class="g-hub-d">{T(dsc)}</span><span class="g-hub-ic" aria-hidden="true">{ARROW}</span></a>' for n, dsc, href in G.HUB)
cards += f'<section id="products" style="{CARD}"><h2 style="{H2S}">{T(G.HUB_T)}</h2><div class="g-hub">{hub}</div></section>'
kick = f'<span style="display: inline-block; border: 1px solid rgba(29,33,38,0.2); color: #d32a37; border-radius: 50px; padding: 0 14px; {F} font-weight: 600; font-size: 12px; line-height: 25px; letter-spacing: 0.6px; text-transform: uppercase;">{T(G.KICK)}</span>'
article = (f'<article class="l-main g-art" style="min-width: 0;">{kick}'
           f'<p class="g-by" style="margin: 14px 0 0; font-size: 14px; color: #8a9099;">{T(G.BYLINE)}</p>'
           f'<p class="g-intro" style="margin: 20px 0 0; font-size: 19px; line-height: 1.65; color: #1d2126;">{T(G.INTRO)}</p>{take}'
           f'<div style="height: 1px; background: #d9dde1; margin: 44px 0;"></div>'
           f'<div style="display: flex; flex-direction: column; gap: 16px;">{cards}</div></article>')
detail = re.sub(r'<aside .*?</aside>', lambda m: aside, detail, flags=re.S)
detail = re.sub(r'<div class="l-main".*</div>\n</div></section>$', lambda m: article + '\n</div></section>', detail, flags=re.S)
assert '<article' in detail, 'article not placed'

# ---- FAQ
NEED = "Still need something? Call <a href=\"tel:+19545864158\">+1 (954) 586-4158</a> or <a href=\"/quote\">send us your part numbers</a>."
items, ld = [], []
for i, (en, e, p) in enumerate(G.FAQ):
    q, ans = en; es[q], es[ans] = e; pt[q], pt[ans] = p
    items.append(f'<details name="faq" class="fq-i"{" open" if i == 0 else ""}><summary>{q}<span class="fq-ic" aria-hidden="true"></span></summary><p>{ans}</p></details>')
    ld.append({"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": ans}})
faq = ('<!-- FAQ (answer engines) -->\n<section id="faq" class="fq" style="padding: 0 20px 120px; box-sizing: border-box; scroll-margin-top: 120px;">\n<div class="fq-in">\n'
       f'<div class="fq-h"><span class="fq-k">Questions</span><h2>{T(G.FAQ_H2)}</h2><p>{NEED}</p></div>\n'
       f'<div class="fq-list">{"".join(items)}</div>\n</div>\n'
       '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": ld}, ensure_ascii=False) + '</script>\n'
       "<script>document.querySelectorAll('#faq details').forEach(function(d){d.addEventListener('toggle',function(){if(d.open)document.querySelectorAll('#faq details[open]').forEach(function(o){if(o!==d)o.open=false;});});});</script>\n</section>\n")

# ---- CTA from injection-parts (already translated)
ip = (ROOT / 'injection-parts.html').read_text(encoding='utf-8')
m = ip.index('</main>'); cta = ip[ip.rindex('<section', 0, m):m].replace('<!-- FOOTER -->', '').rstrip() + '\n'

e0 = src.index('<!-- FOOTER -->', d)
out = src[:a] + hero + '\n' + detail + '\n' + faq + cta + src[e0:]
out = re.sub(r'<!--seo-static-->.*?<!--/seo-static-->', '', out, flags=re.S)
out = out.replace('href="/policies" style="display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 16px; background: #1e1e87', 'href="/policies" style="display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 16px; background: #1e1e87')
assert out.count('<h1') == 1 and out.count('<main>') == 1
p = ROOT / (G.SLUG + '.html'); p.parent.mkdir(exist_ok=True); p.write_text(out, encoding='utf-8')
for l, dd in (('es', es), ('pt', pt)):
    (ROOT / 'i18n' / f'{l}.json').write_text('{\n' + ',\n'.join(json.dumps(k, ensure_ascii=False) + ': ' + json.dumps(v, ensure_ascii=False) for k, v in dd.items()) + '\n}', encoding='utf-8')
print('guide ok', len(out))
