#!/usr/bin/env python3
"""Adds the site-wide search (js/sitesearch.js) to every public page. Idempotent: run again after the other builders.
  python3 tools/search_build.py
Skips the store (portal has its own search), the admin, the e-mail designer and the sales panel."""
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
TAG = '<script src="/js/sitesearch.js?v=1" defer></script>'
SKIP = {'portal.html', 'admin.html', 'mail-editor.html', 'painel.html'}
n = 0
for p in sorted(ROOT.glob('*.html')) + sorted(ROOT.glob('*/*.html')) + sorted(ROOT.glob('*/*/*.html')):
    rel = p.relative_to(ROOT).as_posix()
    if p.name in SKIP or rel.split('/')[0] in ('agenda', 'downloads', 'tests', 'node_modules', 'tools', 'api', 'data', 'assets') or '/quote.html' in '/' + rel:
        continue
    src = p.read_text(encoding='utf-8')
    if '<nav' not in src or '</body>' not in src:
        continue
    new = re.sub(r'<script src="/js/sitesearch\.js[^"]*" defer></script>\n?', '', src)
    new = new.replace('</body>', TAG + '\n</body>', 1)
    if new != src:
        p.write_text(new, encoding='utf-8'); n += 1
print('search added or refreshed on', n, 'pages')
