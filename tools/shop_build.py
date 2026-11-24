#!/usr/bin/env python3
"""Adds the buying modules (real parts with photo, sales calls to action) to the pillar page and to the
diesel injection guide, in English, Spanish and Portuguese.

Run LAST, after guide_build.py / seo_build.py / i18n.py build:  python3 tools/shop_build.py
It edits the built pages in place, between <!--shop:...--> markers, so it can be run again at any time.
No prices and no stock: the card shows photo, part, application and a button that adds it to the list.
"""
import json, re, html, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://www.maxzzdiesel.com'
LANGS = ('en', 'es', 'pt')
PRE = {'en': '', 'es': '/es', 'pt': '/pt'}
QUOTE = {'en': '/portal', 'es': '/portal', 'pt': '/portal'}  # the ES/PT quote pages were retired; the store is the only quote flow
WA = 'https://wa.me/19543716996'

specs = json.load(open(ROOT / 'data' / 'specs.json', encoding='utf-8'))
catalog = {r[0]: r for r in json.load(open(ROOT / 'data' / 'catalog.json', encoding='utf-8'))}

def slug(s):
    s = s.lower().replace('&', ' and ')
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', s))
def esc(s): return html.escape(s, quote=True)
def tr(t, lang): return t[LANGS.index(lang)] if isinstance(t, tuple) else t

TYPES = {
 'Fuel Injector': ('Fuel injector', 'Inyector', 'Injetor'),
 'High Pressure Fuel Pump': ('High pressure pump', 'Bomba de alta presión', 'Bomba de alta pressão'),
 'Fuel Rail': ('Fuel rail', 'Riel de combustible', 'Flauta de combustível'),
 'Fuel Rail Pressure Sensor': ('Rail pressure sensor', 'Sensor de presión del riel', 'Sensor de pressão da flauta'),
 'Injector Nozzle': ('Injector nozzle', 'Tobera de inyector', 'Bico injetor'),
 'Injector Control Valve': ('Control valve', 'Válvula de control', 'Válvula de controle'),
 'Injector Solenoid': ('Injector solenoid', 'Solenoide de inyector', 'Solenoide de injetor'),
 'Seal and O-Ring Kit': ('Seal and O-ring kit', 'Kit de sellos y O-rings', 'Kit de vedação e O-rings'),
 'Fuel Contamination Kit': ('Contamination kit', 'Kit de contaminación', 'Kit de contaminação'),
 'Pump Repair Kit': ('Pump repair kit', 'Kit de reparación de bomba', 'Kit de reparo de bomba'),
 'Injector Repair Kit': ('Injector repair kit', 'Kit de reparación de inyector', 'Kit de reparo de injetor'),
 'High Pressure Injector Line': ('High pressure line', 'Línea de alta presión', 'Linha de alta pressão'),
 'Injector & Pump Tool': ('Robiel tool set', 'Juego de herramientas Robiel', 'Jogo de ferramentas Robiel'),
 'Shop Fluid': ('Bench fluid', 'Fluido de banco', 'Fluido de bancada'),
 'Injector Tester': ('Injector tester', 'Probador de inyectores', 'Testador de injetores'),
}
COND = {'New': ('New', 'Nuevo', 'Novo'), 'Reman': ('Remanufactured', 'Remanufacturado', 'Remanufaturado')}
# what to show under the name when the part has no engine (bench and shop items)
NOTE = {
 'ST.4113/5.3gal': ('ISO 4113 calibration fluid, 20 L', 'Fluido de calibración ISO 4113, 20 L', 'Fluido de calibração ISO 4113, 20 L'),
 'ST.4113/55.gal': ('ISO 4113 calibration fluid, 55 gal drum', 'Fluido de calibración ISO 4113, tambor de 55 gal', 'Fluido de calibração ISO 4113, tambor de 55 gal'),
 'ST.2271': ('Ultrasonic degreaser, 24 x 1 L', 'Desengrasante para ultrasonido, 24 x 1 L', 'Desengraxante para ultrassom, 24 x 1 L'),
 'RB.B0.914.00.01': ('Multi-function common rail tester', 'Probador common rail multifunción', 'Testador common rail multifunção'),
 'BO.F.00R.J02.177': ('O-ring kit for Bosch common rail injectors', 'Kit de O-rings para inyectores common rail Bosch', 'Kit de O-rings para injetores common rail Bosch'),
 'JV.10.805.176': ('Repair kit for Bosch common rail injectors', 'Kit de reparación para inyectores common rail Bosch', 'Kit de reparo para injetores common rail Bosch'),
}
ADD = ('Add to quote', 'Agregar a la cotización', 'Adicionar à cotação')
ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>'
PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>'

