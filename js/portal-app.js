/* Maxzz B2B store (petite-vue).
   Open catalog for everyone; prices, stock, cart and orders only for signed-in, approved customers.
   Anonymous visitors can add parts to the quote list (/quote), the same list the rest of the site uses. */
(function () {
  var CK = 'mx-portal-cart', QK = 'mx-quote';
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
    var parts = d.split(/\s*\/\s*Application:\s*/i);
    var title = (parts[0] || '').replace(/\s*\/\s*$/, '').trim();
    var app = (parts[1] || '').replace(/\s*\/\s*$/, '').replace(/\s*\/\s*/g, ' · ').trim();
    if (!parts[1] && title.indexOf(' / ') > 0) { var p2 = title.split(' / '); title = p2.shift(); app = p2.join(' · '); }
    return { title: title || desc, app: app, xr: xr };
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
  function matchSearch(list, a) {
    var nq = norm(a), words = String(a).toLowerCase().split(/\s+/).filter(Boolean);
    var hits = list.filter(function (x) {
      if (nq.length >= 3 && norm(x[0]).indexOf(nq) >= 0) return true;
      var hay = (x[1] + ' ' + x[0] + ' ' + (x[4] || '') + ' ' + (x[3] || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return hits.sort(function (p, q) { return (norm(q[0]).indexOf(nq) === 0) - (norm(p[0]).indexOf(nq) === 0); });
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
  var ROUTES = ['home', 'c', 's', 'g', 'all', 'p', 'cart', 'checkout', 'orders', 'o', 'login', 'sent', 'request', 'requested', 'pending', 'admin', 'quote', 'rewards'];
  var T0 = Date.now();

  var app = PetiteVue.reactive({
    route: 'home', arg: '', me: null, book: null, cat: [], map: {}, fit: { tree: [], items: {}, rel: {} }, imgs: {},
    err: '', busy: false, toast: '', toastKind: '', ordersLoaded: false, idem: '', meLoaded: false, myQuotes: [], hbg: 0, email: '', sentPending: false,
    rq: { name: '', company: '', email: '', phone: '', city: '', state: '', zip: '', country: 'United States', type: '', customerNumber: '', notes: '' }, rqStep: 1, rqTried: false, rqTried2: false, zipMsg: '',
    q: '', qInput: '', limit: 24, picks: {}, cart: read(CK, []), quote: read(QK, []), qOpen: false, qSent: null, justPlaced: '', qd: { name: '', company: '', email: '', phone: '', type: '', country: 'United States', city: '', po: '', notes: '', needBy: '' },
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
    vMake: '', vEng: '', f: { cat: [], brand: [], eng: [], photo: false, stock: false }, allBrands: false, showF: false, sugOn: false, sugI: -1,
    co: Object.assign({ po: '', method: 'Ground', name: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: '', fwd: '' }, read('mx-portal-ship', {}), { po: '', notes: '' }),
    orders: [], cur: null, accounts: [], sync: null,

    get cats() { var self = this; return CATS.map(function (c) { return Object.assign({ n: self.cat.filter(function (r) { return r[3] === c.k; }).length }, c); }).filter(function (c) { return c.n; }); },
    get logged() { return !!(this.me && (this.me.admin || (this.me.account && this.me.account.status === 'approved'))); },
    get canOrder() { return !!(this.me && this.me.account && this.me.account.status === 'approved'); },
    get pendingCount() { return this.accounts.filter(function (a) { return a.status === 'pending'; }).length; },
    get curMake() { var k = this.vMake; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get featured() {
      var self = this, picks = Object.keys(BENCH).concat(['BO.0.986.435.433', 'BO.0.986.435.410', 'BO.0.445.117.023', 'BO.0.445.020.146']);
      var out = picks.map(function (c) { return self.map[c]; }).filter(Boolean);
      out = out.filter(function (r) { return self.img(r[0]); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if ((r[3] === 'Injector' || r[3] === 'Pump') && self.img(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.img(r[0]) && out.indexOf(r) < 0) out.push(r); return false; });
      return out.slice(0, 8);
    },
    get engs() { return ENG; },
    get side() { return ['home', 'c', 's', 'g', 'all'].indexOf(this.route) >= 0; },
    get listTitle() {
      var r = this.route, a = this.arg, f = this.f;
      if ((r === 'c' || r === 'all') && f.cat.length === 1) { var c = CATS.filter(function (x) { return x.k === f.cat[0]; })[0]; return c ? c.label : f.cat[0]; }
      if (r === 's') return 'Results for "' + a + '"';
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
      if (f.photo) out.push({ g: 'photo', label: 'With photo' });
      if (f.stock) out.push({ g: 'stock', label: 'In stock' });
      return out;
    },
    get sug() { var q = this.qInput.trim(); if (q.length < 2 || !this.cat.length) return []; return matchSearch(this.cat, q).slice(0, 8); },
    get moreRow() {
      var self = this, out = [], feat = this.featured;
      ['Pump', 'Tool', 'Nozzle'].forEach(function (k) { var n = 0; self.cat.some(function (r) { if (r[3] === k && self.img(r[0]) && out.indexOf(r) < 0 && feat.indexOf(r) < 0) { out.push(r); n++; } return n >= (k === 'Pump' ? 2 : 1); }); });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (self.img(r[0]) && r[3] !== 'Injector' && out.indexOf(r) < 0 && feat.indexOf(r) < 0) out.push(r); return false; });
      return out.slice(0, 8);
    },
    get shown() { return this.results.slice(0, this.limit); },
    get product() { return this.route === 'p' ? this.map[this.arg] || null : null; },
    get related() {
      var self = this, p = this.product; if (!p) return [];
      var sr = this.spec && this.spec.rel ? this.spec.rel.split(/\s*,\s*/) : [], codes = (this.fit.rel[p[0]] || []).concat(sr), seen = {};
      return codes.filter(function (c) { if (seen[c] || c === p[0]) return false; seen[c] = 1; return true; }).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 8);
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
      if (this.step !== 3) return null;
      var ls = this.lines.map(function (l) { return { code: l.code, name: self.name(l.code), qty: l.qty, price: self.price(l.code) }; });
      if (this.flow === 'order') {
        var c = this.co;
        return { kind: 'order', number: 'Number on confirmation', email: me && me.email, billTo: who().filter(Boolean),
          shipTo: this.pickup ? ['Will call', 'Pick up in Coconut Creek, FL'] : [c.name, c.street, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country, c.fwd ? 'Forwarder: ' + c.fwd : ''].filter(Boolean),
          refs: ['Date ' + now, c.po ? 'PO ' + c.po : 'No PO', c.method].filter(Boolean), lines: ls, priced: true, total: this.flowTotal, units: this.units, notes: c.notes };
      }
      var d = this.qd;
      return { kind: 'quote', number: 'Number on confirmation', email: me ? me.email : d.email, billTo: who().filter(Boolean),
        shipTo: [me && acc ? acc.company : d.company, d.city, d.country].filter(Boolean), refs: ['Date ' + now, d.po ? 'PO ' + d.po : 'No PO', d.needBy ? 'Needed by ' + d.needBy : ''].filter(Boolean),
        lines: ls, priced: this.showPrice, total: this.flowTotal, units: this.units, notes: d.notes };
    },
    setLn: function (i, n) { n = parseInt(n, 10) || 0; if (this.flow === 'quote') return this.qSet(i, n); if (n <= 0) this.remove(i); else { this.cart[i].qty = Math.min(9999, n); this.save(); } },
    moveToQuote: function (i) { var c = this.cart[i]; if (!c) return; this.addQuote(c.code); var l = this.quote.filter(function (x) { return x.id === c.code; })[0]; if (l) { l.qty = c.qty; write(QK, this.quote); } this.remove(i); },
    clearFlow: function () { if (!confirm('Remove every part from this list?')) return; if (this.flow === 'quote') { this.quote.splice(0); write(QK, []); } else this.clearCart(); },
    next: function () {
      this.err = '';
      if (this.step === 1) {
        if (this.flow === 'order' && this.noPriceLines.length) { this.err = ''; this.flash('Move the parts without online price to a quote first'); return; }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', this.flow === 'order' ? '' : 'details');
      }
      if (this.step === 2) {
        if (this.flow === 'order' && !this.pickup && (!this.co.street.trim() || !this.co.city.trim())) { this.err = 'Fill in the street address and city, or choose Will call.'; return; }
        if (this.flow === 'quote' && !this.me) { var d = this.qd; if (!d.name.trim() || !d.company.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || d.phone.replace(/\D/g, '').length < 7) { this.err = 'Fill in name, company, e-mail and phone.'; return; } }
        return this.nav(this.flow === 'order' ? 'checkout' : 'quote', 'review');
      }
    },
    confirmFlow: function () { return this.flow === 'order' ? this.placeOrder() : this.sendQuote(); },
    get adminBar() { return !!(this.me && this.me.admin && this.pendingCount); },
    // what the customer follows after sending: the number and the stages it goes through
    get track() {
      var d = this.doc; if (!d) return null;
      if (d.kind === 'order') {
        var st = this.cur ? this.stepOf(this.cur) + 1 : 1;
        return { label: 'Your order number', steps: ['Order placed', 'In review', 'Approved', 'Shipped', 'Invoiced'], at: st };
      }
      return { label: 'Your quote number', steps: ['Request sent', 'In review', 'Quote sent to you', 'Accepted', 'Shipped'], at: 1 };
    },
    get hi() { return this.firstName ? this.firstName + ', ' : ''; },
    get usPhone() { return /United States|Puerto Rico|Canada/.test(this.rq.country); },
    get zipLabel() { return this.rq.country === 'Brazil' ? 'CEP' : /United States|Puerto Rico/.test(this.rq.country) ? 'ZIP' : 'Postal code'; },
    okEmail: function (e) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(e || '').trim()); },
    okPhone: function (p) { return String(p || '').replace(/\D/g, '').length >= 10; },
    maskPhone: function (v) {
      var d = String(v || '').replace(/\D/g, '');
      if (this.usPhone) { if (d.length === 11 && d[0] === '1') d = d.slice(1); d = d.slice(0, 10); if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
      return v && String(v).trim().charAt(0) === '+' ? '+' + d.slice(0, 15) : (d ? '+' + d.slice(0, 15) : '');
    },
    rqNext: function () { this.rqTried = true; var r = this.rq; if (!r.name.trim() || !this.okEmail(r.email) || !this.okPhone(r.phone)) return; this.rqStep = 2; },
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
          if (city) { r.city = city; r.state = st; self.zipMsg = 'Found: ' + city + (st ? ', ' + st : ''); }
        }).catch(function () { self.zipMsg = ''; });
      }, 300);
    },
    get lp() { return this.route === 'request' || this.route === 'login'; },
    get needLogin() { var r = this.route; if (r === 'admin') return !(this.me && this.me.admin); if (r === 'orders') return !this.me && this.meLoaded; return ['cart', 'checkout', 'o'].indexOf(r) >= 0 && !this.canOrder && this.meLoaded; },
    get noPriceLines() { var self = this; return this.cart.filter(function (l) { return self.price(l.code) == null; }).map(function (l) { return l.code; }); },
    get pickup() { return /will call/i.test(this.co.method); },
    get blurb() {
      var p = this.product; if (!p) return '';
      var sp = this.spec, d = sp.desc ? String(sp.desc).split('</p>')[0].replace(/<[^>]+>/g, '').replace(/\s*Ships from our [^.]*\.\s*/i, ' ').trim() : '';
      if (d) return d;
      var i = parse(p[1]), type = (sp.type || p[3] || '').toLowerCase();
      return [p[4], type].filter(Boolean).join(' ').replace(/^./, function (c) { return c.toUpperCase(); }) + (i.app ? ' for ' + i.app : '') + '.' + (i.xr.length ? ' Same as ' + i.xr.slice(0, 3).join(', ') + '.' : '');
    },
    get spec() { var p = this.product; return (p && this.specs && this.specs[p[0]]) || {}; },
    get keyFacts() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), out = [];
      if (!p) return out;
      if (sp.eng) out.push(['Engine', sp.eng]);
      if (sp.models) out.push(['Vehicles', sp.models]);
      if (!sp.eng && i.app) out.push(['Application', i.app]);
      if (sp.inj) out.push(['Used in', sp.inj]);
      if (p[4]) out.push(['Brand', p[4]]);
      if (sp.cond) out.push(['Condition', sp.cond]);
      if (this.xrefs.length) out.push(['Cross references', this.xrefs.length + ' numbers, see below']);
      return out;
    },
    get specRows() {
      var p = this.product, sp = this.spec || {}, i = parse(p && p[1]), r = [];
      if (!p) return r;
      r.push(['Maxzz part number', p[0]]);
      var pn = p[0].replace(/^[A-Z]{2}\./, '');
      r.push(['Manufacturer part number', pn]);
      if (p[4]) r.push(['Brand', p[4]]);
      r.push(['Part type', sp.type || p[3]]);
      if (sp.cond) r.push(['Condition', sp.cond]);
      if (sp.eng) r.push(['Engine / generation', sp.eng]);
      if (sp.make) r.push(['Vehicle make', sp.make]);
      if (sp.y0) r.push(['Model years', sp.y0 + (sp.y1 ? ' to ' + sp.y1 : ' to today')]);
      if (sp.models) r.push(['Vehicles', sp.models]);
      if (sp.inj) r.push(['Used in injectors', sp.inj]);
      if (!sp.eng && i.app) r.push(['Application (from catalog)', i.app]);
      var u = this.book && this.book.items[p[0]] && this.book.items[p[0]][3]; if (u) r.push(['Unit', u]);
      r.push(['Catalog description', p[1]]);
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
      fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (rows) { self.cat = rows; var m = {}; rows.forEach(function (r) { m[r[0]] = r; }); self.map = m; });
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).then(function (f) { self.fit = f; }).catch(function () {});
      fetch('/data/specs.json?v=1').then(function (r) { return r.json(); }).then(function (d) { self.specs = d; }).catch(function () {});
      fetch('/api/portal/images').then(function (r) { return r.json(); }).then(function (m) { self.imgs = m || {}; }).catch(function () {});
      api('me').then(function (me) {
        self.meLoaded = true;
        if (me._status === 200) {
          self.me = me;
          if (me.account) self.co.name = me.account.company;
          api('prices').then(function (b) { if (b._status === 200) self.book = b; });
          if (me.account) api('orders').then(function (o) { if (o.orders) { self.orders = o.orders; if (self.route === 'o') self.cur = o.orders.filter(function (x) { return x.id === self.arg; })[0] || null; } self.ordersLoaded = true; });
          if (me.admin) self.loadAdmin();
          api('quotes').then(function (q) { if (q.quotes) self.myQuotes = q.quotes; });
        }
      });
      window.addEventListener('hashchange', function () { self.readHash(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { self.qOpen = false; self.showF = false; } });
      this.readHash();
    },
    readHash: function () {
      var raw = (location.hash || '').replace(/^#\/?/, ''), h; try { h = decodeURIComponent(raw); } catch (e) { h = raw; }
      var i = h.indexOf('/');
      var r = i < 0 ? h : h.slice(0, i), a = i < 0 ? '' : h.slice(i + 1);
      if (r && ROUTES.indexOf(r) < 0) { location.replace('#/'); return; }
      this.route = r || 'home'; this.arg = a; this.err = ''; this.limit = 24; this.sugOn = false; this.showF = false;
      if (r === 's') this.qInput = a;
      if (r === 'c') this.f = { cat: [a], brand: [], eng: [], photo: false, stock: false };
      if (r === 's' || r === 'g') this.f = { cat: [], brand: [], eng: [], photo: false, stock: false };
      if (r === 'orders' && this.me) { var s3 = this; api('quotes').then(function (q) { if (q.quotes) s3.myQuotes = q.quotes; }); }
      if (r === 'orders' && this.me && this.me.account) { var self = this; api('orders').then(function (o) { if (o.orders) self.orders = o.orders; }); }
      if (r === 'o') this.cur = this.orders.filter(function (o) { return o.id === a; })[0] || null;
      if (r === 'checkout' && !this.cart.length) { location.hash = '#/cart'; return; }
      if (r === 'quote' && a && !this.quote.length && !this.qSent) { location.hash = '#/quote'; return; }
      this.qOpen = false; if (r !== 'quote') this.qSent = null;
      if (r === 'quote' && this.me) { var acc = this.me.account; if (!this.qd.email) this.qd.email = this.me.email; if (!this.qd.name) this.qd.name = this.me.name || ''; if (!this.qd.company && acc) this.qd.company = acc.company; }
      if (r === 'p' && !this.specs) { var me2 = this; this.specs = {}; fetch('/data/specs.json?v=1').then(function (x) { return x.json(); }).then(function (d) { me2.specs = d; }).catch(function () {}); }
      if (r === 'p') this.dtab = '';
      if (r === 'p' && a) { var rc = this.recent.filter(function (c) { return c !== a; }); rc.unshift(a); this.recent = rc.slice(0, 12); write('mx-portal-recent', this.recent); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    nav: function (r, a) { location.hash = '#/' + r + (a ? '/' + encodeURIComponent(a) : ''); },
    search: function () {
      if (this.sugOn && this.sugI >= 0 && this.sug[this.sugI]) { this.nav('p', this.sug[this.sugI][0]); return; }
      var q = this.qInput.trim(); if (q.length >= 2) this.nav('s', q);
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
    pickMake: function (k) { this.vMake = this.vMake === k ? '' : k; this.vEng = ''; },
    loadAdmin: function () { var self = this; api('admin-list').then(function (r) { if (r.sync) self.sync = r.sync; if (r.accounts) self.accounts = r.accounts.map(function (a) { return Object.assign(a, { _q: a.customerNumber || '', _res: null, _pick: null, _busy: false }); }); }); },

    // display helpers
    info: function (r) { return parse(r && r[1]); },
    img: function (code) { if (BENCH[code]) return BENCH[code]; var u = this.imgs[code] || (this.book && this.book.items[code] && this.book.items[code][2]); return u && /^https:/.test(u) ? u : ''; },
    price: function (code) { var p = this.book && this.book.items[code]; return p ? p[0] : null; },
    qty: function (code) { var p = this.book && this.book.items[code]; return p ? p[1] : null; },
    stockClass: function (code) { var n = this.qty(code); return n == null || n <= 0 ? 'out' : n < 5 ? 'low' : ''; },
    stockText: function (code) { var n = this.qty(code); if (n == null) return 'Ask us'; if (n <= 0) return 'Backorder'; return n < 5 ? 'Only ' + n + ' left' : 'In stock'; },
    name: function (code) { var r = this.map[code]; return r ? this.title(r) : code; },
    fmt: function (n) { return n == null ? (this.logged ? 'Price on request' : 'Ask us') : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    ago: function (t) { if (!t) return 'recently'; var m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; },
    date: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    label: function (s) { return { Received: 'Received', Parked: 'In review', Placed: 'Approved', Backordered: 'Backordered', Completed: 'Shipped and invoiced', Deleted: 'Cancelled' }[s] || s; },
    stepOf: function (o) { return { Received: 0, Parked: 0, Placed: 1, Backordered: 1, Completed: 3 }[o.status] || 0; },
    bench: function (code) { return !!BENCH[code]; },
    title: function (r) {
      if (!r || !r[0]) return '';
      var sp = this.specs && this.specs[r[0]]; if (sp && sp.title) return sp.title;
      var t = parse(r[1]).title, letters = t.replace(/[^A-Za-z]/g, ''), up = letters.replace(/[^A-Z]/g, '').length;
      if (letters.length > 6 && up / letters.length > 0.7) t = t.toLowerCase().replace(/\b([a-z])/g, function (c) { return c.toUpperCase(); }).replace(/\b(Gm|Hd|Cr|Hp|Ve|Usa|Dpf|Def|Egr|Nox|Scr|Isx|Isb|Isc|Isl|Qsb|Lml|Lmm|Lbz|Lly|Lb7|L5p|Cp3|Cp4|Ecm|Oem)\b/g, function (w) { return w.toUpperCase(); });
      return t;
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
    addQuote: function (code) {
      var r = this.map[code]; if (!r) return;
      var l = this.quote.filter(function (x) { return x.id === code; })[0];
      if (l) l.qty += 1; else this.quote.push({ id: code, name: r[1], pn: code, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: 1 });
      write(QK, this.quote);
      this.flash('Added to your quote list', 'quote'); track('quote_add_item', { item_id: code, quantity: 1, source: 'store' });
    },
    save: function () { write(CK, this.cart); },
    inCart: function (code) { return this.cart.some(function (l) { return l.code === code; }); },
    add: function (code, n) {
      if (!this.canOrder) return this.addQuote(code);
      n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.cart.filter(function (x) { return x.code === code; })[0];
      if (l) l.qty += n; else this.cart.push({ code: code, qty: n });
      this.picks[code] = 1; this.save(); this.flash('Added to cart. ' + this.cart.length + (this.cart.length === 1 ? ' part' : ' parts') + ' in your cart', 'cart');
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
        if (hit && self.price(hit) == null) { noPrice.push(hit); return; }
        if (hit) { var l = self.cart.filter(function (x) { return x.code === hit; })[0]; if (l) l.qty += n; else self.cart.push({ code: hit, qty: n }); ok++; } else miss.push(code);
      });
      this.save();
      this.pasteMsg = ok + ' added' + (miss.length ? '. Not found: ' + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '...' : '') : '') + (noPrice.length ? '. No online price, add to a quote: ' + noPrice.slice(0, 6).join(', ') : '');
      if (!miss.length && !noPrice.length) this.paste = '';
    },
    reorder: function (o) {
      var self = this;
      var skipped = 0;
      o.lines.forEach(function (x) { if (self.price(x.code) == null) { skipped++; return; } var l = self.cart.filter(function (c) { return c.code === x.code; })[0]; if (l) l.qty += x.qty; else self.cart.push({ code: x.code, qty: x.qty }); });
      this.save(); this.nav('cart'); this.flash((o.lines.length - skipped) + ' parts added to your cart' + (skipped ? '. ' + skipped + ' without online price were left out' : ''));
    },
    placeOrder: function () {
      var self = this; if (this.busy) return; this.busy = true; this.err = '';
      if (this.noPriceLines.length) { this.busy = false; this.err = 'Remove the parts without online price first (' + this.noPriceLines.join(', ') + '). You can send them as a quote request.'; return; }
      if (!this.idem) this.idem = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var body = { idem: this.idem, po: this.co.po, notes: this.co.notes, lines: this.cart.map(function (l) { return { code: l.code, qty: l.qty }; }),
        ship: { name: this.co.name, street: this.pickup ? '' : this.co.street, city: this.pickup ? '' : this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, method: this.co.method, fwd: this.co.fwd } };
      write('mx-portal-ship', { method: this.co.method, name: this.co.name, street: this.co.street, city: this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, fwd: this.co.fwd });
      api('order', { body: body }).then(function (r) {
        self.busy = false;
        if (r._status !== 200) { self.err = r.error || 'We could not place the order. Please try again.'; return; }
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
        if (r.direct) { location.href = '/portal'; return; }
        self.sentPending = !!r.pending; self.nav('sent');
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendRequest: function () {
      var self = this, hp = document.getElementById('px-hp');
      this.rqTried2 = true; if (!this.rq.company.trim()) return;
      this.busy = true; this.err = '';
      api('request', { body: Object.assign({}, this.rq, { hp: hp ? hp.value : '', t: Date.now() - T0 }) }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { track('b2b_access_request', { form: 'portal' }); self.nav('requested'); }
        else self.err = r._status === 429 ? 'Too many requests from this connection. Try later or call us.' : 'Please fill in name, company, e-mail and phone.';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendQuote: function () {
      var self = this, hp = document.getElementById('px-qhp'), t = new Date();
      if (!this.quote.length || this.busy) return;
      var me = this.me, acc = me && me.account, d = Object.assign({}, this.qd);
      if (me) { d.name = me.name || this.firstName; d.email = me.email; d.company = acc ? acc.company : 'Maxzz Diesel (internal)'; if (!d.phone) d.phone = '0000000'; d.type = d.type || (acc ? 'Approved B2B account ' + (acc.code || '') : 'Internal'); }
      var snap = this.doc;
      var number = 'QR-' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var lines = this.quote.map(function (l) { return { pn: l.id, name: self.title(self.map[l.id]) || l.name, qty: l.qty }; });
      this.busy = true; this.err = '';
      fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: number, source: 'B2B store' + (this.me && this.me.account ? ' · account ' + (this.me.account.code || this.me.account.company) : ''), hp: hp ? hp.value : '', t: Date.now() - T0,
        customer: { name: d.name, company: d.company, email: d.email, phone: d.phone, type: d.type, notes: d.notes }, shipping: { country: d.country, city: d.city, po: d.po, needBy: d.needBy }, lines: lines }) })
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
    flash: function (m, kind) { var self = this; this.toast = m; this.toastKind = kind || ''; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  PetiteVue.createApp(app).mount('#app');
})();
