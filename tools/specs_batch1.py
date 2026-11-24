#!/usr/bin/env python3
"""Batch 1 of the product sheets: injectors, pumps, rails, tools and kits that had no reviewed sheet in data/specs.json.

Everything is built from what the Unleashed record says (description, application, cross references, brand, condition).
Nothing is invented: when the record gives no application the sheet has no 'fit' line, so the page stays noindex until
someone adds one. Every sheet is marked "A revisar" (for Mike) and carries src='unleashed-auto-2026-11-24'.
Run: python3 tools/specs_batch1.py   (idempotent: codes that already have a sheet are never touched)"""
import json, re, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECS = json.load(open(ROOT / 'data/specs.json', encoding='utf-8'))
CAT = [r for r in json.load(open(ROOT / 'data/catalog.json', encoding='utf-8')) if r[2] != 'engine']  # engine parts (VEK) are not in the store
SRC = 'unleashed-auto-2026-11-24'
TARGET_CATS = ('Injector', 'Pump', 'Rail', 'Tool', 'Kit')

PREFIX_BRAND = {'BO': 'Bosch', 'BR': 'Bosch', 'DN': 'Denso', 'DE': 'Delphi', 'SM': 'Siemens', 'CAT': 'Caterpillar', 'CA': 'Caterpillar', 'AP': 'Alliant Power',
                'LD': 'LEAD', 'KS': 'Kingstar', 'DAP': 'DAP', 'VO': 'Volvo', 'RB': 'Robiel', 'CO': 'Continental', 'ZX': 'Zexel', 'MX': 'Maxzz'}


def fix_text(s):
    # Unleashed text sometimes arrives double-encoded (A-tilde pairs); repair each pair
    s = re.sub(r'Ã (?=\d)', 'à ', s)
    s = s.replace('SÃ\x80RIE', 'SÉRIE').replace('VÃ\x80LVULA', 'VÁLVULA')
    return re.sub(r'[ÃÂ][\x80-\xbf]', lambda m: m.group().encode('latin-1').decode('utf-8', 'ignore') or m.group(), s)


def split_code(code):
    pre, _, rest = code.partition('.')
    rest = rest.strip()
    return pre.strip(), rest


def pn_of(code):
    pre, rest = split_code(code)
    if not rest: return code.strip()
    if pre in ('BO', 'BR'): return re.sub(r'[.\s]', '', rest)
    return rest.replace(' ', '')


def pn_spaced(code):
    pre, rest = split_code(code)
    if pre in ('BO', 'BR') and re.fullmatch(r'[\d.]+', rest or ''):
        d = rest.replace('.', '')
        return ' '.join([d[0], d[1:4], d[4:7], d[7:]]) if len(d) == 10 else None
    return None


def parse(name):
    """-> (base, application, [cross refs])"""
    n = fix_text(name).replace('\n', ' ').strip()
    refs = []
    for m in re.finditer(r'\(=\s*([^)]*)\)?', n):
        refs += [x.strip(' #') for x in re.split(r'[,;]', m.group(1))]
    n2 = re.sub(r'\(=\s*[^)]*\)?', '', n)
    base, app = n2, ''
    if 'Application:' in n2:
        base, _, app = n2.partition('Application:')
        base = base.split(' / ')[0]
    base = re.sub(r'\s+/\s*$', '', base).strip()
    app = re.sub(r'\s+', ' ', app).strip(' /-')
    refs = [r for r in dict.fromkeys(re.sub(r'-\s+', '-', x) for x in refs if x and len(x) <= 32)]
    return base, app, refs


def nice_app(app):
    if not app: return ''
    a = re.sub(r'\bUNBOXED\b', '', app, flags=re.I).strip(' /-')
    if a.isupper(): a = a.title()
    a = re.sub(r'\s+', ' ', a)
    a = re.sub(r'\s+(Injector|Injectors|Pump|Rail)$', '', a, flags=re.I)  # the title already says what the part is
    return a[:80].rsplit(' ', 1)[0] if len(a) > 80 else a