def part(code):
    if code not in specs or code not in catalog: sys.exit('part without a product page: ' + code)
    if catalog[code][2] == 'engine': sys.exit('engine part is not sold here: ' + code)
    sp = specs[code]; t = sp['title']; typ = sp['type']
    name = t.split(':')[0] if ':' in t and ' for ' not in t.split(':')[0] else t
    for cut in (' Remanufactured ', ' ' + typ, ' Common Rail Injector Tester', ' Multi-Function', ' Tool Set'):
        name = name.split(cut)[0]
    eng = sp.get('eng') or ''
    return {'code': code, 'slug': slug(code), 'title': t, 'name': name.strip(), 'type': typ, 'cond': sp.get('cond') or 'New',
            'fit': (t.split(':', 1)[1].strip() if ':' in t else '') if eng.startswith('Bench') else eng.replace(' (XPI common rail)', '')}

def card(code, lang):
    p = part(code)
    kind = tr(TYPES.get(p['type'], (p['type'],) * 3), lang)
    if p['cond'] == 'Reman': kind += ' · ' + tr(COND['Reman'], lang)
    fit = tr(NOTE[code], lang) if code in NOTE else p['fit']
    url = '/parts/' + p['slug']
    return (f'<article class="sp-c"><a class="sp-ph" href="{url}" tabindex="-1" aria-hidden="true"><img loading="lazy" decoding="async" width="280" height="210" src="/api/img?c={esc(code)}&amp;s=s" alt=""></a>'
            f'<div class="sp-b"><span class="sp-k">{esc(kind)}</span><a class="sp-n" href="{url}" title="{esc(p["title"])}">{esc(p["name"])}</a>'
            f'<span class="sp-f">{esc(fit)}</span>'
            f'<a class="sp-add" href="{QUOTE[lang]}?add={esc(code)}" rel="nofollow" data-shop="add">{PLUS}<span>{tr(ADD, lang)}</span></a></div></article>')

def grid(codes, lang): return '<div class="sp-g">' + ''.join(card(c, lang) for c in codes) + '</div>'
def href(h, lang):
    if h.startswith('/portal?'): return QUOTE[lang] + h[7:]
    return h if h.startswith(('/parts', 'http')) else PRE[lang] + h
def more(links, lang):
    return '<div class="sp-more">' + ''.join(f'<a href="{href(h, lang)}"{' rel="nofollow"' if "?" in h else ""}>{tr(t, lang)}{ARROW}</a>' for t, h in links) + '</div>'

