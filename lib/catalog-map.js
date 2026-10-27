// Maps Unleashed product groups and descriptions to the compact catalog used by the quote page.
// Row format: [code, description, iconSlug, category, brand, market, engines]
const ENGINES = {
  d: /\b(DURAMAX|LB7|LLY|LBZ|LMM|LML|L5P|LGH)\b|\bGM\b.*6\.6/,
  c: /\b(CUMMINS|ISB|ISC|ISL|ISX|ISX15|QSB|QSC|QSL|XPI)\b|\bDODGE\b|\bRAM\b/,
  f: /POWER\s?STROKE|\bFORD\b/,
  h: /\b(CAT|CATERPILLAR|C7|C9|C13|C15|C18|DETROIT|DD13|DD15|DD16|PACCAR|MX13|MX-13|VOLVO|D11|D13|D16|MACK|SCANIA|NAVISTAR|MAXXFORCE|ISX|ISX15|X15)\b/
};
function category(group) {
  const G = (group || '').toUpperCase();
  if (!G || G.startsWith('CORE') || G.includes('ADDED SERVICES')) return null;
  if (G.includes('FLUID')) return ['fluids', 'Fluid'];
  if (G.includes('CONTAMINATION')) return ['kits', 'Kit'];
  if (G.includes('TOOL')) return ['tool', 'Tool'];
  if (G.includes('SLP') || G.includes('ENGINE')) return ['engine', 'Engine parts'];
  if (G.includes('INJECTOR') || G === 'UNITS' || G === 'US UNITS') return ['injectors', 'Injector'];
  if (G.includes('HPP') || G.includes('PUMP')) return ['pumps', 'Pump'];
  if (G.includes('RAIL')) return ['rail', 'Rail'];
  if (G.includes('NOZZLE') && !G.includes('SHIM')) return ['nozzle', 'Nozzle'];
  return ['seal', 'Repair part'];
}
const BRAND_FIX = { Slp: 'SLP', Lead: 'LEAD', Dap: 'DAP', Maxzz: 'Maxzz' };
function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
function toRow(p) {
  const cat = category(p.group);
  const desc = String(p.description || '').replace(/\s+/g, ' ').trim();
  if (!cat || !p.code || !desc) return null;
  const G = (p.group || '').toUpperCase();
  const market = G.startsWith('US') ? 'US' : G.startsWith('LATAM') ? 'LATAM' : '';
  const D = desc.toUpperCase();
  const engines = Object.keys(ENGINES).filter((k) => ENGINES[k].test(D)).join('');
  let brand = p.brand ? titleCase(String(p.brand)) : '';
  brand = BRAND_FIX[brand] || brand;
  return [String(p.code).trim(), desc, cat[0], cat[1], brand, market, engines];
}
module.exports = { toRow };
