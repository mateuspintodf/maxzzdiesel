"""One name per concept in the English pages (menu, mobile menu, top bar, footer).
Idempotent: run after pages_build.py and before seo_build.py / i18n.py.
- desktop menu "Parts" -> "Injection parts"; mobile "About us" -> "About"
- "Guides" / "Technical Guides" -> "Technical guides"; footer pillar link -> "Diesel fuel injection guide"
- "Diesel Tech Academy" removed from the mobile menu and the footer (Training already covers it)
- the old Unleashed store leaves the top bar, the mobile menu and the product heroes; the footer keeps it as "Online ordering"
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UL = 'https://maxzzdiesel.store.unleashedsoftware.com/home'
SKIP = {'admin.html', 'painel.html', 'portal.html'}


def fix(s):
    s = s.replace('href="/injection-parts" style="padding: 0 11px; line-height: 100px;">Parts<', 'href="/injection-parts" style="padding: 0 11px; line-height: 100px;">Injection parts<')
    s = s.replace('href="/about">About us<', 'href="/about">About<')
    s = s.replace('<a href="/resources">Guides</a>', '<a href="/resources">Technical guides</a>')
    s = s.replace('href="/resources">Technical Guides<', 'href="/resources">Technical guides<')
    s = s.replace('href="/resources">Technical&nbsp;Guides<', 'href="/resources">Technical&nbsp;guides<')
    s = s.replace('>Diesel injection&nbsp;guide<', '>Diesel fuel injection&nbsp;guide<')
    # Diesel Tech Academy out of the mobile menu and the footer link list
    s = re.sub(r'<a class="mn-link" href="https://www\.dieseltechacademy\.com/" target="_blank" rel="noopener">Diesel Tech Academy<span class="mn-ar">.*?</span></a>', '', s, flags=re.S)
    s = re.sub(r'<a href="https://www\.dieseltechacademy\.com/" target="_blank" rel="noopener">Diesel Tech(?:&nbsp;| )Academy</a>', '', s)
    # Unleashed store: out of the top bar, mobile menu and heroes; footer link renamed
    s = s.replace(f'<a href="{UL}" target="_blank" rel="noopener">B2B portal</a>', '')
    s = re.sub(r'<a class="mn-link" href="' + re.escape(UL) + r'" target="_blank" rel="noopener">B2B portal<span class="mn-ar">.*?</span></a>', '', s, flags=re.S)
    s = re.sub(r'<a class="btn b-ghost" href="' + re.escape(UL) + r'" target="_blank" rel="noopener"[^>]*>.*?</a>', '', s, flags=re.S)
    s = s.replace(f'href="{UL}" target="_blank" rel="noopener">B2B&nbsp;portal<', f'href="{UL}" target="_blank" rel="noopener">Online&nbsp;ordering<')
    # pillar guide: breadcrumb into Technical guides, Training points to the Training page like the rest of the site
    s = s.replace('<span style="color: #b9b9be;">Guides</span>', '<a href="/resources" style="color: #b9b9be;">Technical guides</a>')
    s = re.sub(r'<a( class="navl")? href="https://www\.dieseltechacademy\.com/" target="_blank" rel="noopener"( style="[^"]*")?>Training<', lambda m: '<a' + (m.group(1) or '') + ' href="/training"' + (m.group(2) or '') + '>Training<', s)
    return s


def main():
    files = [p for p in ROOT.glob('*.html') if p.name not in SKIP]
    for d in ('systems', 'resources', 'guides'):
        files += sorted((ROOT / d).glob('*.html'))
    n = 0
    for p in files:
        s = p.read_text(encoding='utf-8')
        t = fix(s)
        if t != s:
            p.write_text(t, encoding='utf-8'); n += 1
    print('names', n, 'files')


if __name__ == '__main__':
    main()