CSS = '''<!--shop:css--><style id="shop-css">
.sp{margin-top:26px;padding-top:24px;border-top:1px solid #e3e6ea}
.sp-t{margin:0;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:17px;line-height:1.3;color:#1d2126}
.sp-s{margin:4px 0 0;font-size:14px;line-height:1.5;color:#6b7178}
.sp-g{margin-top:16px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.sp-c{display:flex;flex-direction:column;background:#f4f5f7;border-radius:18px;overflow:hidden;min-width:0;transition:box-shadow .25s,transform .25s}
.sp-c:hover{box-shadow:0 10px 26px rgba(29,33,38,.12);transform:translateY(-2px)}
.sp-ph{display:block;aspect-ratio:4/3;background:#fff;border-bottom:1px solid #e9ecef}
.sp-ph img{display:block;width:100%;height:100%;object-fit:contain}
.sp-b{display:flex;flex-direction:column;flex:1;padding:12px 12px 12px;min-width:0}
.sp-k{font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:11px;line-height:1.3;letter-spacing:.5px;text-transform:uppercase;color:#d32a37}
.sp-n{margin-top:5px;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:15px;line-height:1.3;color:#1d2126;overflow-wrap:anywhere}
.sp-n:hover{color:#d32a37}
.sp-f{margin:4px 0 12px;font-size:13px;line-height:1.4;color:#6b7178;flex:1}
.sp-add{display:flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:6px 10px;border-radius:50px;background:#1d2126;color:#fff;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:500;font-size:13px;line-height:1.2;text-align:center;transition:background .25s}
.sp-add:hover{background:#d32a37;color:#fff}
.sp-more{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px 18px}
.sp-more a{display:inline-flex;align-items:center;gap:6px;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:14px;color:#1e1e87}
.sp-more a:hover{color:#d32a37}
.sp-find{margin-top:26px;background:#1d2126;border-radius:24px;padding:24px 26px;color:#c9cdd2}
.sp-find b{display:block;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:19px;line-height:1.3;color:#fff}
.sp-find p{margin:6px 0 0;font-size:14px;line-height:1.5;color:#c9cdd2}
.sp-find form{margin-top:16px;display:flex;gap:8px}
.sp-find input{flex:1;min-width:0;height:50px;border:0;border-radius:50px;padding:0 20px;font:inherit;font-size:16px;color:#1d2126;background:#fff}
.sp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:50px;padding:0 24px;border:0;border-radius:50px;background:#d32a37;color:#fff;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:500;font-size:15px;white-space:nowrap;cursor:pointer;transition:background .25s}
.sp-btn:hover{background:#b3202c;color:#fff}
.sp-btn.w{background:#fff;color:#1d2126}.sp-btn.w:hover{background:#eef0f2;color:#1d2126}
.sp-btn.o{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}.sp-btn.o:hover{background:rgba(255,255,255,.1);color:#fff}
.sp-band{background:#1e1e87;border-radius:30px;padding:34px;color:#d8d9f2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px 30px}
.sp-band b{display:block;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:24px;line-height:1.25;color:#fff;letter-spacing:-.01em}
.sp-band p{margin:8px 0 0;max-width:520px;font-size:15px;line-height:1.55;color:#d8d9f2}
.sp-band div:last-child{display:flex;flex-wrap:wrap;gap:10px}
.sp-side{display:flex;align-items:center;justify-content:center;gap:8px;margin:12px 0 0;height:50px;border-radius:50px;background:#d32a37;color:#fff;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:500;font-size:15px;transition:background .25s}
.sp-side:hover{background:#b3202c;color:#fff}
.sp-sec{padding:0 20px 120px;box-sizing:border-box}
.sp-in{max-width:1320px;margin:0 auto}
.sp-kick{display:inline-block;border:1px solid rgba(29,33,38,.2);color:#d32a37;border-radius:50px;padding:0 14px;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:12px;line-height:25px;letter-spacing:.6px;text-transform:uppercase}
.sp-h2{margin:18px 0 0;max-width:760px;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;color:#1d2126;font-size:clamp(32px,3.5vw,50px);line-height:1.12;letter-spacing:-.02em}
.sp-lead{margin:16px 0 0;max-width:640px;font-size:17px;line-height:1.6;color:#5a5a60}
.sp-row{margin-top:16px;background:#fff;border-radius:30px;padding:30px}
.sp-row:first-of-type{margin-top:44px}
.sp-rh{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 20px}
.sp-rh h3{margin:0;font-family:'BDO Grotesk','Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:22px;line-height:1.25;color:#1d2126}
.sp-rh .sp-more{margin:0}
.sp-sec .sp-band{margin-top:16px}
.sp a,.sp-band a,.sp-find a{text-decoration:none!important}.sp-n{color:#1d2126!important}.sp-n:hover{color:#d32a37!important}.sp-add,.sp-btn{color:#fff!important}.sp-btn.w{color:#1d2126!important}.sp-more a{color:#1e1e87!important}.sp-more a:hover{color:#d32a37!important}
@media (max-width:1000px){.sp-g{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.sp-row{padding:20px 16px;border-radius:24px}.sp-band{padding:26px 22px;border-radius:24px}.sp-band b{font-size:21px}.sp-find{padding:22px 18px}.sp-find form{flex-direction:column}.sp-find input{flex:none;width:100%;box-sizing:border-box}.sp-btn{width:100%;box-sizing:border-box}.sp-band div:last-child{width:100%}.sp-g{gap:10px}.sp-b{padding:10px}.sp-n{font-size:14px}.sp-sec{padding-bottom:80px}}
</style><!--/shop:css-->'''

