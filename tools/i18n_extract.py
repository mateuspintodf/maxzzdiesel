#!/usr/bin/env python3
"""Collect the visible English strings of the static pages for translation."""
import re, json, sys, html
from html.parser import HTMLParser
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners',
         'policies', 'privacy', 'quote', 'terms', 'tool-sets', 'who-we-serve']
ATTRS = ('alt', 'placeholder', 'aria-label', 'title')

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False); self.skip = 0; self.out = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        for k, v in attrs:
            if k in ATTRS and v and re.search('[A-Za-z]{2}', v): self.out.append(html.unescape(v))
            if k == 'content' and v and len(v) > 25 and ' ' in v and re.search('[a-z]{3}', v): self.out.append(html.unescape(v))
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip -= 1
    def handle_data(self, d):
        if self.skip: return
        t = d.strip()
        if t and re.search('[A-Za-z]{2}', t) and '{{' not in t: self.out.append(html.unescape(t))
    def handle_entityref(self, name): pass

def js_strings(src):
    out = []
    for m in re.finditer(r'<script>(.*?)</script>', src, re.S):
        js = m.group(1)
        for s in re.findall(r'"((?:[^"\\]|\\.){3,})"|\'((?:[^\'\\]|\\.){3,})\'', js):
            v = s[0] or s[1]
            if re.match(r'^[A-Z0-9(+]', v) and re.search('[A-Za-z]{3}', v) and not re.search(r'[{}<>;=|]|\.jpg|\.webp|\.png|\.svg|https?:|mg/|\dpx|rgba|#[0-9a-f]{3}|\$\{|cubic|translate|scale\(|--|\? *$|^[A-Z][a-z]+[A-Z]', v) and not re.search(r'[:,+(] *$', v):
                out.append(v)
    return out

if __name__ == '__main__':
    allstr = {}
    for pg in PAGES:
        src = (ROOT / f'{pg}.html').read_text(encoding='utf-8')
        body = src
        p = P(); p.feed(body)
        for s in p.out + js_strings(src):
            s = re.sub(r'\s+', ' ', s.replace(' ', ' ')).strip()
            if s: allstr.setdefault(s, []).append(pg)
    json.dump(sorted(allstr), open(sys.argv[1], 'w'), ensure_ascii=False, indent=0)
    print(len(allstr), sum(len(k) for k in allstr))
