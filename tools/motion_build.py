#!/usr/bin/env python3
"""Adds the motion layer (assets/motion.css + js/motion.js) to every public page and moves the
click / hover timings onto the motion scale. Idempotent. Hero and image reveals keep their
slower, intentional timing."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners',
         'policies', 'privacy', 'quote', 'terms', 'tool-sets', 'who-we-serve']
CSS = '<link rel="stylesheet" href="/assets/motion.css?v=3">'
JS = '<script src="/js/motion.js?v=3" defer></script>'

# interaction timings only (hover color, tab state, accordion height); hero/image motion is untouched
TIMINGS = [
    ('transition: color .4s', 'transition: color .2s'),
    ('transition: background-color .45s, color .45s', 'transition: background-color .25s, color .25s'),
    ('transition: background-color .35s, color .35s', 'transition: background-color .25s, color .25s'),
    ('transition: background-color .35s;', 'transition: background-color .25s;'),
    ('transition: background-color .4s, border-color .4s, transform .5s cubic-bezier(.2,.7,.2,1)',
     'transition: background-color .25s, border-color .25s, transform .35s cubic-bezier(.22,1,.36,1)'),
    ('transition: grid-template-rows .6s cubic-bezier(.2,.7,.2,1)', 'transition: grid-template-rows .4s cubic-bezier(.22,1,.36,1)'),
    ('transition: width .3s, background-color .3s', 'transition: width .25s cubic-bezier(.22,1,.36,1), background-color .25s'),
]

ACC_OLD = '<div style="display: contents" v-if="c.open"><p class="tabpane" style="margin: 0; padding: 0 30px 22px 0;"><span v-text="c.text"></span></p></div>'
ACC_NEW = ('<div class="t-acc-panel" :class="c.open ? \'is-open\' : \'\'"><div class="t-acc-inner">'
           '<p class="tabpane" style="margin: 0; padding: 0 30px 22px 0;"><span v-text="c.text"></span></p></div></div>')

for pg in PAGES:
    p = ROOT / f'{pg}.html'
    s = p.read_text(encoding='utf-8')
    o = s
    if CSS not in s:
        s = s.replace('</head>', CSS + '</head>', 1)
    if JS not in s:
        s = s.replace('</body>', JS + '\n</body>', 1)
    for a, b in TIMINGS:
        s = s.replace(a, b)
    s = s.replace(ACC_OLD, ACC_NEW)
    if s != o:
        p.write_text(s, encoding='utf-8')
    print(pg, 'changed' if s != o else 'same')