def strip(src):
    return re.sub(r'<!--shop:([a-z0-9-]+)-->.*?<!--/shop:\1-->', '', src, flags=re.S)
def wrap(key, body): return f'<!--shop:{key}-->{body}<!--/shop:{key}-->'
def once(src, anchor, repl, name):
    if src.count(anchor) != 1: sys.exit(f'{name}: anchor found {src.count(anchor)} times: {anchor[:70]}')
    return src.replace(anchor, repl)

# ---------------------------------------------------------------- guide
G_SECTIONS = [
 ('common-rail', ('The four parts of a common rail system', 'Las cuatro piezas de un sistema common rail', 'As quatro peças de um sistema common rail'),
  ('Example for the Ram Cummins 6.7L. Every part opens with the applications it fits.', 'Ejemplo para Ram Cummins 6.7L. Cada pieza abre con las aplicaciones que cubre.', 'Exemplo para Ram Cummins 6.7L. Cada peça abre com as aplicações que atende.'),
  ['BO.0.445.020.146', 'BO.0.445.226.126', 'BO.0.445.120.342', 'BO.0.281.006.117'],
  [(('All injectors', 'Todos los inyectores', 'Todos os injetores'), '/parts/c/injectors'), (('All high pressure pumps', 'Todas las bombas de alta presión', 'Todas as bombas de alta pressão'), '/parts/c/pumps'), (('Rails and lines', 'Rieles y líneas', 'Flautas e linhas'), '/parts/c/rails')]),
 ('system-types', ('Injectors for each system', 'Inyectores para cada sistema', 'Injetores para cada sistema'),
  ('Common rail, HEUI, heavy duty and mechanical, from the same warehouse in Florida.', 'Common rail, HEUI, pesados y mecánicos, del mismo depósito en Florida.', 'Common rail, HEUI, pesados e mecânicos, do mesmo estoque na Flórida.'),
  ['BO.0.445.120.008', 'AP.60901', 'BO.0.445.120.302', 'BO.0.432.131.715'],
  [(('Dodge / Ram Cummins parts', 'Repuestos Dodge / Ram Cummins', 'Peças Dodge / Ram Cummins'), '/parts/v/dodge-ram-cummins'), (('Chevy / GMC Duramax parts', 'Repuestos Chevy / GMC Duramax', 'Peças Chevy / GMC Duramax'), '/parts/v/chevy-gmc-duramax'), (('Ford Power Stroke parts', 'Repuestos Ford Power Stroke', 'Peças Ford Power Stroke'), '/parts/v/ford-power-stroke'), (('Heavy duty parts', 'Repuestos para pesados', 'Peças para pesados'), '/parts/v/heavy-duty')]),
 ('failures', ('The wear parts that fail first', 'Las piezas de desgaste que fallan primero', 'As peças de desgaste que falham primeiro'),
  ('Nozzle, control valve, solenoid and seals, sold one by one for rebuilders.', 'Tobera, válvula de control, solenoide y sellos, vendidos por unidad para reconstructores.', 'Bico, válvula de controle, solenoide e vedações, vendidos por unidade para retíficas.'),
  ['BO.0.433.171.985', 'BO.F.00R.J01.747', 'BO.F.00R.J02.697', 'BO.F.00R.J02.177'],
  [(('All nozzles', 'Todas las toberas', 'Todos os bicos injetores'), '/parts/c/nozzles'), (('All repair parts', 'Todos los repuestos de reparación', 'Todas as peças de reparo'), '/parts/c/repair-parts')]),
 ('contamination', ('Everything the repair needs, in one order', 'Todo lo que pide la reparación, en un solo pedido', 'Tudo o que o reparo pede, em um pedido só'),
  ('Contamination kits for the Ford 6.7L Power Stroke, or pump and rail on their own.', 'Kits de contaminación para Ford 6.7L Power Stroke, o bomba y riel por separado.', 'Kits de contaminação para Ford 6.7L Power Stroke, ou bomba e flauta separadas.'),
  ['MX.EC3Z-9B246-B', 'MX.HC3Z-9B246-B', 'BO.0.445.010.810', 'BO.0.445.218.017'],
  [(('How the contamination kits work', 'Cómo funcionan los kits de contaminación', 'Como funcionam os kits de contaminação'), '/contamination-kits'), (('Ford Power Stroke parts', 'Repuestos Ford Power Stroke', 'Peças Ford Power Stroke'), '/parts/v/ford-power-stroke')]),
 ('testing', ('Tool sets for the bench, by injector and pump family', 'Herramientas para el banco, por familia de inyector y bomba', 'Ferramentas para a bancada, por família de injetor e bomba'),
  ('Robiel sets to open, measure and close each unit to spec. ISO 4113 fluid ships from the same warehouse.', 'Juegos Robiel para abrir, medir y cerrar cada unidad según especificación. El fluido ISO 4113 sale del mismo depósito.', 'Jogos Robiel para abrir, medir e fechar cada unidade dentro da especificação. O fluido ISO 4113 sai do mesmo estoque.'),
  ['RB.323.50.102', 'RB.323.50.083', 'RB.323.50.34', 'RB.323.50.38'],
  [(('ISO 4113 fluid and degreasers', 'Fluido ISO 4113 y desengrasantes', 'Fluido ISO 4113 e desengraxantes'), '/fluids'), (('All 26 Robiel tool sets', 'Los 26 juegos Robiel', 'Os 26 jogos Robiel'), '/tool-sets'), (('Tools by part number', 'Herramientas por número de parte', 'Ferramentas por part number'), '/parts/c/tool-sets')]),
 ('rebuild', ('Rebuild it or replace it', 'Reconstruir o reemplazar', 'Recondicionar ou trocar'),
  ('Remanufactured units ready to install, or the kits to rebuild in your own shop.', 'Unidades remanufacturadas listas para instalar, o los kits para reconstruir en tu taller.', 'Unidades remanufaturadas prontas para instalar, ou os kits para recondicionar na sua oficina.'),
  ['BO.0.986.435.521', 'BO.0.986.437.334', 'JV.30.800.974', 'JV.10.805.176'],
  [(('Remanufactured parts in the store', 'Remanufacturados en la tienda', 'Remanufaturados na loja'), '/portal?q=reman'), (('All repair parts', 'Todos los repuestos de reparación', 'Todas as peças de reparo'), '/parts/c/repair-parts')]),
 ('genuine-aftermarket', ('Same part number, two options', 'El mismo número de parte, dos opciones', 'O mesmo part number, duas opções'),
  ('Genuine Bosch next to LEAD and Fratelli Bosio for the Duramax LBZ. You choose per job.', 'Bosch original junto a LEAD y Fratelli Bosio para Duramax LBZ. Tú eliges según el trabajo.', 'Bosch original ao lado de LEAD e Fratelli Bosio para Duramax LBZ. Você escolhe por serviço.'),
  ['BO.F.00R.J01.329', 'LD.F.00R.J01.329', 'BO.0.433.171.924', 'FB.BLLA158P1500'],
  [(('Brands we carry', 'Marcas que trabajamos', 'Marcas que trabalhamos'), '/injection-parts')]),
]
G_FIND = (('Already have the part number?', '¿Ya tienes el número de parte?', 'Já tem o part number?'),
          ('Search 4,500+ parts in Florida and add what you need to a quote. No account needed.', 'Busca entre más de 4.500 piezas en Florida y agrega lo que necesitas a una cotización. Sin crear cuenta.', 'Busque entre mais de 4.500 peças na Flórida e adicione o que precisa a uma cotação. Sem criar conta.'),
          ('Part number, e.g. 0445120342', 'Número de parte, ej. 0445120342', 'Part number, ex. 0445120342'), ('Search parts', 'Buscar piezas', 'Buscar peças'))