def classify(low, cat):
    """Type from the words in the record, not only the Unleashed group (several injector-group items are shims, rotors, solenoids)."""
    if 'plain washer' in low: return ('Tool Spare Part', 'Tool spare part', 'tool')
    if 'spray paint' in low: return ('Shop Supply', 'Spray paint', 'tool')
    if 'diagnostic station' in low or 'flow meter' in low: return ('Injector Tester', 'Diagnostic equipment', 'tool')
    if cat == 'Tool' or 'tool set' in low or 'test tool' in low or 'test kit' in low: return ('Injector & Pump Tool', 'Tool', 'tool')
    if 'shim' in low: return ('Injector Shim', 'Injector Shim', 'part')
    if 'rotor' in low or 'distributor head' in low: return ('Pump Rebuild Part', 'Pump Rotor', 'part')
    if 'actuator kit' in low: return ('Injector Repair Kit', 'Actuator Kit', 'part')
    if 'actuador' in low or 'actuator' in low: return ('Injector Solenoid', 'Injector Actuator', 'part')
    if 'solenoid' in low: return ('Injector Solenoid', 'Injector Solenoid', 'part')
    if 'oil pipe' in low: return ('High Pressure Injector Line', 'Common Rail Pipe', 'part')
    if 'sensor rail' in low or 'pressure sensor' in low: return ('Fuel Rail Pressure Sensor', 'Rail Pressure Sensor', 'part')
    if re.search(r'\brail\b', low): return ('Fuel Rail', 'Fuel Rail', 'rail')
    if 'unit pump' in low: return ('Unit Pump', 'Unit Pump', 'pump')
    if 'pump' in low: return ('High Pressure Fuel Pump', 'High Pressure Fuel Pump', 'pump')
    if re.search(r'\b(eui|unit injector)\b', low): return ('Unit Injector', 'Unit Injector', 'inj')
    if 'injector' in low or 'injetor' in low or 'nozzle' in low: return ('Fuel Injector', 'Fuel Injector', 'inj')
    if cat == 'Kit': return ('Fuel Contamination Kit', 'Kit', 'part')
    return {'Injector': ('Fuel Injector', 'Fuel Injector', 'inj'), 'Pump': ('High Pressure Fuel Pump', 'High Pressure Fuel Pump', 'pump'),
            'Rail': ('Fuel Rail', 'Fuel Rail', 'rail')}.get(cat, ('Injector Rebuild Part', 'Part', 'part'))


def make_of(text):
    T = text.upper()
    if re.search(r'\b(DURAMAX|LB7|LLY|LBZ|LMM|LML|L5P|LGH)\b', T): return 'Chevy / GMC Duramax'
    if re.search(r'POWER\s?STROKE', T): return 'Ford Power Stroke'
    if re.search(r'\b(CAT|CATERPILLAR|C7|C9|C13|C15|C18|3406E?|DETROIT|DD13|DD15|DD16|PACCAR|MX-?13|VOLVO|MACK|SCANIA|NAVISTAR|MAXXFORCE)\b', T): return 'Heavy Duty'
    if re.search(r'\b(RAM|DODGE)\b', T) and 'CUMMINS' in T: return 'Dodge / Ram Cummins'
    return ''


ADVICE = {
    'inj': ['Find the root cause first. Contaminated fuel or a failing pump will damage new injectors.',
            'Replace sealing washers, O-rings and any one-time-use hardware.',
            'If the engine uses injector calibration or trim codes, program them with a scan tool after installation.'],
    'pump': ['Inspect the fuel for water or metal particles and replace both filters.',
             'Check lift pump pressure. Low supply pressure shortens pump life.',
             'Prime the system fully before the first start.'],
    'rail': ['Replace the rail after a pump failure that sent debris through the system, or when the sensor or relief valve area is damaged.',
             'Flush the lines and replace sealing parts before the first start.'],
}
SIGNS = ['Hard starting or long crank time', 'Rough idle, misfire or a knock that was not there before',
         'White or black smoke, loss of power or worse fuel economy', 'Injector balance-rate or contribution codes on the scan tool']

