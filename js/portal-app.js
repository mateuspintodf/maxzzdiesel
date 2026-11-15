/* Maxzz B2B store (petite-vue).
   Open catalog for everyone; prices, stock, cart and orders only for signed-in, approved customers.
   Anonymous visitors can add parts to the quote list (/quote), the same list the rest of the site uses. */
(function () {
  var CK = 'mx-portal-cart', QK = 'mx-quote', FGC = {};
  // featured parts whose Unleashed text reads badly; wording only, same part and numbers
  var BRP = { BO: 'Bosch', DN: 'Denso', ZX: 'Zexel', DE: 'Delphi', FB: 'Fratelli Bosio', JV: 'Java', LD: 'Lead', RB: 'Robiel', CO: 'Continental', SI: 'Siemens', VO: 'Volvo Penta', CAT: 'Caterpillar', AP: 'Alliant Power' };
  var TFIX = { 'BO.0.414.702.010': 'Bosch Unit Pump for Volvo Penta, Fits Volvo L180E and L180E HL' };
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/portal/' + path, { method: opts.body ? 'POST' : 'GET', credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function track(ev, p) { try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: ev }, p || {})); } catch (e) {} }
  // "Fuel Injector / Application: 13-18 6.7L DODGE CUMMINS / (= 0.986.435.621)" -> title, application, cross refs
  function parse(desc) {
    var d = String(desc || ''), xr = [], m = d.match(/\(=\s*([^)]*)\)/);
    if (m) { xr = m[1].split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean); d = d.replace(m[0], ''); }
    d = d.replace(/\s*=\s*([A-Z0-9][A-Z0-9.\u2011#-]{3,})/gi, function (_, c) { xr.push(c.replace(/#$/, '')); return ''; });
    d = d.replace(/\s*=+>?\s*([^\/]*)/, function (_, c) { c = c.replace(/[()#\s]+$|^[()\s-]+/g, ''); if (c) xr.push(c); return ' '; }).replace(/[#\/\s]+$/, '');
    d = d.replace(/\s*\b(?:Pck|Pack)\s*(?:=|of)\s*\d+\s*(?:pcs\.?)?/gi, '').replace(/\s+,/g, ',').replace(/,(?=\S)/g, ', ').replace(/\s{2,}/g, ' ');
    var parts = d.split(/\s*\/\s*Application:\s*/i);
    var title = (parts[0] || '').replace(/\s*\/\s*$/, '').trim();
    var app = (parts[1] || '').replace(/\s*\/\s*$/, '').replace(/\s*\/\s*/g, ' · ').trim();
    if (!parts[1] && title.indexOf(' / ') > 0) { var p2 = title.split(' / '); title = p2.shift(); app = p2.join(' · '); }
    return { title: title || desc, app: app, xr: xr };
  }
  // catalog text from Unleashed comes in mixed shouting case; one consistent case for every title and application line
  var ACR = 'GMC CDI FTV HDI DCI MWM MBB CRIN DMAX TDCI UIS SN OE OEM HEUI EUI EUP PDE SLP PLD SCV ISX ISB ISC ISL ISM QSB QSC QSK QSL QSM QSX CAT STD DPF DEF EGR SCR HD GM CR VE USA ECM ECU VGT HPCR HP DAF MAN BMW PSG EDC NPT UI UP UPS RBD LML LMM LBZ LLY LB7 L5P CP1 CP2 CP3 CP4 VP29 VP30 VP44 DT466 DT530 VW JCB JD MTU DDC MBE OM IDI DI TDI CRDI PSI NBR FKM PTFE ISO SAE SST HPI PT IVECO DAF NV RPM ID OD TDC EPA UK EU USB LED NO NC DC AC II III IV'.split(' ');
  var SMALL = ['for', 'and', 'with', 'of', 'to', 'in', 'on', 'or', 'the', 'a', 'an', 'by', 'from'];
  function nice(t) {
    t = String(t || '').replace(/\s*\(=\s*[^)]*\)/g, '').replace(/\b(?:Category|Description)\s*:\s*/gi, '').replace(/\s*:\s*$/, '').replace(/\s+NEW\s*:?\s*$/i, '').trim();
    // units: "2,95MM" / "2.80 MM" -> "2.95 mm"
    t = t.replace(/(\d)[,.](\d+)\s*MM\b/gi, '$1.$2 mm').replace(/(\d)\s*MM\b/gi, '$1 mm');
    var i = 0, lowAll = t === t.toLowerCase();
    return t.split(/(\s+)/).map(function (tok) {
      if (/^\s+$/.test(tok) || !tok) return tok;
      var first = i++ === 0;
      if (/\d/.test(tok)) return tok;               // part numbers, model codes, sizes: exactly as written
      return tok.replace(/[A-Za-z][A-Za-z']*/g, function (w) {
        var up = w.toUpperCase();
        if (ACR.indexOf(up) >= 0 && w.length >= 3) return up;
        if (w !== up && !lowAll && !/^[a-z][A-Z]+$/.test(w)) return first && /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w;  // mixed case: keep as written
        if (up === 'NOX') return 'NOx';
        if (up === 'MM') return 'mm';
        if (lowAll && w.length < 3 && SMALL.indexOf(w) < 0) return up;
        if (ACR.indexOf(up) >= 0 || w.length < 3 && up !== 'NO') return w;
        var lw = w.toLowerCase();
        if (!first && SMALL.indexOf(lw) >= 0) return lw;
        return lw.charAt(0).toUpperCase() + lw.slice(1);
      });
    }).join('').replace(/(\w)-(?=\w)/g, '$1\u2011');
  }
  var CATS = [
    { k: 'Injector', label: 'Injectors', ic: 'inj' }, { k: 'Pump', label: 'Pumps', ic: 'pump' }, { k: 'Nozzle', label: 'Nozzles', ic: 'noz' },
    { k: 'Rail', label: 'Rails', ic: 'rail' }, { k: 'Repair part', label: 'Repair parts', ic: 'rep' }, { k: 'Tool', label: 'Tool sets', ic: 'tool' },
    { k: 'Engine parts', label: 'Engine parts', ic: 'eng' }, { k: 'Fluid', label: 'Fluids', ic: 'fl' }, { k: 'Kit', label: 'Contamination kits', ic: 'kit' }
  ];
  var ENG = [{ k: 'f', label: 'Ford · Power Stroke' }, { k: 'c', label: 'Ram / Dodge · Cummins' }, { k: 'd', label: 'Chevy / GMC · Duramax' }, { k: 'h', label: 'Heavy duty trucks' }];
  // bench photos, validation batch for Mike (generated from the Unleashed photo of each part); key = part number
  var BENCH = {
    'BO.0.414.702.010': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020640_6e196d8f-e906-45f1-86e8-68629f314d7d.png',
    'BO.0.433.171.931': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020640_d8f97dd0-8faf-438c-9a55-3f4fe91301dd.png',
    'BO.0.445.020.175': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020640_b8e0e64b-047a-461e-bb82-e26dbfc39136.png',
    'BO.0.445.110.189': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020640_398363ea-96de-4fdb-a3e7-372aa4a5a7dc.png',
    'BO.0.445.110.307': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020642_25d26efc-0932-4a34-a596-bc2b0a59d3a8.png',
    'BO.0.445.115.078': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020642_ad34ef47-80dc-41e3-82f0-7e9eb73dc9a5.png',
    'BO.0.445.120.330': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020641_db2b54bc-14f3-49cf-ae05-a88932162c77.png',
    'BO.0.986.435.504': 'https://d8j0ntlcm91z4.cloudfront.net/user_3H0oOAtHplz8jxDIim1TQJWBSuO/hf_20261114_020640_5dbe675d-d06b-4875-9bdf-70e22fe9b68a.png'
  };
  // search index per row: normalized code (with and without the 2-letter brand prefix) + normalized cross refs
  var SIX = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function six(x) {
    var v = SIX && SIX.get(x); if (v) return v;
    var c = norm(x[0]), t = parse(x[1]);
    v = { c: c, c2: c.replace(/^[A-Z]{2}(?=\d)/, ''), xr: t.xr.map(norm).filter(function (z) { return z.length >= 4; }), t: (t.title || '').toLowerCase(), hay: (x[1] + ' ' + x[0] + ' ' + (x[4] || '') + ' ' + (x[3] || '')).toLowerCase() };
    if (SIX) SIX.set(x, v); return v;
  }
  function matchSearch(list, a) {
    var nq = norm(a), words = String(a).toLowerCase().split(/\s+/).filter(Boolean), sc = [];
    var catw = words.map(function (w) { return w.replace(/s$/, ''); });
    list.forEach(function (x) {
      var s = six(x), score = 0;
      if (nq.length >= 3) {
        if (s.c === nq || s.c2 === nq || s.xr.indexOf(nq) >= 0) score = 1000;
        else if (s.c.indexOf(nq) === 0 || s.c2.indexOf(nq) === 0) score = 800;
        else if (s.xr.some(function (z) { return z.indexOf(nq) === 0; })) score = 700;
        else if (s.c.indexOf(nq) >= 0 || s.xr.some(function (z) { return z.indexOf(nq) >= 0; })) score = 500;
      }
      if (!score && words.length && words.every(function (w) { return s.hay.indexOf(w) >= 0; })) {
        score = 100;
        var cat = String(x[3] || '').toLowerCase();
        if (catw.some(function (w) { return w.length > 2 && cat.indexOf(w) === 0; })) score += 60;
        if (words.some(function (w) { return s.t.indexOf(w) === 0; })) score += 30;
        else if (words.every(function (w) { return s.t.indexOf(w) >= 0; })) score += 15;
      }
      if (score) sc.push([score, x]);
    });
    sc.sort(function (p, q) { return q[0] - p[0]; });
    return sc.map(function (z) { return z[1]; });
  }
  function exactHit(list, a) {
    var nq = norm(a); if (nq.length < 5) return null;
    var own = list.filter(function (x) { var s = six(x); return s.c === nq || s.c2 === nq; });
    if (own.length === 1) return own[0]; if (own.length) return null;
    var xr = list.filter(function (x) { return six(x).xr.indexOf(nq) >= 0; });
    return xr.length === 1 ? xr[0] : null;
  }
  // category icons (24px line, drawn for the store)
  var ICONS = {
    "home": "<path d=\"M4 11l8-6.5 8 6.5\"/><path d=\"M6 9.5V20h12V9.5\"/><path d=\"M10 20v-5h4v5\"/>",
    "inj": "<path d=\"M10 3h4v3h-4z\"/><rect x=\"8.5\" y=\"6\" width=\"7\" height=\"9\" rx=\"1.5\"/><path d=\"M15.5 9H19\"/><path d=\"M11 15h2l-.4 4.5h-1.2z\"/><path d=\"M12 19.5V21\"/>",
    "pump": "<circle cx=\"11\" cy=\"13.5\" r=\"6\"/><circle cx=\"11\" cy=\"13.5\" r=\"2\"/><path d=\"M17 13.5h4\"/><path d=\"M9.5 7.5V4.5h3v3\"/>",
    "noz": "<path d=\"M10 3h4v4h-4z\"/><path d=\"M10.6 7h2.8l-.6 10.5h-1.6z\"/><path d=\"M12 17.5V19\"/><path d=\"M9 21.5l1.5-1.5M15 21.5L13.5 20M12 21.5V21\"/>",
    "rail": "<rect x=\"3\" y=\"10\" width=\"18\" height=\"4.5\" rx=\"2.25\"/><path d=\"M7 10V6.5M12 10V6.5M17 10V6.5\"/><path d=\"M5.5 6.5h3M10.5 6.5h3M15.5 6.5h3\"/>",
    "rep": "<circle cx=\"8\" cy=\"12\" r=\"4.5\"/><circle cx=\"8\" cy=\"12\" r=\"2\"/><path d=\"M17.5 8.5l3 1.75v3.5l-3 1.75-3-1.75v-3.5z\"/><circle cx=\"17.5\" cy=\"12\" r=\"1\"/>",
    "tool": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/><path d=\"M15 15l4 4\"/><path d=\"M17.5 13.5l3 3-1.5 1.5-3-3\"/>",
    "eng": "<path d=\"M5 9h2.5V7h3V5.5h4V7H17l2 2.5V15h-2v2.5H9.5L7.5 15H5z\"/><path d=\"M5 11H3v3h2M19 11.5h2v2.5h-2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>",
    "fl": "<path d=\"M7 7h8l3.5 3.5V20H7z\"/><path d=\"M9.5 7V4.5h4V7\"/><path d=\"M12.75 11.5c1.3 1.6 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9.7-1.9 2-3.5z\"/>",
    "kit": "<path d=\"M3.5 8L12 4l8.5 4v8.5L12 20.5 3.5 16.5z\"/><path d=\"M3.5 8L12 12l8.5-4\"/><path d=\"M12 12v8.5\"/><path d=\"M7.75 6l8.5 4\"/>",
    "all": "<rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/>"
    };
  var MEMO = {};
  var RWI = {"app": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/>", "tech": "<path d=\"M10 3h4v3h-4z\"/><rect x=\"8.5\" y=\"6\" width=\"7\" height=\"9\" rx=\"1.5\"/><path d=\"M11 15h2l-.4 4.5h-1.2z\"/>", "spec": "<circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 13l4-4M12 5V3M7 13H5M19 13h-2\"/>", "master": "<path d=\"M4 8l4 3 4-6 4 6 4-3-2 10H6z\"/><path d=\"M6 21h12\"/>", "off": "<path d=\"M20 12l-8 8-8-8V4h8z\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/>", "ship": "<path d=\"M3 7h11v9H3zM14 10h4l3 3v3h-7\"/><circle cx=\"7\" cy=\"17.5\" r=\"1.5\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.5\"/>", "fast": "<path d=\"M13 2L4 14h7l-1 8 9-12h-7z\"/>", "fluid": "<path d=\"M7 7h8l3.5 3.5V20H7z\"/><path d=\"M9.5 7V4.5h4V7\"/><path d=\"M12.75 11.5c1.3 1.6 2 2.6 2 3.5a2 2 0 0 1-4 0c0-.9.7-1.9 2-3.5z\"/>", "tool": "<path d=\"M14.7 4.3a4 4 0 0 0-4.6 5.4L4 15.8 6.2 18l6.1-6.1a4 4 0 0 0 5.4-4.6l-2.4 2.4-2.1-.6-.6-2.1z\"/>", "shirt": "<path d=\"M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z\"/>", "school": "<path d=\"M2 9l10-5 10 5-10 5z\"/><path d=\"M6 11v5c3 2 9 2 12 0v-5\"/>", "bench": "<path d=\"M3 10h18M5 10v10M19 10v10M8 10V6h8v4\"/>", "people": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6\"/><circle cx=\"17\" cy=\"9\" r=\"2.5\"/><path d=\"M15.5 14.2c3 .2 5.5 2.6 5.5 5.8\"/>", "mic": "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5 11a7 7 0 0 0 14 0M12 18v3\"/>"};
  // empty document/tracker: returned instead of null so bindings of a view being torn down never read null
  var DOC0 = { none: true, kind: '', number: '', email: '', billTo: [], shipTo: [], refs: [], lines: [], priced: false, total: 0, units: 0, notes: '' };
  var TRK0 = { none: true, label: '', steps: [], at: 0 };
  var DIAL = { '55': 'Brazil', '52': 'Mexico', '57': 'Colombia', '56': 'Chile', '51': 'Peru', '593': 'Ecuador', '54': 'Argentina', '598': 'Uruguay', '595': 'Paraguay', '591': 'Bolivia', '58': 'Venezuela', '507': 'Panama', '506': 'Costa Rica', '502': 'Guatemala', '504': 'Honduras', '503': 'El Salvador', '505': 'Nicaragua' };
  // longest national number per country (digits after the country code), to tell a local number from a full one
  var NAT = { Brazil: 11, Mexico: 10, Colombia: 10, Chile: 9, Peru: 9, Ecuador: 9, Argentina: 11, Uruguay: 9, Paraguay: 9, Bolivia: 8, Venezuela: 10, Panama: 8, 'Costa Rica': 8, Guatemala: 8, Honduras: 8, 'El Salvador': 8, Nicaragua: 8 };
  var NANP = /United States|Puerto Rico|Canada|Dominican Republic/;
  var ROUTES = ['home', 'c', 's', 'g', 'all', 'p', 'cart', 'checkout', 'orders', 'o', 'login', 'sent', 'request', 'requested', 'pending', 'admin', 'quote', 'rewards'];
  var T0 = Date.now();

  var app = PetiteVue.reactive({
    route: 'home', arg: '', me: null, book: null, cat: [], map: {}, fit: { tree: [], items: {}, rel: {} }, buy: null, imgs: {}, bad: {}, pasteWarn: false, pasteMiss: [], autoC: '', autoPrev: '', coTried: false, mbarOn: false, narrow: window.innerWidth <= 760,
    err: '', busy: false, toast: '', toastKind: '', ordersLoaded: false, idem: '', meLoaded: false, myQuotes: [], hbg: 0, email: '', sentPending: false,
    rq: { name: '', company: '', email: '', phone: '', city: '', state: '', zip: '', country: 'United States', type: '', customerNumber: '', notes: '' }, rqStep: 1, rqTried: false, rqTried2: false, zipMsg: '',
    q: '', qInput: '', limit: 24, picks: {}, cart: read(CK, []), quote: read(QK, []), qOpen: false, qClosing: false, qSent: null, justPlaced: '', qd: { name: '', company: '', email: '', phone: '', type: '', country: 'United States', city: '', po: '', notes: '', needBy: '', dest: 'same', street: '' },
    countries: ['United States', 'Puerto Rico', 'Canada', 'Mexico', 'Brazil', 'Colombia', 'Chile', 'Peru', 'Ecuador', 'Argentina', 'Uruguay', 'Paraguay', 'Bolivia', 'Venezuela', 'Panama', 'Costa Rica', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Dominican Republic', 'Other'], REWARDS: { on: true, demo: true, points: 12480, rate: 1, levels: [
      { k: 'app', n: 'Apprentice', at: 0, c: '#8a9097', perk: 'Points on every order', perks: ['1 point per US$ 1 invoiced', 'Member pricing alerts', 'Order tracking in the store'] },
      { k: 'tech', n: 'Technician', at: 10000, c: '#c87533', perk: 'Free ground freight over US$ 1,500', perks: ['Everything in Apprentice', 'Free ground freight on orders over US$ 1,500', 'Early access to new part lines'] },
      { k: 'spec', n: 'Specialist', at: 25000, c: '#d32a37', perk: 'Priority review and a DTA seat a year', perks: ['Everything in Technician', 'Priority order review', '1 Diesel Tech Academy course seat a year'] },
      { k: 'master', n: 'Master', at: 50000, c: '#1d2126', perk: 'Account manager and a bench day', perks: ['Everything in Specialist', 'Dedicated account manager', 'Annual bench day at Maxzz Florida'] }] },
    rwCat: 'All',
    RWITEMS: [
      { c: 'Savings', i: 'off', n: 'US$ 50 off your next order', d: 'Applied by our sales team when the order is approved.', p: 5000 },
      { c: 'Savings', i: 'off', n: 'US$ 150 off your next order', d: 'For orders over US$ 1,000.', p: 14000 },
      { c: 'Savings', i: 'off', n: 'US$ 400 off a pump or injector set', d: 'On any complete set of injectors or a high pressure pump.', p: 35000 },
      { c: 'Shipping', i: 'ship', n: 'Free ground freight', d: 'One order, any size, inside the US.', p: 4000 },
      { c: 'Shipping', i: 'fast', n: 'Next Day Air upgrade', d: 'When the truck is down and the part cannot wait.', p: 8000 },
      { c: 'Products', i: 'fluid', n: 'ISO 4113 calibration fluid, 5 gal', d: 'Settori calibration fluid for your test bench.', p: 6000 },
      { c: 'Products', i: 'tool', n: 'Robiel tool up to US$ 250', d: 'Pick any Robiel tool from the catalog up to this value.', p: 22000 },
      { c: 'Products', i: 'shirt', n: 'Maxzz shop jacket and cap', d: 'Workwear for the bench, in your team size.', p: 3000 },
      { c: 'Training', i: 'school', n: 'Diesel Tech Academy course', d: 'One online course for a technician on your team.', p: 12000 },
      { c: 'Training', i: 'school', n: 'DTA complete bundle', d: 'Every DTA course for one technician.', p: 40000 },
      { c: 'Experiences', i: 'bench', n: 'Bench day at Maxzz Florida', d: 'A day at our Coconut Creek bench with our technicians.', p: 35000 },
      { c: 'Experiences', i: 'mic', n: 'Private technical session', d: 'One hour online with our senior instructor on your toughest case.', p: 30000 },
      { c: 'Experiences', i: 'people', n: 'Trade show meetup', d: 'Lunch with the Maxzz team at ADS or AAPEX.', p: 20000 }], sortBy: '', specs: null, dtab: '', recent: read('mx-portal-recent', []), paste: '', pasteMsg: '',
    vMake: '', vLast: '', vEng: '', f: { cat: [], brand: [], eng: [], photo: false, stock: false }, allBrands: false, showF: false, sugOn: false, sugI: -1,
    co: Object.assign({ po: '', method: 'Ground', name: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: '', fwd: '' }, read('mx-portal-ship', {}), { po: '', notes: '' }),
    orders: [], cur: null, accounts: [], sync: null,

    get cats() { var self = this; return CATS.map(function (c) { return Object.assign({ n: self.cat.filter(function (r) { return r[3] === c.k; }).length }, c); }).filter(function (c) { return c.n; }); },
    get logged() { return !!(this.me && (this.me.admin || (this.me.account && this.me.account.status === 'approved'))); },
    get canOrder() { return !!(this.me && this.me.account && this.me.account.status === 'approved'); },
    get pendingCount() { return this.accounts.filter(function (a) { return a.status === 'pending'; }).length; },
    get engMake() { var k = this.vMake || this.vLast; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get curMake() { var k = this.vMake; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get featured() {
      var self = this, picks = Object.keys(BENCH).concat(['BO.0.986.435.433', 'BO.0.986.435.410', 'BO.0.445.117.023', 'BO.0.445.020.146']);
      var out = picks.map(function (c) { return self.map[c]; }).filter(Boolean);
      out = out.filter(function (r) { return self.hasImg(r[0]); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if ((r[3] === 'Injector' || r[3] === 'Pump') && self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      // reviewed titles first: the first row a visitor sees should read cleanly
      var sp = this.specs || {}, cur = function (r) { return sp[r[0]] && sp[r[0]].title ? 0 : 1; };
      this.cat.some(function (r) { if (out.length >= 24) return true; if (cur(r) === 0 && self.hasImg(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      return out.map(function (r, i) { return [cur(r), i, r]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; }).slice(0, 8);
    },
    get engs() { return ENG; },
    get side() { return ['home', 'c', 's', 'g', 'all'].indexOf(this.route) >= 0; },
    get listTitle() {
      var r = this.route, a = this.arg, f = this.f;
      if ((r === 'c' || r === 'all') && f.cat.length === 1) { var c = CATS.filter(function (x) { return x.k === f.cat[0]; })[0]; return c ? c.label : f.cat[0]; }
      if (r === 's') return 'Results for \u201c' + a + '\u201d';
      if (r === 'g') { var g = this.genOf(a); return g ? g.label + ' ' + g.years : 'Vehicle'; }
      return 'All parts';
    },
    // base set for the route; the sidebar filters stack on top of it
    get memoKey() { return [this.route, this.arg, this.cat.length, JSON.stringify(this.f), this.sortBy, this.book ? this.book.at : 0, Object.keys(this.imgs).length].join('|'); },
    get base() {
      var k = this.route + '|' + this.arg + '|' + this.cat.length + '|' + (this.fit.tree.length);
      if (MEMO.baseK === k) return MEMO.base;
      MEMO.baseK = k; MEMO.base = this.baseCalc(); return MEMO.base;
    },
    baseCalc: function () {
      var r = this.route, a = this.arg, self = this, list = this.cat;
      if (r === 'g') return list.filter(function (x) { var f = self.fit.items[x[0]]; return f && f[0].indexOf(a) >= 0; });
      if (r === 's') return matchSearch(list, a);
      return list;
    },
    pass: function (x, skip) {
      var f = this.f;
      if (skip !== 'cat' && f.cat.length && f.cat.indexOf(x[3]) < 0) return false;
      if (skip !== 'brand' && f.brand.length && f.brand.indexOf(x[4] || 'Other') < 0) return false;
      if (skip !== 'eng' && f.eng.length && !f.eng.some(function (e) { return (x[6] || '').indexOf(e) >= 0; })) return false;
      if (skip !== 'photo' && f.photo && !this.img(x[0])) return false;
      if (skip !== 'stock' && f.stock && !(this.qty(x[0]) > 0)) return false;
      return true;
    },
    get results() {
      var k = this.memoKey; if (MEMO.resK === k) return MEMO.res;
      MEMO.resK = k; MEMO.res = this.resultsCalc(); return MEMO.res;
    },
    resultsCalc: function () {
      var self = this, out = this.base.filter(function (x) { return self.pass(x); }), s = this.sortBy;
      if (!s) return out;
      out = out.slice();
      var pr = function (x) { var p = self.price(x[0]); return p == null ? (s === 'plo' ? 1e12 : -1) : p; };
      if (s === 'pn') out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      if (s === 'photo') out.sort(function (a, b) { return !!self.img(b[0]) - !!self.img(a[0]); });
      if (s === 'stock') out.sort(function (a, b) { return (self.qty(b[0]) > 0) - (self.qty(a[0]) > 0); });
      if (s === 'plo') out.sort(function (a, b) { return pr(a) - pr(b); });
      if (s === 'phi') out.sort(function (a, b) { return pr(b) - pr(a); });
      return out;
    },
    // other catalog parts listed as the same part (cross references both ways)
    get interch() {
      var p = this.product; if (!p) return [];
      var self = this, mine = norm(p[0]).replace(/^[A-Z]{2}/, ''), xr = parse(p[1]).xr.map(norm).filter(function (x) { return x.length >= 6; });
      return this.cat.filter(function (r) {
        if (r === p) return false;
        var c = norm(r[0]).replace(/^[A-Z]{2}/, '');
        if (xr.some(function (x) { return c === x || c.slice(-x.length) === x; })) return true;
        return mine.length >= 6 && parse(r[1]).xr.map(norm).some(function (x) { return x === mine || x.slice(-mine.length) === mine; });
      }).slice(0, 8);
    },
    // cross-sell: other categories that fit the same vehicles, or the same engine family
    get sameApp() {
      var p = this.product; if (!p) return [];
      var self = this, f = this.fit.items[p[0]], gens = f ? f[0] : [], skip = this.related.concat(this.interch, [p]);
      var hit = this.cat.filter(function (r) {
        if (r[3] === p[3] || skip.indexOf(r) >= 0) return false;
        var g = self.fit.items[r[0]]; return g && gens.length && g[0].some(function (k) { return gens.indexOf(k) >= 0; });
      });
      if (hit.length < 4 && p[6]) this.cat.some(function (r) { if (hit.length >= 8) return true; if (r[3] !== p[3] && r[3] !== 'Engine parts' && skip.indexOf(r) < 0 && hit.indexOf(r) < 0 && (r[6] || '').indexOf(p[6][0]) >= 0) hit.push(r); return false; });
      hit.sort(function (a, b) { return !!self.img(b[0]) - !!self.img(a[0]); });
      return hit.slice(0, 8);
    },
    // fallback so a product page always has a next step: same category, ranked by shared words (engine, maker, model)
    get similar() {
      var p = this.product; if (!p) return [];
      var skip = this.related.concat(this.sameApp, this.interch, [p]);
      if (this.related.length + this.sameApp.length >= 4) return [];
      var STOP = { the: 1, and: 1, for: 1, with: 1, fuel: 1, injector: 1, injectors: 1, pump: 1, kit: 1, fits: 1, application: 1, new: 1, oem: 1, diesel: 1 };
      var toks = function (t) { return String(t || '').toLowerCase().split(/[^a-z0-9.]+/).filter(function (w) { return w.length >= 3 && !STOP[w]; }); };
      var mine = toks(p[1]), self = this;
      var hit = this.cat.filter(function (r) { return r[3] === p[3] && skip.indexOf(r) < 0; }).map(function (r) {
        var t = toks(r[1]), sc = 0; mine.forEach(function (w) { if (t.indexOf(w) >= 0) sc += /\d/.test(w) ? 2 : 1; });
        if (r[4] && r[4] === p[4]) sc += 1; if (self.img(r[0])) sc += 0.5;
        return [sc, r];
      }).filter(function (x) { return x[0] >= 1.5; }).sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; });
      return hit.slice(0, 8);
    },
    get recentList() { var self = this, p = this.product; return this.recent.filter(function (c) { return !p || c !== p[0]; }).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 4); },
    get quoteN() { return this.quote.length; },
    get quoteUnits() { return this.quote.reduce(function (a, l) { return a + (l.qty || 1); }, 0); },
    get rwLevel() { var p = this.REWARDS.points, L = this.REWARDS.levels, cur = L[0]; L.forEach(function (l) { if (p >= l.at) cur = l; }); return cur; },
    get rwNext() { var p = this.REWARDS.points; return this.REWARDS.levels.filter(function (l) { return l.at > p; })[0] || null; },
    get rwPct() { var n = this.rwNext, c = this.rwLevel; if (!n) return 100; return Math.min(100, Math.round((this.REWARDS.points - c.at) / (n.at - c.at) * 100)); },
    get rwPathPct() { var L = this.REWARDS.levels, i = L.indexOf(this.rwLevel), seg = 100 / (L.length - 1); return Math.min(100, i * seg + (this.rwNext ? seg * this.rwPct / 100 : 0)); },
    get rwItems() { var c = this.rwCat, p = this.REWARDS.points; return this.RWITEMS.filter(function (r) { return c === 'All' || r.c === c; }).slice().sort(function (a, b) { return (b.p <= p) - (a.p <= p) || a.p - b.p; }); },
    rwIcon: function (k, s) { return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (RWI[k] || '') + '</svg>'; },
    get firstName() {
      if (!this.me) return '';
      var n = (this.me.name || '').trim().split(/\s+/)[0];
      if (!n) { var lp = String(this.me.email || '').split('@')[0]; n = { marketing: 'Mateus', sales: 'Leise' }[lp] || lp.split(/[._-]/)[0]; n = n.charAt(0).toUpperCase() + n.slice(1); }
      return n;
    },
    get initials() { var n = (this.me && this.me.name) || this.firstName; return n.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); },
    get greet() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; },
    get openOrders() { return this.orders.filter(function (o) { return ['Completed', 'Deleted'].indexOf(o.status) < 0; }).length; },
    facet: function (g) {
      var k = this.memoKey + '|' + g; if (MEMO['f' + g + 'K'] === k) return MEMO['f' + g];
      MEMO['f' + g + 'K'] = k; MEMO['f' + g] = this.facetCalc(g); return MEMO['f' + g];
    },
    facetCalc: function (g) {
      var self = this, n = {};
      this.base.forEach(function (x) {
        if (!self.pass(x, g)) return;
        if (g === 'cat') n[x[3]] = (n[x[3]] || 0) + 1;
        else if (g === 'brand') { var b = x[4] || 'Other'; n[b] = (n[b] || 0) + 1; }
        else if (g === 'eng') (x[6] || '').split('').forEach(function (e) { n[e] = (n[e] || 0) + 1; });
        else if (g === 'photo') { if (self.img(x[0])) n.y = (n.y || 0) + 1; }
        else if (g === 'stock') { if (self.qty(x[0]) > 0) n.y = (n.y || 0) + 1; }
      });
      return n;
    },
    get fCats() { var n = this.facet('cat'), f = this.f; return CATS.map(function (c) { return { k: c.k, label: c.label, n: n[c.k] || 0 }; }).filter(function (c) { return c.n || f.cat.indexOf(c.k) >= 0; }); },
    get fBrands() {
      var n = this.facet('brand'), f = this.f, all = Object.keys(n).filter(function (b) { return b !== 'Other'; }).sort(function (a, b) { return n[b] - n[a]; });
      f.brand.forEach(function (b) { if (all.indexOf(b) < 0) all.push(b); });
      var list = all.map(function (b) { return { k: b, label: b, n: n[b] || 0 }; });
      return { more: list.length > 8, items: this.allBrands ? list : list.slice(0, 8) };
    },
    get fEngs() { var n = this.facet('eng'); return ENG.map(function (e) { return { k: e.k, label: e.label, n: n[e.k] || 0 }; }); },
    get fCount() { var f = this.f; return f.cat.length + f.brand.length + f.eng.length + (f.photo ? 1 : 0) + (f.stock ? 1 : 0); },
    get chips() {
      var f = this.f, out = [];
      f.cat.forEach(function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; out.push({ g: 'cat', k: k, label: c ? c.label : k }); });
      f.brand.forEach(function (k) { out.push({ g: 'brand', k: k, label: k }); });
      f.eng.forEach(function (k) { out.push({ g: 'eng', k: k, label: ENG.filter(function (e) { return e.k === k; })[0].label }); });
      if (this.route === 'g') { var gg = this.genOf(this.arg); out.unshift({ g: 'veh', label: gg ? gg.label + ' ' + (gg.years || '') : 'Vehicle' }); }
      if (f.photo) out.push({ g: 'photo', label: 'With photo' });
      if (f.stock) out.push({ g: 'stock', label: 'In stock' });
      return out;
    },
    get sug() { var q = this.qInput.trim(); if (q.length < 2 || !this.cat.length) return []; return matchSearch(this.cat, q).slice(0, 8); },
    get moreRow() {
      var self = this, out = [], feat = this.featured;
      ['Pump', 'Tool', 'Nozzle'].forEach(function (k) { var n = 0; self.cat.some(function (r) { if (r[3] === k && self.hasImg(r[0]) && out.indexOf(r) < 0 && feat.indexOf(r) < 0) { out.push(r); n++; } return n >= (k === 'Pump' ? 2 : 1); }); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.hasImg(r[0]) && r[3] !== 'Injector' && out.indexOf(r) < 0 && feat.indexOf(r) < 0) out.push(r); return false; });
      return out.slice(0, 8);
    },
    get shown() { return this.results.slice(0, this.limit); },
    get product() { return this.route === 'p' ? this.map[this.arg] || null : null; },
    get related() {
      var self = this, p = this.product; if (!p) return [];
      var sr = this.spec && this.spec.rel ? this.spec.rel.split(/\s*,\s*/) : [], codes = (this.fit.rel[p[0]] || []).concat(sr, (this.buy && this.buy[p[0]]) || []), seen = {};
      return codes.filter(function (c) { if (seen[c] || c === p[0]) return false; seen[c] = 1; return true; }).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 8);
    },
    // cross-sell on the cart and quote list: bought-together history first, then parts for the same vehicles and engines in complementary categories
    get forgot() {
      var self = this, codes = this.lines.map(function (l) { return l.code; }), key = codes.join('|') + '#' + (this.buy ? Object.keys(this.buy).length : 0) + '#' + this.cat.length;
      if (FGC.k === key) return FGC.v;
      var COMP = { Injector: ['Repair part', 'Nozzle', 'Kit', 'Fluid', 'Tool'], Pump: ['Repair part', 'Rail', 'Kit', 'Injector'], Nozzle: ['Repair part', 'Injector', 'Tool'], Rail: ['Repair part', 'Pump', 'Injector'], 'Repair part': ['Injector', 'Nozzle', 'Tool'], Tool: ['Repair part', 'Fluid'], Fluid: ['Tool', 'Kit'], Kit: ['Fluid', 'Repair part', 'Tool'], 'Engine parts': ['Injector', 'Repair part'] };
      var mine = codes.map(function (c) { return self.map[c]; }).filter(Boolean), have = {}, sc = {};
      var etok = function (t) { return String(t || '').toUpperCase().replace(/\u2011/g, '-').split(/[^A-Z0-9.]+/).filter(function (w) { return /\d/.test(w) && /[A-Z]/.test(w) && w.length >= 3 && !/^\d{4}$/.test(w); }); };
      codes.forEach(function (c) { have[c] = 1; });
      var bump = function (c, n) { if (!c || have[c] || !self.map[c]) return; sc[c] = (sc[c] || 0) + n; };
      mine.forEach(function (p) {
        ((self.buy && self.buy[p[0]]) || []).forEach(function (c) { bump(c, 6); });
        (self.fit.rel[p[0]] || []).forEach(function (c) { bump(c, 5); });
        var comp = COMP[p[3]] || [], f = self.fit.items[p[0]], gens = f ? f[0] : [], eng = String(p[6] || ''); var et = etok(self.title(p));
        self.cat.forEach(function (r) {
          if (have[r[0]] || comp.indexOf(r[3]) < 0) return;
          var g = gens.length && self.fit.items[r[0]];
          if (g && g[0].some(function (k) { return gens.indexOf(k) >= 0; })) bump(r[0], 3 - comp.indexOf(r[3]) * 0.2);
          else if (eng && r[6] && String(r[6]).split('').some(function (k) { return eng.indexOf(k) >= 0; }) && etok(self.title(r)).some(function (t) { return et.indexOf(t) >= 0; })) bump(r[0], 2 - comp.indexOf(r[3]) * 0.1);
        });
      });
      var out = Object.keys(sc).map(function (c) { var r = self.map[c]; return [sc[c] + (self.img(c) ? 1 : 0) + (self.specs && self.specs[c] ? 0.5 : 0), r]; })
        .sort(function (a, b) { return b[0] - a[0]; }), cats = {}, pick = [];
      out.forEach(function (x) { if (pick.length >= 4) return; var k = x[1][3]; if ((cats[k] || 0) >= 2) return; cats[k] = (cats[k] || 0) + 1; pick.push(x[1]); });
      FGC.k = key; FGC.v = pick; return pick;
    },
    get savedShip() {
      var acc = this.me && this.me.account, a = acc && acc.ship;
      if (a && typeof a === 'string') return { street: a, city: '', state: '', zip: '', country: '' };
      if (a && (a.street || a.city)) return a;
      var c = this.co; if (c && c.street) return { street: c.street, city: c.city, state: c.state, zip: c.zip, country: c.country };
      return null;
    },
    shipLine: function (a) { return a ? [a.street, a.city, [a.state, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') : ''; },
    get qShip() {
      var d = this.qd, sv = this.savedShip;
      if (this.me && sv && d.dest !== 'other') return { street: sv.street || '', city: sv.city || '', state: sv.state || '', zip: sv.zip || '', country: sv.country || d.country };
      return { street: d.street, city: d.city, state: '', zip: '', country: d.country };
    },
    get ordersSorted() { return (this.orders || []).slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); },
    get relShown() { var r = this.related, n = r.length >= 8 ? 8 : r.length >= 4 ? 4 : r.length; return r.slice(0, n); },
    get buyAgain() {
      var seen = {}, out = [], self = this;
      (this.orders || []).forEach(function (o) { (o.lines || []).forEach(function (l) { if (!seen[l.code] && self.map[l.code]) { seen[l.code] = 1; out.push(self.map[l.code]); } }); });
      return out.slice(0, 4);
    },
    addAll: function (list) {
      var self = this, nq = 0, nc = 0;
      list.forEach(function (r) {
        var c = r[0];
        if (self.canOrder && self.price(c) != null) { if (!self.inCart(c)) { self.cart.push({ code: c, qty: 1 }); nc++; } }
        else if (!self.inQuote(c)) { self.quote.push({ id: c, name: r[1], pn: c, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: 1 }); nq++; }
      });
      this.save(); write(QK, this.quote); this.pop();
      this.flash((nc ? nc + ' added to your cart' : '') + (nc && nq ? ', ' : '') + (nq ? nq + ' added to your quote list' : '') || 'Already in your list', nc ? 'cart' : 'quote');
    },
    get tab() { return this.dtab || (this.spec.desc ? 'ov' : 'sp'); },
    get pr() { return this.product || ['', '', '', '', '', '', '']; },
    // order flow (cart > shipping > review > order page) and quote flow (list > details > review > done)
    get inFlow() { var r = this.route; return (r === 'quote') || ((r === 'cart' || r === 'checkout') && this.canOrder); },
    get flow() { return this.route === 'quote' ? 'quote' : 'order'; },
    get step() {
      if (this.route === 'quote') return this.qSent ? 4 : this.arg === 'review' ? 3 : this.arg === 'details' ? 2 : 1;
      if (this.route === 'checkout') return this.arg === 'review' ? 3 : 2;
      return 1;
    },
    get lines() { return this.flow === 'quote' ? this.quote.map(function (l, i) { return { code: l.id, qty: l.qty, i: i }; }) : this.cart.map(function (l, i) { return { code: l.code, qty: l.qty, i: i }; }); },
    get units() { return this.lines.reduce(function (a, l) { return a + l.qty; }, 0); },
    get showPrice() { return this.logged && !!this.book; },
    get noPriceN() { var self = this; return this.lines.filter(function (l) { return self.price(l.code) == null; }).length; },
    get subLabel() { var n = this.noPriceN; if (n && n === this.lines.length) return 'Prices confirmed by sales'; return 'Subtotal ' + this.fmt(this.flowTotal) + (n ? ' · ' + n + (n === 1 ? ' part' : ' parts') + ' priced by sales' : ''); },
    get flowTotal() { var self = this; return this.lines.reduce(function (a, l) { return a + (self.price(l.code) || 0) * l.qty; }, 0); },
    get doc() {
      var self = this, me = this.me, acc = me && me.account, now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      var who = function () { return me ? [(me.name || self.firstName), acc ? acc.company + (acc.code ? ' · ' + acc.code : '') : 'Maxzz Diesel team', me.email] : [self.qd.name, self.qd.company, self.qd.email, self.qd.phone]; };
      if (this.route === 'o' && this.cur) {
        var o = this.cur, sh = o.ship || {};
        return { kind: 'order', number: o.number, email: o.by || (me && me.email), billTo: who().filter(Boolean),
          shipTo: /will call/i.test(sh.method || '') ? ['Will call', 'Pick up in Coconut Creek, FL'] : [sh.name, sh.street, [sh.city, sh.state, sh.zip].filter(Boolean).join(', '), sh.country].filter(Boolean),
          refs: ['Date ' + this.date(o.created), o.po ? 'PO ' + o.po : 'No PO', sh.method || '', o.unleashedNumber ? 'Ref ' + o.unleashedNumber : ''].filter(Boolean),
          lines: o.lines.map(function (l) { return { code: l.code, name: self.name(l.code) || l.name, qty: l.qty, price: l.price }; }), priced: true, total: o.total, units: o.lines.reduce(function (a, l) { return a + l.qty; }, 0), notes: o.notes };
      }
      if (this.route === 'quote' && this.qSent) {
        var q = this.qSent;
        return { kind: 'quote', number: q.id, email: q.email, billTo: q.from, shipTo: q.ship, refs: q.refs, lines: q.lines, priced: false, units: q.lines.reduce(function (a, l) { return a + l.qty; }, 0), notes: q.notes };
      }
      if (this.step !== 3) return DOC0;
      var ls = this.lines.map(function (l) { return { code: l.code, name: self.name(l.code), qty: l.qty, price: self.price(l.code) }; });
      if (this.flow === 'order') {
        var c = this.co;
        return { kind: 'order', number: 'Number on confirmation', email: me && me.email, billTo: who().filter(Boolean),
          shipTo: this.pickup ? ['Will call', 'Pick up in Coconut Creek, FL'] : [c.name, c.street, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country, c.fwd ? 'Forwarder: ' + c.fwd : ''].filter(Boolean),
          refs: ['Date ' + now, c.po ? 'PO ' + c.po : 'No PO', c.method].filter(Boolean), lines: ls, priced: true, total: this.flowTotal, units: this.units, notes: c.notes };
      }
      var d = this.qd;
      return { kind: 'quote', number: 'Number on confirmation', email: me ? me.email : d.email, billTo: who().filter(Boolean),
        shipTo: me ? [acc ? acc.company : '', this.qShip.street, [this.qShip.city, this.qShip.state, this.qShip.zip].filter(Boolean).join(', '), this.qShip.country].filter(Boolean) : [d.company, d.city, d.country].filter(Boolean), refs: ['Date ' + now, d.po ? 'PO ' + d.po : 'No PO', d.needBy ? 'Needed by ' + d.needBy : ''].filter(Boolean),
        lines: ls, priced: this.showPrice && this.noPriceN < this.lines.length, total: this.flowTotal, units: this.units, notes: d.notes };
    },
    setLn: function (i, n) { if (String(n).trim() === '' || isNaN(parseInt(n, 10))) return; n = parseInt(n, 10) || 0; if (this.flow === 'quote') return this.qSet(i, n); if (n <= 0) this.remove(i); else { this.cart[i].qty = Math.min(9999, n); this.save(); } },
    moveToQuote: function (i) { var c = this.cart[i]; if (!c) return; this.addQuote(c.code); var l = this.quote.filter(function (x) { return x.id === c.code; })[0]; if (l) { l.qty = c.qty; write(QK, this.quote); } this.remove(i); this.flash('Moved to your quote list (' + c.qty + (c.qty === 1 ? ' unit' : ' units') + ')', 'quote'); },
    clearFlow: function () { if (!confirm('Remove every part from this list?')) return; if (this.flow === 'quote') { this.quote.splice(0); write(QK, []); } else this.clearCart(); },
    next: function () {
      this.err = '';
      if (this.step === 1) {
        if (this.flow === 'order' && this.noPriceLines.length) { this.err = ''; this.flash('Move the parts without online price to a quote first'); return; }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', this.flow === 'order' ? '' : 'details');
      }
      if (this.step === 2) {
        if (this.flow === 'order' && !this.pickup && (!this.co.street.trim() || !this.co.city.trim())) { this.err = 'Fill in the street address and city, or choose Will call.'; return; }
        if (this.flow === 'order' && !this.pickup && /United States|Puerto Rico|Canada/.test(this.co.country || '') && (!String(this.co.state || '').trim() || !String(this.co.zip || '').trim())) { this.coTried = true; var ms = !String(this.co.state || '').trim(), mz = !String(this.co.zip || '').trim(); this.err = 'Fill in the ' + (ms && mz ? 'state and ZIP code' : ms ? 'state' : 'ZIP code') + ', or choose Will call.'; var co = this.co; setTimeout(function () { var el = document.querySelector(!String(co.state || '').trim() ? '[autocomplete=address-level1]' : '[autocomplete=postal-code]'); if (el) el.focus(); }, 30); return; }
        if (this.flow === 'quote' && this.me && this.qd.phone && this.qd.phone.replace(/\D/g, '').length < 7) { this.err = 'Check the phone number, or leave it empty.'; return; }
        if (this.flow === 'quote' && !this.me) { var d = this.qd; if (!d.name.trim() || !d.company.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || d.phone.replace(/\D/g, '').length < 7) { this.err = 'Fill in name, company, e-mail and phone.'; return; } }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', 'review');
      }
    },
    confirmFlow: function () { return this.flow === 'order' ? this.placeOrder() : this.sendQuote(); },
    get adminBar() { return !!(this.me && this.me.admin && this.pendingCount); },
    // what the customer follows after sending: the number and the stages it goes through
    get track() {
      var d = this.doc; if (!d || d.none) return TRK0;
      if (d.kind === 'order') {
        var st = this.cur ? this.stepOf(this.cur) : 1;
        return { label: 'Your order number', steps: ['Order placed', 'In review', 'Approved', 'Shipped', 'Invoiced'], at: st };
      }
      return { label: 'Your quote number', steps: ['Request sent', 'In review', 'Quote sent to you', 'Accepted', 'Shipped'], at: 1 };
    },
    get hi() { return this.firstName ? this.firstName + ', ' : ''; },
    get usPhone() { return NANP.test(this.rq.country); },
    get zipLabel() { return this.rq.country === 'Brazil' ? 'CEP' : /United States|Puerto Rico/.test(this.rq.country) ? 'ZIP' : 'Postal code'; },
    okEmail: function (e) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '').trim()); },
    okPhone: function (p) { return String(p || '').replace(/\D/g, '').length >= 10; },
    // country from an international dial code (+55 Brazil...), only while the select is still on a NANP default
    dialCountry: function (v, cur) {
      var r = String(v || '').replace(/[^\d+]/g, ''); if (r.charAt(0) !== '+' || !NANP.test(cur)) return cur;
      var d = r.slice(1); for (var n = 3; n >= 2; n--) if (DIAL[d.slice(0, n)]) { if (!this.autoC) this.autoPrev = cur; this.autoC = DIAL[d.slice(0, n)]; return this.autoC; }
      return cur;
    },
    // phone formatting while typing; final (on blur) adds the country's dial code to a local LATAM number
    // phone field input: a typed dial code may pick the country
    phoneIn: function (o) {
      o.country = this.dialCountry(o.phone, o.country); o.phone = this.maskPhone(o.phone, o.country);
    },
    maskPhone: function (v, country, final) {
      var d = String(v || '').replace(/\D/g, ''), raw = String(v || '').replace(/^\s+/, '');
      if (!raw) return '';
      if (raw === '+') return '+';
      if (/^00[1-9]/.test(d) && !/^\+/.test(raw)) { raw = '+' + raw.replace(/^\s*00/, ''); d = d.slice(2); }
      if (raw.charAt(0) === '+') return '+' + raw.slice(1).replace(/[^\d\s\-]/g, '').replace(/\s{2,}/g, ' ').slice(0, 22);
      var us = country ? NANP.test(country) : this.usPhone;
      if (us) {
        if (final && /Dominican/.test(country) && d.length === 10) return '+1' + d;
        if (d.length === 11 && d[0] === '1' && /[2-9]/.test(d[1])) d = d.slice(1);
        if (d.length > 10) return d[0] === '1' ? d.slice(0, 15) : '+' + d.slice(0, 15);
        if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
      }
      if (!final) return raw.replace(/[^\d\s()\-.]/g, '').slice(0, 22);
      var code = ''; Object.keys(DIAL).forEach(function (k) { if (DIAL[k] === country) code = k; });
      if (!d) return '';
      if (!code) return raw.slice(0, 22);
      var full = code && d.indexOf(code) === 0 && d.length > (NAT[country] || 10);
      return '+' + (code && !full ? code + d.replace(/^0+/, '') : d).slice(0, 15);
    },
    rqNext: function () { this.rqTried = true; var r = this.rq; if (!r.name.trim() || !this.okEmail(r.email) || !this.okPhone(r.phone)) { setTimeout(function () { var b = document.querySelector('.px-stage .bad input, .px-stage input.bad, .px-stage [aria-invalid=true]'); if (b) b.focus(); }, 30); return; } this.rqStep = 2; setTimeout(function () { var c = document.querySelector('[autocomplete=organization]'); if (c) c.focus(); }, 60); },
    rqZip: function () {
      var self = this, r = this.rq, z = String(r.zip || '').trim(), c = r.country, url = '', br = false;
      clearTimeout(this._zt); this.zipMsg = '';
      if (/United States|Puerto Rico/.test(c) && /^\d{5}$/.test(z)) url = 'https://api.zippopotam.us/us/' + z;
      else if (c === 'Canada' && /^[A-Za-z]\d[A-Za-z]/.test(z)) url = 'https://api.zippopotam.us/ca/' + z.slice(0, 3).toUpperCase();
      else if (c === 'Mexico' && /^\d{5}$/.test(z)) url = 'https://api.zippopotam.us/mx/' + z;
      else if (c === 'Brazil' && /^\d{5}-?\d{3}$/.test(z)) { url = 'https://viacep.com.br/ws/' + z.replace('-', '') + '/json/'; br = true; }
      if (!url) return;
      this._zt = setTimeout(function () {
        fetch(url).then(function (x) { if (!x.ok) throw 0; return x.json(); }).then(function (x) {
          var city = '', st = '';
          if (br) { if (x.erro) throw 0; city = x.localidade; st = x.uf; } else { var pl = (x.places || [])[0] || {}; city = pl['place name'] || ''; st = pl['state abbreviation'] || pl.state || ''; }
          if (city) { r.city = city; r.state = st; self.zipMsg = ''; }
        }).catch(function () { self.zipMsg = ''; });
      }, 300);
    },
    get lp() { return ['request', 'login', 'sent', 'requested', 'pending'].indexOf(this.route) >= 0; },
    get needLogin() { var r = this.route; if (r === 'admin') return !(this.me && this.me.admin); if (r === 'orders') return !this.me && this.meLoaded; return ['cart', 'checkout', 'o'].indexOf(r) >= 0 && !this.canOrder && this.meLoaded; },
    get noPriceLines() { var self = this; return this.cart.filter(function (l) { return self.price(l.code) == null; }).map(function (l) { return l.code; }); },
    get pickup() { return /will call/i.test(this.co.method); },
    get blurb() {
      var p = this.product; if (!p) return '';
      var sp = this.spec, d = sp.desc ? String(sp.desc).split('</p>')[0].replace(/<[^>]+>/g, '').replace(/[^.]*\bships from our [^.]*\.\s*/i, ' ').trim() : '';
      if (d) return d;
      var i = parse(p[1]), type = (sp.type || p[3] || '').toLowerCase();
      if (!p[4] && !i.app && !i.xr.length) return '';
      return [p[4], type].filter(Boolean).join(' ').replace(/^./, function (c) { return c.toUpperCase(); }) + (i.app ? ' for ' + i.app : '') + '.' + (i.xr.length ? ' Same as ' + i.xr.slice(0, 3).join(', ') + '.' : '');
    },
    get spec() { var p = this.product; return (p && this.specs && this.specs[p[0]]) || {}; },
    get keyFacts() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), out = [];
      if (!p) return out;
      if (sp.eng) out.push(['Engine', nice(sp.eng)]);
      if (sp.models) out.push(['Vehicles', sp.models]);
      if (!sp.eng && i.app) out.push(['Application', nice(i.app)]);
      if (sp.inj) out.push(['Used in', sp.inj]);
      if (p[4]) out.push(['Brand', p[4]]);
      if (sp.cond) out.push(['Condition', sp.cond]);
      if (this.xrefs.length) out.push(['Cross references', this.xrefs.length + (this.xrefs.length === 1 ? ' number' : ' numbers') + ', see below']);
      return out;
    },
    get specRows() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), r = [];
      if (!p) return r;
      r.push(['Maxzz part number', p[0]]);
      var pn = p[0].replace(/^[A-Z]{2,4}[.\-]/, '');
      r.push(['Manufacturer part number', pn]);
      if (p[4]) r.push(['Brand', p[4]]);
      r.push(['Part type', sp.type || p[3]]);
      if (sp.cond) r.push(['Condition', sp.cond]);
      if (sp.eng) r.push(['Engine / generation', nice(sp.eng)]);
      if (sp.make) r.push(['Vehicle make', sp.make]);
      if (sp.y0) r.push(['Model years', sp.y0 + (sp.y1 ? ' to ' + sp.y1 : ' to today')]);
      if (sp.models) r.push(['Vehicles', sp.models]);
      if (sp.inj) r.push(['Used in injectors', sp.inj]);
      if (!sp.eng && i.app) r.push(['Application', nice(i.app)]);
      var u = this.book && this.book.items[p[0]] && this.book.items[p[0]][3]; if (u) r.push(['Unit', u]);

      return r;
    },
    get appRows() {
      var self = this, p = this.product, sp = this.spec || {}, out = [];
      if (!p) return out;
      this.fits.forEach(function (g) { out.push({ t: g.label + ' ' + (g.years || ''), d: sp.models || '', g: g.key }); });
      if (!out.length && sp.fit) sp.fit.split(/\s*;\s*|\n/).forEach(function (f) { if (f) out.push({ t: f, d: '' }); });
      if (!out.length) { var a = parse(p[1]).app; if (a) out.push({ t: a, d: 'From the catalog description' }); }
      return out;
    },
    get xrefs() {
      var self = this, p = this.product; if (!p) return [];
      var seen = {}, out = [], add = function (n, t) { var k = norm(n); if (!k || seen[k] || k === norm(p[0]).replace(/^[A-Z]{2}/, '')) return; seen[k] = 1; var hit = self.find(n); out.push({ n: n, t: t, code: hit && hit !== p[0] ? hit : null }); };
      parse(p[1]).xr.forEach(function (x) { add(x, 'Equivalent'); });
      var sp = this.spec; if (sp.eq) sp.eq.split(/\s*[,;]\s*/).forEach(function (x) { add(x, 'Equivalent'); });
      this.interch.forEach(function (r) { add(r[0], 'Interchangeable (in stock list)'); });
      return out;
    },
    get faqs() {
      var sp = this.spec; if (!sp.faq) return [];
      var out = [], cur = null;
      sp.faq.split('\n').forEach(function (l) { l = l.trim(); if (/^Q:/.test(l)) { cur = { q: l.slice(2).trim(), a: '' }; out.push(cur); } else if (/^A:/.test(l) && cur) cur.a = l.slice(2).trim(); else if (cur && l) cur.a += ' ' + l; });
      return out;
    },
    get fits() { var self = this, p = this.product, f = p && this.fit.items[p[0]]; if (!f) return []; return f[0].map(function (k) { return self.genOf(k); }).filter(Boolean); },
    get subtotal() { var self = this; return this.cart.reduce(function (a, l) { return a + self.lineTotal(l); }, 0); },

    init: function () {
      var self = this, h = location.search;
      if (/e=link/.test(h)) this.err = 'That sign-in link expired or was already used. Ask for a new one below.';
      if (/e=access/.test(h)) this.err = 'Your access is not approved yet.';
      if (h) history.replaceState(null, '', location.pathname + location.hash);
      fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (rows) { self.cat = rows; var m = {}; rows.forEach(function (r) { m[r[0]] = r; if (!r[4]) { var bp = String(r[0]).match(/^([A-Z]{2,3})[.\-]/); if (bp && BRP[bp[1]]) r[4] = BRP[bp[1]]; } }); self.map = m; if (self.route === 'p' && !m[self.arg]) self.fixPart(); });
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).then(function (f) { self.fit = f; }).catch(function () {});
      fetch('/data/specs.json?v=1').then(function (r) { return r.json(); }).then(function (d) { self.specs = d; }).catch(function () {});
      fetch('/api/portal/images').then(function (r) { return r.json(); }).then(function (m) { self.imgs = m || {}; }).catch(function () {});
      api('me').then(function (me) {
        self.meLoaded = true;
        if (me._status === 200) {
          self.me = me;
          if (self.logged && (self.route === 'login' || self.route === 'request')) location.replace('#/');
          if (me.account) self.co.name = me.account.company;
          api('prices').then(function (b) { if (b._status === 200) self.book = b; });
          if (me.account) api('orders').then(function (o) { if (o.orders) { self.orders = o.orders; if (self.route === 'o') self.cur = o.orders.filter(function (x) { return x.id === self.arg; })[0] || null; } self.ordersLoaded = true; });
          if (me.admin) self.loadAdmin();
          api('quotes').then(function (q) { if (q.quotes) self.myQuotes = q.quotes; });
        }
      });
      window.addEventListener('hashchange', function () { self.readHash(); });
      // account menu: close on a click outside it, on Escape and on navigation
      var closeMenus = function (e) { [].forEach.call(document.querySelectorAll('details.pxh-me[open]'), function (d) { if (!e || !d.contains(e.target)) d.removeAttribute('open'); }); };
      document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.pxh-menu a, .pxh-menu button')) { var d = e.target.closest('details'); if (d) d.removeAttribute('open'); return; } closeMenus(e); }); window.addEventListener('hashchange', function () { closeMenus(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
      document.addEventListener('click', function (e) { if (self.vMake && e.target.closest && !e.target.closest('.px-makes, .px-engs-w')) self.vMake = ''; });
      window.addEventListener('scroll', function () { if (!self.sugOn) return; var a = document.activeElement; if (!a || !a.getBoundingClientRect) return; var b = a.getBoundingClientRect(); if (b.bottom < 90 || b.top > window.innerHeight) { self.sugOn = false; a.blur && a.blur(); } }, { passive: true });
      // mobile product page: the sticky buy bar shows only once the buy box has scrolled out of view
      var mb = function () { if (self.route !== 'p') { if (self.mbarOn) self.mbarOn = false; return; } var el = document.querySelector('.px-pd-info .px-qrow'); var on = !!el && el.getBoundingClientRect().bottom < 70; if (on !== self.mbarOn) self.mbarOn = on; };
      window.addEventListener('scroll', mb, { passive: true }); window.addEventListener('resize', function () { mb(); var n = window.innerWidth <= 760; if (n !== self.narrow) self.narrow = n; });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (self.qOpen) self.qClose(); self.showF = false; if (self.vMake) self.vMake = ''; } });
      this.readHash();
    },
    readHash: function () {
      var raw = (location.hash || '').replace(/^#\/?/, ''), h; try { h = decodeURIComponent(raw); } catch (e) { h = raw; }
      var i = h.indexOf('/');
      var r = i < 0 ? h : h.slice(0, i), a = i < 0 ? '' : h.slice(i + 1);
      this.vMake = '';
      if (r && ROUTES.indexOf(r) < 0) { location.replace('#/'); return; }
      if (r === 'c') { var lc = String(a).toLowerCase(), hit = CATS.filter(function (c) { return c.k.toLowerCase() === lc || c.label.toLowerCase() === lc || c.label.toLowerCase().replace(/s$/, '') === lc; })[0];
        if (!hit) { location.replace('#/all'); return; } if (hit.k !== a) { location.replace('#/c/' + encodeURIComponent(hit.k)); return; } }
      track('portal_view', { portal_route: r || 'home' }); if (r === 's' && a) track('search', { search_term: String(a).slice(0, 80), source: 'store' }); if (r === 'p' && a) track('view_item', { item_id: a, source: 'store' });
      this.route = r || 'home'; this.arg = a; this.err = ''; this.limit = 24; this.sugOn = false; this.showF = false; this.mbarOn = false;
      this.qInput = r === 's' ? a : '';
      if ((r === 'login' || r === 'request') && this.logged) { location.replace('#/'); return; }
      if (r === 'g' && this.fit.tree.length && !this.genOf(a)) { location.replace('#/all'); return; }
      if (r === 'c') this.f = { cat: [a], brand: [], eng: [], photo: false, stock: false };
      if (r === 's' || r === 'g' || r === 'all' || !r) this.f = { cat: [], brand: [], eng: [], photo: false, stock: false };
      if (r === 'orders' && this.me) { var s3 = this; api('quotes').then(function (q) { if (q.quotes) s3.myQuotes = q.quotes; }); }
      if (r === 'orders' && this.me && this.me.account) { var self = this; api('orders').then(function (o) { if (o.orders) self.orders = o.orders; }); }
      if (r === 'o') this.cur = this.orders.filter(function (o) { return o.id === a; })[0] || null;
      if (r === 'checkout' && !this.cart.length) { location.hash = '#/cart'; return; }
      if (r === 'quote' && a && !this.quote.length && !this.qSent) { location.hash = '#/quote'; return; }
      this.qOpen = false; if (r !== 'quote') this.qSent = null;
      if (r === 'quote' && this.me) { var acc = this.me.account; if (!this.qd.email) this.qd.email = this.me.email; if (!this.qd.name) this.qd.name = this.me.name || ''; if (!this.qd.company && acc) this.qd.company = acc.company; }
      if ((r === 'p' || r === 'cart' || r === 'quote') && !this.buy) { var me3 = this; this.buy = {}; api('related').then(function (j) { if (j && j.rel) me3.buy = j.rel; }); }
      if (r === 'p' && !this.specs) { var me2 = this; this.specs = {}; fetch('/data/specs.json?v=1').then(function (x) { return x.json(); }).then(function (d) { me2.specs = d; }).catch(function () {}); }
      if (r === 'p') this.dtab = '';
      if (r === 'p' && a && this.cat.length && !this.map[a] && this.fixPart()) return;
      if (r === 'p' && a) { var rc = this.recent.filter(function (c) { return c !== a; }); rc.unshift(a); this.recent = rc.slice(0, 12); write('mx-portal-recent', this.recent); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    // a product link typed loosely (no brand prefix, no dots, lowercase): go to the part, or to search when ambiguous
    fixPart: function () {
      var a = this.arg, nq = norm(a); if (nq.length < 4) return false;
      var hits = this.cat.filter(function (x) { var s = six(x); return s.c === nq || s.c2 === nq; });
      if (hits.length === 1) { location.replace('#/p/' + encodeURIComponent(hits[0][0])); return true; }
      if (hits.length > 1 || matchSearch(this.cat, a).length) { location.replace('#/s/' + encodeURIComponent(a)); return true; }
      return false;
    },
    nav: function (r, a) { location.hash = '#/' + r + (a ? '/' + encodeURIComponent(a) : ''); },
    search: function () {
      if (this.sugOn && this.sugI >= 0 && this.sug[this.sugI]) { this.nav('p', this.sug[this.sugI][0]); return; }
      var q = this.qInput.trim(); if (q.length < 2) return;
      var hit = this.cat.length ? exactHit(this.cat, q) : null; if (hit) { this.qInput = ''; this.nav('p', hit[0]); return; }
      this.nav('s', q);
    },
    sugKey: function (e) {
      var n = this.sug.length; if (!n) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.sugOn = true; this.sugI = (this.sugI + 1) % n; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.sugI = this.sugI <= 0 ? n - 1 : this.sugI - 1; }
      else if (e.key === 'Escape') { this.sugOn = false; this.sugI = -1; }
    },
    sugInput: function () { this.sugOn = true; this.sugI = -1; },
    sugBlur: function () { var self = this; setTimeout(function () { self.sugOn = false; }, 180); },
    // sidebar filters; on the home page a click opens the full list with that filter
    toggle: function (g, k) {
      if (g === 'veh') { this.nav('all'); return; }
      var f = this.f;
      if (g === 'photo' || g === 'stock') f[g] = !f[g];
      else { var i = f[g].indexOf(k); if (i < 0) f[g].push(k); else f[g].splice(i, 1); }
      this.limit = 24;
      if (this.route === 'home' || (this.route === 'c' && !(f.cat.length === 1 && f.cat[0] === this.arg))) { history.pushState(null, '', '#/all'); this.route = 'all'; this.arg = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    },
    on: function (g, k) { return g === 'photo' || g === 'stock' ? this.f[g] : this.f[g].indexOf(k) >= 0; },
    clearF: function () { this.f = { cat: [], brand: [], eng: [], photo: false, stock: false }; if (this.route === 'c') { history.replaceState(null, '', '#/all'); this.route = 'all'; } },
    genOf: function (key) { var out = null; this.fit.tree.forEach(function (m) { m.engines.forEach(function (e) { e.gens.forEach(function (g) { if (g.key === key) out = g; }); }); }); return out; },
    logos: function (k) { return { ford: ['ford.png'], ram: ['ram.png'], gm: ['chevrolet.svg', 'gmc.png'], nissan: ['nissan.svg'] }[k] || []; },
    pickMake: function (k) {
      this.vMake = this.vMake === k ? '' : k; if (this.vMake) this.vLast = this.vMake; this.vEng = '';
      if (this.vMake && window.innerWidth <= 760) setTimeout(function () { var el = document.querySelector('.px-engs-w'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' }); }, 60);
    },
    loadAdmin: function () { var self = this; api('admin-list').then(function (r) { if (r.sync) self.sync = r.sync; if (r.accounts) self.accounts = r.accounts.map(function (a) { return Object.assign(a, { _q: a.customerNumber || '', _res: null, _pick: null, _busy: false }); }); }); },

    // display helpers
    brandOf: function (r) { if (!r) return ''; if (r[4]) return r[4]; var m = String(r[0]).match(/^([A-Z]{2,3})[.\-]/); return m && BRP[m[1]] || ''; },
    info: function (r) { var i = parse(r && r[1]), sp = r && this.specs && this.specs[r[0]]; i.app = nice(sp && sp.eng ? sp.eng : i.app); if (/^bench \/ shop use$/i.test(i.app)) i.app = ''; return i; },
    // has a photo on file (ignores load failures, so shelves do not reshuffle; failed photos show the placeholder)
    hasImg: function (code) { if (BENCH[code]) return true; var u = this.imgs[code] || (this.book && this.book.items[code] && this.book.items[code][2]); return !!(u && /^https:/.test(u)); },
    img: function (code) { if (this.bad[code]) return ''; if (BENCH[code]) return BENCH[code]; var u = this.imgs[code] || (this.book && this.book.items[code] && this.book.items[code][2]); return u && /^https:/.test(u) ? u : ''; },
    price: function (code) { var p = this.book && this.book.items[code]; return p ? p[0] : null; },
    qty: function (code) { var p = this.book && this.book.items[code]; return p ? p[1] : null; },
    stockClass: function (code) { var n = this.qty(code); return n == null || n <= 0 ? 'out' : n < 5 ? 'low' : ''; },
    stockText: function (code) { var n = this.qty(code); if (n == null) return 'Ask us'; if (n <= 0) return 'Backorder'; return n < 5 ? 'Only ' + n + ' left' : 'In stock'; },
    name: function (code) { var r = this.map[code]; return r ? this.title(r) : code; },
    qClose: function () { var self = this; if (!this.qOpen || this.qClosing) return; this.qClosing = true; setTimeout(function () { self.qOpen = false; self.qClosing = false; var f = document.querySelector('.px-fab-b.red'); if (f) f.focus(); }, 210); },
    fmt: function (n) { return n == null ? (this.logged ? 'Price on request' : 'Ask us') : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    ago: function (t) { if (!t) return 'recently'; var m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; },
    date: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    label: function (s) { return { Received: 'Received', Parked: 'In review', Placed: 'Approved', Backordered: 'Backordered', Completed: 'Shipped and invoiced', Deleted: 'Cancelled' }[s] || s; },
    // tracker steps filled: Order placed, In review, Approved, Shipped, Invoiced (matches the status pill)
    stepOf: function (o) { return { Received: 1, Parked: 2, Placed: 3, Backordered: 3, Completed: 5 }[o.status] || 1; },
    bench: function (code) { return !!BENCH[code]; },
    title: function (r) {
      if (!r || !r[0]) return '';
      var sp = this.specs && this.specs[r[0]]; if (sp && sp.title) return nice(sp.title);
      if (TFIX[r[0]]) return TFIX[r[0]];
      var t = nice(parse(r[1]).title), letters = '', up = 0;
      if (t.split(/\s+/).length <= 3) { var br = this.brandOf(r), mpn = r[0].replace(/^[A-Z]{2,4}[.\-]/, ''), ap = nice(parse(r[1]).app); t = [br && t.toLowerCase().indexOf(br.toLowerCase()) < 0 ? br : '', mpn, t].filter(Boolean).join(' ') + (ap && ap.length < 60 ? ' for ' + ap : ''); }
      if (false) t = t.toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); }).replace(/\b(Gm|Hd|Cr|Hp|Ve|Usa|Dpf|Def|Egr|Nox|Scr|Isx|Isb|Isc|Isl|Qsb|Lml|Lmm|Lbz|Lly|Lb7|L5p|Cp3|Cp4|Ecm|Oem)\b/g, function (w) { return w.toUpperCase(); });
      return t.replace(/(\w)-(?=\w)/g, '$1\u2011');
    },
    icon: function (k) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[k] || '') + '</svg>'; },
    cartQty: function (code) { var l = this.cart.filter(function (x) { return x.code === code; })[0]; return l ? l.qty : 0; },
    inQuote: function (code) { return this.quote.some(function (x) { return x.id === code; }); },
    qSet: function (i, n) { n = parseInt(n, 10) || 0; if (n <= 0) this.quote.splice(i, 1); else this.quote[i].qty = Math.min(9999, n); write(QK, this.quote); },
    pts: function (code) { var p = this.price(code); return p == null ? 0 : Math.round(p * this.REWARDS.rate); },
    copy: function (txt) { var self = this; try { navigator.clipboard.writeText(txt).then(function () { self.flash('Part number copied'); }); } catch (e) {} },
    pick: function (code) { return this.picks[code] || 1; },
    setPick: function (code, v) { this.picks[code] = Math.max(1, Math.min(9999, parseInt(v, 10) || 1)); },

    // quote list (anonymous) and cart (signed in)
    // one stepper per product: before adding it picks the quantity, once in the quote it edits the quote line itself
    sq: function (code) { return this.inQuote(code) ? this.quoteQty(code) : this.pick(code); },
    sqSet: function (code, v) {
      if (String(v).trim() === '' || isNaN(parseInt(v, 10))) return;
      if (!this.inQuote(code)) return this.setPick(code, v);
      var n = parseInt(v, 10) || 0, i = -1; this.quote.forEach(function (x, j) { if (x.id === code) i = j; });
      if (i >= 0) { this.qSet(i, n); if (n <= 0) this.flash('Removed from your quote list'); }
    },
    openQuote: function () { this.qOpen = true; },
    // same pattern for the cart: once the part is in the cart the stepper edits the cart line
    cs: function (code) { return this.inCart(code) ? this.cartQty(code) : this.pick(code); },
    csSet: function (code, v) {
      if (String(v).trim() === '' || isNaN(parseInt(v, 10))) return;
      if (!this.inCart(code)) return this.setPick(code, v);
      var n = parseInt(v, 10) || 0, i = -1; this.cart.forEach(function (x, j) { if (x.code === code) i = j; });
      if (i >= 0) { this.setQty(i, n); if (n <= 0) this.flash('Removed from your cart'); }
    },
    imgFail: function (code) { if (code && !this.bad[code]) this.bad[code] = 1; },
    // part number with line-break points after dots and dashes, never mid-group
    pnw: function (code) { return String(code || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/([.\-\/])/g, '$1<wbr>'); },
    catLabel: function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; return c ? c.label : k; },
    catIc: function (k) { var c = CATS.filter(function (x) { return x.k === k; })[0]; return c ? c.ic : 'all'; },
    ph: function (k) { return '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[this.catIc(k)] || '') + '</svg><span>Photo on request</span>'; },
    wa: function (line, code) { var t = 'Hi Maxzz, ' + (code ? 'about part ' + code + ': ' : '') + 'I would like to check price and availability.'; return 'https://wa.me/' + (line === 'latam' ? '17867164857' : '19543716996') + '?text=' + encodeURIComponent(t); },
    quoteQty: function (code) { var l = this.quote.filter(function (x) { return x.id === code; })[0]; return l ? l.qty : 0; },
    addQuote: function (code, n) {
      var r = this.map[code]; if (!r) return; n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.quote.filter(function (x) { return x.id === code; })[0];
      if (l) l.qty += n; else this.quote.push({ id: code, name: r[1], pn: code, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: n });
      write(QK, this.quote); this.picks[code] = 1;
      this.flash(n + ' added to your quote list', 'quote'); this.pop(); track('quote_add_item', { item_id: code, quantity: n, source: 'store' });
    },
    save: function () { write(CK, this.cart); },
    inCart: function (code) { return this.cart.some(function (l) { return l.code === code; }); },
    add: function (code, n) {
      if (!this.canOrder) return this.addQuote(code);
      n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.cart.filter(function (x) { return x.code === code; })[0];
      if (l) l.qty += n; else this.cart.push({ code: code, qty: n });
      this.picks[code] = 1; this.save(); this.pop(); this.flash('Added to cart. ' + this.cart.length + (this.cart.length === 1 ? ' part' : ' parts') + ' in your cart', 'cart');
      track('add_to_cart', { item_id: code, quantity: n, source: 'store' });
    },
    setQty: function (i, v) { var n = parseInt(v, 10) || 0; if (n <= 0) return this.remove(i); this.cart[i].qty = Math.min(9999, n); this.save(); },
    remove: function (i) { this.cart.splice(i, 1); this.save(); },
    clearCart: function () { this.cart.splice(0); this.save(); },
    lineTotal: function (l) { var p = this.price(l.code); return p == null ? 0 : p * l.qty; },
    find: function (raw) {
      var n = norm(raw); if (n.length < 4) return null;
      var hit = this.cat.filter(function (r) { return norm(r[0]) === n; })[0];
      if (!hit) hit = this.cat.filter(function (r) { var c = norm(r[0]); return c.length > n.length && c.slice(-n.length) === n && /^[A-Z]{1,4}$/.test(c.slice(0, c.length - n.length)); })[0];
      return hit ? hit[0] : null;
    },
    addPaste: function () {
      var self = this, ok = 0, miss = [], noPrice = [];
      this.paste.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^(.*?)[\s,;\t]+(\d{1,5})\s*$/), code = m ? m[1] : line, n = m ? Math.min(9999, parseInt(m[2], 10)) : 1, hit = self.find(code);
        if (!hit) { miss.push(code); return; }
        if (self.flow === 'quote' || self.price(hit) == null) {
          var r = self.map[hit], q = self.quote.filter(function (x) { return x.id === hit; })[0];
          if (q) q.qty += n; else if (r) self.quote.push({ id: hit, name: r[1], pn: hit, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: n });
          if (self.flow === 'quote') ok++; else noPrice.push(hit); return;
        }
        var l = self.cart.filter(function (x) { return x.code === hit; })[0]; if (l) l.qty += n; else self.cart.push({ code: hit, qty: n }); ok++;
      });
      this.save(); write(QK, this.quote);
      var notes = this.qd.notes || '', fresh = miss.filter(function (m) { return notes.indexOf(m) < 0; });
      if (this.flow === 'quote' && fresh.length) this.qd.notes = ((notes ? notes + '\n' : '') + 'Not listed online, please check: ' + fresh.join(', ')).slice(0, 1900);
      this.pasteMiss = miss.slice(0, 30);
      var pm = [];
      if (ok) pm.push(ok + (ok === 1 ? ' part added' : ' parts added'));
      if (miss.length) pm.push((ok ? 'Not found: ' : 'Not listed online: ') + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '...' : '') + (this.flow === 'quote' && this.lines.length ? '. We added them to your notes so sales can check them' : '. Send them to our sales team'));
      if (noPrice.length) pm.push('No online price, moved to your quote list: ' + noPrice.slice(0, 6).join(', '));
      this.pasteMsg = pm.length ? pm.join('. ') + '.' : 'Nothing to add.';
      this.pasteWarn = !!miss.length;
      // the textarea keeps only what still needs attention, so a second click cannot add the same lines twice
      this.paste = this.flow === 'quote' ? '' : miss.join('\n');
    },
    reorder: function (o) {
      var self = this;
      var skipped = 0;
      o.lines.forEach(function (x) {
        if (self.price(x.code) == null) {
          var r = self.map[x.code], q = self.quote.filter(function (z) { return z.id === x.code; })[0];
          if (q) q.qty += x.qty; else self.quote.push({ id: x.code, name: r ? r[1] : (x.name || x.code), pn: x.code, app: r ? r[3] : '', cat: r ? r[3] : '', slug: r ? r[2] : '', img: '', pos: '', qty: x.qty });
          skipped++; return;
        }
        var l = self.cart.filter(function (c) { return c.code === x.code; })[0]; if (l) l.qty += x.qty; else self.cart.push({ code: x.code, qty: x.qty });
      });
      this.save(); write(QK, this.quote); this.nav('cart'); var n = o.lines.length - skipped; if (!n) { this.nav('quote'); this.flash('Added to your quote list. These parts are priced by sales.', 'quote'); return; }
      this.flash(n + (n === 1 ? ' part' : ' parts') + ' added to your cart' + (skipped ? '. ' + skipped + ' without online price added to your quote list' : ''), skipped ? 'quote' : 'cart');
    },
    placeOrder: function () {
      var self = this; if (this.busy) return; this.busy = true; this.err = '';
      if (this.noPriceLines.length) { this.busy = false; this.err = 'Remove the parts without online price first (' + this.noPriceLines.join(', ') + '). You can send them as a quote request.'; return; }
      if (!this.idem) this.idem = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var body = { idem: this.idem, po: this.co.po, notes: this.co.notes, lines: this.cart.map(function (l) { return { code: l.code, qty: l.qty }; }),
        ship: { name: this.co.name, street: this.pickup ? '' : this.co.street, city: this.pickup ? '' : this.co.city, state: this.pickup ? '' : this.co.state, zip: this.pickup ? '' : this.co.zip, country: this.co.country, method: this.co.method, fwd: this.co.fwd } };
      write('mx-portal-ship', { method: this.co.method, name: this.co.name, street: this.co.street, city: this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, fwd: this.co.fwd });
      api('order', { body: body }).then(function (r) {
        self.busy = false;
        if (r._status !== 200) { self.err = r.error || 'We could not place the order. Please try again.'; return; }
        if (!r.order) { self.idem = ''; self.clearCart(); self.nav('orders'); self.flash('Order received. It will show in your orders shortly.', 'cart'); return; }
        track('generate_lead', { form: 'portal_order', quote_id: r.order.number, items: r.order.lines.length });
        self.idem = '';
        self.orders.unshift(r.order); self.cur = r.order; self.justPlaced = r.order.id; self.co.po = ''; self.co.notes = '';
        self.nav('o', r.order.id); self.flash('Order received. We will e-mail you when it is approved.');
        setTimeout(function () { self.cart.splice(0); self.save(); }, 0);
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Your cart is saved; try again.'; });
    },

    // sign in and access
    sendLink: function () {
      var self = this; this.busy = true; this.err = '';
      api('login', { body: { email: this.email } }).then(function (r) {
        self.busy = false;
        if (r._status === 429) { self.err = 'Too many attempts. Wait a few minutes and try again.'; return; }
        if (r._status !== 200) { self.err = 'Check the e-mail address.'; return; }
        if (r.direct) { track('login', { method: 'email_link' }); location.href = '/portal'; return; }
        track('login_link_sent', { pending: !!r.pending }); self.sentPending = !!r.pending; self.nav('sent');
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendRequest: function () {
      var self = this, hp = document.getElementById('px-hp');
      this.rqTried2 = true; if (!this.rq.company.trim()) { setTimeout(function () { var c = document.querySelector('[autocomplete=organization]'); if (c) c.focus(); }, 30); return; }
      this.busy = true; this.err = '';
      this.rq.phone = this.maskPhone(this.rq.phone, this.rq.country, true);
      api('request', { body: Object.assign({}, this.rq, { hp: hp ? hp.value : '', t: Date.now() - T0 }) }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { track('b2b_access_request', { form: 'portal' }); self.nav('requested'); }
        else self.err = r._status === 429 ? 'Too many requests from this connection. Try later or call us.' : 'Please fill in name, company, e-mail and phone.';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendQuote: function () {
      var self = this, hp = document.getElementById('px-qhp'), t = new Date();
      if (!this.quote.length || this.busy) return;
      if (this.qd.phone) this.qd.phone = this.maskPhone(this.qd.phone, this.qd.country, true);
      var me = this.me, acc = me && me.account, d = Object.assign({}, this.qd);
      if (me) { d.name = me.name || this.firstName; d.email = me.email; d.company = acc ? acc.company : 'Maxzz Diesel (internal)'; if (!d.phone) d.phone = me.phone || ''; d.type = d.type || (acc ? 'Approved B2B account ' + (acc.code || '') : 'Internal'); }
      var snap = this.doc; if (snap && snap.none) snap = null;
      var number = 'QR-' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var lines = this.quote.map(function (l) { return { pn: l.id, name: String(self.title(self.map[l.id]) || l.name || '').replace(/\u2011/g, '-'), qty: l.qty }; });
      this.busy = true; this.err = '';
      fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: number, source: 'B2B store' + (this.me && this.me.account ? ' · account ' + (this.me.account.code || this.me.account.company) : ''), hp: hp ? hp.value : '', t: Date.now() - T0,
        customer: { name: d.name, company: d.company, email: d.email, phone: d.phone, type: d.type, notes: d.notes }, shipping: Object.assign({ po: d.po, needBy: d.needBy }, me ? this.qShip : { country: d.country, city: d.city }), lines: lines }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (res) {
          if (res && res.id) number = res.id;
          track('generate_lead', { form: 'store_quote', quote_id: number, items: lines.length });
          self.busy = false; self.qSent = { id: number, email: d.email, from: snap ? snap.billTo : [d.name, d.company, d.email], ship: snap ? snap.shipTo : [], refs: snap ? snap.refs : [], notes: d.notes, lines: lines.map(function (l) { return { code: l.pn, name: l.name, qty: l.qty, price: null }; }) };
          self.qd.notes = ''; self.qd.po = ''; self.qd.needBy = '';
          if (self.me) self.myQuotes.unshift({ id: number, created: Date.now(), status: 'Sent', lines: lines });
          setTimeout(function () { self.quote.splice(0); write(QK, []); }, 0); window.scrollTo({ top: 0, behavior: 'smooth' });
        })
        .catch(function () { self.busy = false; self.err = 'We could not send it right now. Try again, or e-mail the list to sales@maxzzdiesel.com.'; });
    },
    logout: function () { api('logout', { body: {} }).then(function () { location.href = '/portal'; }); },

    // admin
    lookup: function (a) { var self = this; if (!a._q.trim()) return; a._busy = true; api('admin-lookup?code=' + encodeURIComponent(a._q.trim())).then(function (r) { a._busy = false; a._res = r.customers || []; if (r.error) self.flash(r.error); }); },
    approve: function (a) { var self = this; api('admin-approve', { body: { account: a.id, customer: a._pick } }).then(function (r) { if (r._status === 200) { self.flash('Approved. Access e-mail sent.'); self.loadAdmin(); } else self.flash(r.error || 'Could not approve'); }); },
    reject: function (a) { var reason = prompt('Reason (optional, sent to the customer):'); if (reason === null) return; var self = this; api('admin-reject', { body: { account: a.id, reason: reason, notify: true } }).then(function () { self.flash('Declined'); self.loadAdmin(); }); },
    moveInd: function (nav) { var a = nav && nav.querySelector('a.on'), i = nav && nav.querySelector('.px-dind'); if (!a || !i) return; i.style.width = a.offsetWidth + 'px'; i.style.transform = 'translateX(' + a.offsetLeft + 'px)'; },
    pop: function () { try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; requestAnimationFrame(function () { document.querySelectorAll('.px-fab-b .n, .pxh-ic .pxh-n, .px-kpis b').forEach(function (e) { e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }); }); } catch (e) {} },
    flash: function (m, kind) { var self = this; this.toast = m; this.toastKind = kind || ''; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  PetiteVue.createApp(app).mount('#app');
})();