BAND = (('Buying for a shop, a lab or a fleet?', '¿Compras para un taller, un laboratorio o una flota?', 'Compra para oficina, laboratório ou frota?'),
        ('Open a wholesale account to see your prices and order online, or send the list and we quote it the same business day.', 'Abre una cuenta mayorista para ver tus precios y pedir en línea, o envía la lista y la cotizamos el mismo día hábil.', 'Abra uma conta de atacado para ver seus preços e pedir online, ou envie a lista e cotamos no mesmo dia útil.'),
        ('Open a wholesale account', 'Abrir cuenta mayorista', 'Abrir conta de atacado'), ('Send my list', 'Enviar mi lista', 'Enviar minha lista'), ('WhatsApp sales', 'Ventas por WhatsApp', 'Vendas por WhatsApp'))
SIDE = ('Start a quote', 'Iniciar cotización', 'Iniciar cotação')

def band(lang, key):
    return wrap(key, f'<div class="sp-band"><div><b>{tr(BAND[0], lang)}</b><p>{tr(BAND[1], lang)}</p></div><div>'
                f'<a class="sp-btn w" href="/portal#/request" data-shop="account">{tr(BAND[2], lang)}</a>'
                f'<a class="sp-btn o" href="{QUOTE[lang]}" data-shop="list">{tr(BAND[3], lang)}</a>'
                f'<a class="sp-btn o" href="{WA}" target="_blank" rel="noopener" data-shop="whatsapp">{tr(BAND[4], lang)}</a></div></div>')