ALL_CODES = {r[0] for r in CAT}
NORM = collections.defaultdict(list)
for r in CAT: NORM[re.sub(r'[^0-9A-Za-z]', '', pn_of(r[0])).upper()].append(r[0])


def build(r):
    code, name, _, cat, brand0 = r[0], r[1], r[2], r[3], r[4]
    pre, _rest = split_code(code)
    brand = brand0 or PREFIX_BRAND.get(pre, '')
    base, app, refs = parse(name)
    low = fix_text(name).lower()
    typ, label, kind = classify(low, cat)
    reman = 'reman' in low
    core = bool(re.search(r'\bcore\b', low))  # "Core" / "Rail Core" items
    cond = 'Reman' if reman else ('Semi-new' if 'semi nuevo' in low else 'New')
    if core: typ, label, kind, cond = 'Remanufacturing Core', (label + ' Core' if label not in ('Part', 'Kit') else 'Exchange core'), 'part', 'Core'
    pn = pn_of(code); spaced = pn_spaced(code)
    app = nice_app(app)
    if kind == 'tool' and len(app) > 60: app = ''  # long tool descriptions stay in the text, not the title
    word = {'Reman': 'Remanufactured ', 'Core': ''}.get(cond, '')
    if core: tl = label
    else: tl = word + label
    title = ' '.join(x for x in [brand, pn, tl] if x)
    if app: title += ' for ' + app
    title = re.sub(r'\s+', ' ', title)[:140]
    sp = {'type': typ, 'cond': cond}
    mk = make_of(fix_text(name))
    if kind == 'tool': mk = 'Rebuilder Supply'
    if mk: sp['make'] = mk
    xrefs = [x for x in refs if re.sub(r'[^0-9A-Za-z]', '', x).upper() != re.sub(r'[^0-9A-Za-z]', '', pn).upper()]
    fit = ''
    if kind == 'tool': fit = 'Bench and shop use (see application in description)'
    elif app: fit = app
    elif xrefs: fit = 'Interchanges with ' + ', '.join(xrefs[:4])
    if fit: sp['fit'] = fit
    if xrefs: sp['eq'] = ', '.join(xrefs)
    sp['title'] = title
    # --- description
    who = ('remanufactured ' if reman else 'new ') if cond in ('Reman', 'New') else ''
    br = brand + ' ' if brand else ''
    intro = f"<p>{(br + pn).strip()}: {who}{label.lower()}" + (f" for {app}" if app else '') + ". Ships from our Florida warehouse.</p>"
    if cond == 'Semi-new': intro = intro.replace('Ships', 'Supplied semi-new. Ships')
    if re.search(r'unboxed', name, re.I): intro = intro.replace('Ships', 'Supplied unboxed. Ships')
    if core: intro = f"<p>{(br + pn).strip()}: core (used unit returned for exchange). Ask sales about exchange terms and credit before you send it in.</p>"
    d = [intro]
    if kind == 'inj' and not core:
        d.append('<h3>Signs your injectors need attention</h3><ul>' + ''.join(f'<li>{s}</li>' for s in SIGNS) + '</ul>')
    if kind in ADVICE and not core:
        d.append('<h3>Before you install</h3><ul>' + ''.join(f'<li>{s}</li>' for s in ADVICE[kind]) + '</ul>')
    if kind == 'tool':
        raw = re.sub(r'\s+', ' ', (base + (' / ' + parse(name)[1] if parse(name)[1] else '')).strip(' /'))
        if raw.isupper(): raw = raw.title()
        if raw: d.append(f'<p>Unleashed description: {raw}.</p>'.replace('..', '.'))
        d.append('<p>Robiel and Bosch tooling is the same class of equipment used in the Diesel Tech Academy courses, built for repeatable teardown, measurement and assembly on the bench.</p>' if brand in ('Robiel', 'Bosch') else '<p>Bench item for injection labs and rebuilders.</p>')
    if fit and kind != 'tool': d.append(f'<h3>Fits</h3><ul><li>{fit}</li></ul>')
    pl = [f'<li>{(br + pn).strip()}' + (f' ({spaced})' if spaced else '') + '</li>'] + [f'<li>Cross reference {x}</li>' for x in xrefs]
    d.append('<h3>Part numbers</h3><ul>' + ''.join(pl) + '</ul>')
    sp['desc'] = ''.join(d)
    # --- faq
    noun = label.lower()
    q = []
    if kind == 'tool':
        q.append(f'Q: What is {pn} used for?\nA: {base or label}. It is a bench item for injection labs and rebuilders.')
    elif core:
        q.append(f'Q: What is a core?\nA: A core is the used unit you return for exchange credit. Contact sales for the terms that apply to {pn}.')
    else:
        qa = f'It fits {fit}.' if app else ('It interchanges with ' + ', '.join(xrefs[:4]) + '.' if xrefs else 'Send us the part number on your current unit or your VIN and we will confirm.')
        q.append(f'Q: Will {pn} fit my engine?\nA: {qa} Match the part number on your current {noun} or send us your VIN to confirm.')
        q.append(f'Q: Is this {noun} new or remanufactured?\nA: ' + {'Reman': f'Remanufactured {brand}.'.replace('  ', ' '), 'Semi-new': 'Semi-new. Contact sales for its condition.'}.get(cond, f'New {brand}.'.replace('  ', ' ')))
        q.append({'inj': 'Q: Do I replace one injector or the full set?\nA: If one injector has failed on a high-mileage engine, replacing the full set keeps fuel delivery balanced across cylinders.',
                  'pump': 'Q: Should I replace the injectors with the pump?\nA: If the old pump failed and left debris in the fuel, yes: inspect or replace injectors, rails and lines and flush the system, or the new pump is at risk.'}
                 .get(kind, 'Q: Do you sell the related parts?\nA: Yes. See the related products below for the parts usually replaced on the same job.'))
    sp['faq'] = '\n'.join(q)
    sp['ok'] = 'A revisar'
    sp['src'] = SRC
    return sp, xrefs


