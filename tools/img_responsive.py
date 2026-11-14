"""Responsive images: makes 480/800/1200 px WebP variants of every /assets/mg/*.webp used in an <img>, and adds
srcset + sizes. sizes come from rendered widths measured with Playwright at 390, 1024 and 1440 px
(object-fit: cover boxes counted at the width the image really needs). Images never measured get sizes="100vw".
Usage: python3 tools/img_responsive.py <imgsizes.json>   then   python3 tools/i18n.py build"""
import json, math, re, sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parent.parent
WIDTHS = (480, 800, 1200)
meas = json.load(open(sys.argv[1]))
best = {}
for k, v in meas.items():
    pg, _, src = k.split('|', 2)
    cur = best.setdefault((pg, src), {})
    for vw, w in v.items(): cur[vw] = max(cur.get(vw, 0), w)

def variants(src):
    p = ROOT / src.lstrip('/')
    im = Image.open(p); W, H = im.size
    out = []
    for w in WIDTHS:
        if w >= W * 0.9: continue
        vp = p.with_name(f'{p.stem}-{w}w.webp')
        if not vp.exists():
            im.convert('RGB' if im.mode not in ('RGB', 'RGBA') else im.mode).resize((w, round(H * w / W)), Image.LANCZOS).save(vp, 'WEBP', quality=82, method=6)
        out.append((f'{src[:-5]}-{w}w.webp', w))
    out.append((src, W))
    return out

def sizes_for(m):
    if not m: return '100vw'
    def vw(w, base): return f'{math.ceil(w / base * 100 * 1.08)}vw' if w else '100vw'
    big = m.get('1440', 0)
    return f'(max-width: 760px) {vw(m.get("390", 0), 390)}, (max-width: 1200px) {vw(m.get("1024", 0), 1024)}, ' + (f'{math.ceil(big * 1.08)}px' if big else '100vw')

pages = {f.stem if f.parent == ROOT else 'guides/' + f.stem: f for f in list(ROOT.glob('*.html')) + list((ROOT / 'guides').glob('*.html'))}
pages['quote_main'] = ROOT / 'tools' / 'quote_main.html'
n = 0
for pg, f in pages.items():
    s = f.read_text(encoding='utf-8')
    def rep(m):
        global n
        tag = m.group(0)
        tag = re.sub(r' srcset="[^"]*" sizes="[^"]*"', '', tag)
        src = re.search(r'\ssrc="(/assets/mg/[^"]+\.webp)"', tag).group(1)
        vs = variants(src)
        if len(vs) < 2: return tag
        srcset = ', '.join(f'{u} {w}w' for u, w in vs)
        n += 1
        return tag.replace(f' src="{src}"', f' src="{src}" srcset="{srcset}" sizes="{sizes_for(best.get(("quote" if pg == "quote_main" else pg, src)))}"', 1)
    s2 = re.sub(r'<img\b[^>]*\ssrc="/assets/mg/[^"]+\.webp"[^>]*>', rep, s)
    if s2 != s: f.write_text(s2, encoding='utf-8')
print('imgs', n)