def guide(lang):
    p = ROOT / (PRE[lang].strip('/')) / 'guides' / 'diesel-fuel-injection.html'
    src = strip(p.read_text(encoding='utf-8')); n = p.name
    src = once(src, '</head>', CSS + '</head>', n)
    find = wrap('find', f'<div class="sp-find"><b>{tr(G_FIND[0], lang)}</b><p>{tr(G_FIND[1], lang)}</p>'
                f'<form action="{QUOTE[lang]}" method="get" role="search"><input type="search" name="q" required autocomplete="off" aria-label="{tr(G_FIND[2], lang)}" placeholder="{tr(G_FIND[2], lang)}"><button class="sp-btn" type="submit">{tr(G_FIND[3], lang)}</button></form></div>')
    div = '<div style="height: 1px; background: #d9dde1; margin: 44px 0;"></div>'
    src = once(src, '</ul></div>' + div, '</ul></div>' + find + div, n)
    for sid, t, s, codes, links in G_SECTIONS:
        a = src.find(f'<section id="{sid}"'); b = src.find('</section>', a)
        if a < 0 or b < 0: sys.exit(f'{n}: section {sid} not found')
        mod = wrap('g-' + sid, f'<div class="sp"><h3 class="sp-t">{tr(t, lang)}</h3><p class="sp-s">{tr(s, lang)}</p>{grid(codes, lang)}{more(links, lang)}</div>')
        tail = band(lang, 'band') if sid == 'contamination' else ''
        src = src[:b] + mod + '</section>' + tail + src[b + len('</section>'):]
    src = once(src, '</nav></div><div class="call-blue"', '</nav>' + wrap('side', f'<a class="sp-side" href="{QUOTE[lang]}" data-shop="side">{tr(SIDE, lang)}{ARROW}</a>') + '</div><div class="call-blue"', n)
    p.write_text(src, encoding='utf-8')
    return src.count('class="sp-c"')