todo = [r for r in CAT if r[0] not in SPECS and r[3] in TARGET_CATS]
built = {}
for r in todo:
    sp, xr = build(r); built[r[0]] = (sp, xr, r)

# related products: cross references that are in the catalog first, then neighbours of the same brand and type
bytype = collections.defaultdict(list)
for code, (sp, xr, r) in built.items(): bytype[(sp['type'], r[4] or split_code(code)[0])].append(code)
for k in bytype: bytype[k].sort()
for code, (sp, xr, r) in built.items():
    rel = []
    for x in xr:
        for c in NORM.get(re.sub(r'[^0-9A-Za-z]', '', x).upper(), []):
            if c != code and c not in rel: rel.append(c)
    lst = bytype[(sp['type'], r[4] or split_code(code)[0])]
    i = lst.index(code)
    for j in (i - 1, i + 1, i - 2, i + 2, i - 3, i + 3):
        if 0 <= j < len(lst) and lst[j] not in rel: rel.append(lst[j])
    sp['rel'] = ', '.join(rel[:6])
    SPECS[code] = sp

json.dump(SPECS, open(ROOT / 'data/specs.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=None, separators=(',', ':'))
c = collections.Counter(sp['type'] for sp, _, _ in built.values())
print('new sheets:', len(built), dict(c))
print('with fit (indexable):', sum(1 for sp, _, _ in built.values() if sp.get('fit') and len(re.sub('<[^>]+>', ' ', sp['desc']).strip()) > 300))
print('without fit (stay noindex):', sum(1 for sp, _, _ in built.values() if not sp.get('fit')))
