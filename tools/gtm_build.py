#!/usr/bin/env python3
"""Adds the Google Tag Manager container (GTM-T8J8922X) to every public page. Idempotent.
Ads, Meta Pixel and future GA4 live inside GTM; HubSpot stays loaded directly."""
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
ID = 'GTM-T8J8922X'
PAGES = ['index', 'about', 'aftertreatment', 'contamination-kits', 'fluids', 'injection-parts', 'partners',
         'policies', 'privacy', 'quote', 'terms', 'tool-sets', 'who-we-serve']
HEAD = ("<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
        "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;"
        "j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + ID + "');</script>\n<!-- End Google Tag Manager -->\n")
BODY = ('<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' + ID +
        '" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n<!-- End Google Tag Manager (noscript) -->\n')
import re
for pg in PAGES:
    p = ROOT / f'{pg}.html'; s = p.read_text(encoding='utf-8')
    if ID in s: print(pg, 'same'); continue
    s = re.sub(r'(<head[^>]*>\s*)', lambda m: m.group(1) + HEAD, s, count=1)
    s = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + '\n' + BODY, s, count=1)
    p.write_text(s, encoding='utf-8'); print(pg, 'changed')