# ---------------------------------------------------------------- pillar page
P_KICK = ('Most requested', 'Los más pedidos', 'Mais pedidos')
P_H2 = ('Parts shops order every week', 'Las piezas que los talleres piden cada semana', 'As peças que as oficinas pedem toda semana')
P_LEAD = ('Pick the part, add it to your list and send it. We answer with price and availability the same business day.', 'Elige la pieza, agrégala a tu lista y envíala. Respondemos con precio y disponibilidad el mismo día hábil.', 'Escolha a peça, adicione à sua lista e envie. Respondemos com preço e disponibilidade no mesmo dia útil.')
ALL = ('See all', 'Ver todo', 'Ver tudo'); STORE = ('Open in the store', 'Abrir en la tienda', 'Abrir na loja')
P_ROWS = [
 (('Dodge / Ram Cummins', 'Dodge / Ram Cummins', 'Dodge / Ram Cummins'), ['BO.0.445.120.342', 'BO.0.445.020.146', 'BO.0.445.226.126', 'JV.30.800.974'], '/parts/v/dodge-ram-cummins', '?make=ram'),
 (('Chevy / GMC Duramax', 'Chevy / GMC Duramax', 'Chevy / GMC Duramax'), ['BO.0.445.120.082', 'BO.0.445.020.105', 'BO.F.00R.L00.143', 'BO.0.986.435.521'], '/parts/v/chevy-gmc-duramax', '?make=gm'),
 (('Ford Power Stroke', 'Ford Power Stroke', 'Ford Power Stroke'), ['BO.0.445.117.043', 'BO.0.986.437.441', 'BO.0.445.218.017', 'MX.HC3Z-9B246-B'], '/parts/v/ford-power-stroke', '?make=ford'),
 (('Heavy duty', 'Pesados', 'Pesados'), ['BO.0.445.120.303', 'DE.EX551001', 'LD.2894829', 'LD.No2'], '/parts/v/heavy-duty', '?make=hd'),
 (('Rebuilder supply', 'Para reconstructores', 'Para retíficas e laboratórios'), ['BO.0.433.171.924', 'FB.BLLA158P1500', 'BO.F.00R.J01.329', 'LD.F.00R.J01.329'], '/parts/c/repair-parts', '?q=control+valve'),
]

def pillar(lang):
    p = ROOT / (PRE[lang].strip('/')) / 'injection-parts.html'
    src = strip(p.read_text(encoding='utf-8')); n = p.name
    src = once(src, '</head>', CSS + '</head>', n)
    rows, items = '', []
    for t, codes, allh, q in P_ROWS:
        rows += (f'<div class="sp-row"><div class="sp-rh"><h3>{tr(t, lang)}</h3>'
                 + more([(ALL, allh), (STORE, '/portal' + q)], lang)
                 + f'</div>{grid(codes, lang)}</div>')
        items += codes
    seen = []
    for c in items:
        if c not in seen: seen.append(c)
    ld = {"@context": "https://schema.org", "@type": "ItemList", "name": tr(P_H2, 'en'),
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f'{SITE}/parts/{slug(c)}', "name": specs[c]['title']} for i, c in enumerate(seen)]}
    sec = (f'<section id="shop" class="sp-sec" style="scroll-margin-top: 130px;"><div class="sp-in"><span class="sp-kick">{tr(P_KICK, lang)}</span><h2 class="sp-h2">{tr(P_H2, lang)}</h2><p class="sp-lead">{tr(P_LEAD, lang)}</p>'
           f'{rows}{band(lang, "band")}</div>'
           + (('<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>') if lang == 'en' else '') + '</section>')
    anchor = '</div></section><section style="padding: 0 20px 120px; box-sizing: border-box;">'
    src = once(src, anchor, '</div></section>' + wrap('pillar', sec) + anchor[len('</div></section>'):], n)
    p.write_text(src, encoding='utf-8')
    return src.count('class="sp-c"')

if __name__ == '__main__':
    for l in LANGS: print(l, 'guide cards', guide(l), '| pillar cards', pillar(l))
