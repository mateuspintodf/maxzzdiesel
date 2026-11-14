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
    { k: 'Rail', label: 'Rails and lines', ic: 'rail' }, { k: 'Repair part', label: 'Repair parts', ic: 'rep' }, { k: 'Tool', label: 'Tools and tool sets', ic: 'tool' },
    { k: 'Engine parts', label: 'Engine parts', ic: 'eng' }
  ];
  var ENG = [{ k: 'c', label: 'Cummins' }, { k: 'd', label: 'Duramax' }, { k: 'f', label: 'Power Stroke' }, { k: 'h', label: 'Heavy duty' }];
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
  var T0 = Date.now();

  var app = PetiteVue.reactive({
    route: 'home', arg: '', me: null, book: null, cat: [], map: {}, fit: { tree: [], items: {}, rel: {} }, imgs: {},
    err: '', busy: false, toast: '', email: '', sentPending: false,
    rq: { name: '', company: '', email: '', phone: '', city: '', state: '', country: 'United States', type: '', customerNumber: '', notes: '' },
    q: '', qInput: '', limit: 24, picks: {}, cart: read(CK, []), quoteN: read(QK, []).length, paste: '', pasteMsg: '',
    vMake: '', vEng: '', f: { cat: [], brand: [], eng: [], photo: false, stock: false }, allBrands: false, showF: false, sugOn: false, sugI: -1,
    co: { po: '', method: 'Ground', name: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: '' },
    orders: [], cur: null, accounts: [], sync: null,

    get cats() { var self = this; return CATS.map(function (c) { return Object.assign({ n: self.cat.filter(function (r) { return r[3] === c.k; }).length }, c); }).filter(function (c) { return c.n; }); },
    get logged() { return !!(this.me && (this.me.admin || (this.me.account && this.me.account.status === 'approved'))); },
    get canOrder() { return !!(this.me && this.me.account && this.me.account.status === 'approved'); },
    get pendingCount() { return this.accounts.filter(function (a) { return a.status === 'pending'; }).length; },
    get curMake() { var k = this.vMake; return this.fit.tree.filter(function (m) { return m.key === k; })[0] || null; },
    get featured() {
      var self = this, picks = Object.keys(BENCH).concat(['BO.0.986.435.433', 'BO.0.986.435.410', 'BO.0.445.117.023', 'BO.0.445.020.146']);
      var out = picks.map(function (c) { return self.map[c]; }).filter(Boolean);
      this.cat.some(function (r) { if (out.length >= 8) return true; if ((r[3] === 'Injector' || r[3] === 'Pump') && self.imgs[r[0]] && out.indexOf(r) < 0) out.push(r); return false; });
      this.cat.some(function (r) { if (out.length >= 8) return true; if (r[3] === 'Injector' && out.indexOf(r) < 0) out.push(r); return false; });
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
    get base() {
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
    get results() { var self = this; return this.base.filter(function (x) { return self.pass(x); }); },
    facet: function (g) {
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
      this.cat.some(function (r) { if (out.length >= 4) return true; if (r[3] === 'Pump' && out.indexOf(r) < 0 && feat.indexOf(r) < 0) out.push(r); return false; });
      return out.slice(0, 4);
    },
    get shown() { return this.results.slice(0, this.limit); },
    get product() { return this.route === 'p' ? this.map[this.arg] || null : null; },
    get related() { var self = this, p = this.product; if (!p) return []; return (this.fit.rel[p[0]] || []).map(function (c) { return self.map[c]; }).filter(Boolean).slice(0, 8); },
    get fits() { var self = this, p = this.product, f = p && this.fit.items[p[0]]; if (!f) return []; return f[0].map(function (k) { return self.genOf(k); }).filter(Boolean); },
    get subtotal() { var self = this; return this.cart.reduce(function (a, l) { return a + self.lineTotal(l); }, 0); },

    init: function () {
      var self = this, h = location.search;
      if (/e=link/.test(h)) this.err = 'That sign-in link expired or was already used. Ask for a new one below.';
      if (/e=access/.test(h)) this.err = 'Your access is not approved yet.';
      if (h) history.replaceState(null, '', location.pathname + location.hash);
      fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (rows) { self.cat = rows; var m = {}; rows.forEach(function (r) { m[r[0]] = r; }); self.map = m; });
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).then(function (f) { self.fit = f; }).catch(function () {});
      fetch('/api/portal/images').then(function (r) { return r.json(); }).then(function (m) { self.imgs = m || {}; }).catch(function () {});
      api('me').then(function (me) {
        if (me._status === 200) {
          self.me = me;
          if (me.account) self.co.name = me.account.company;
          api('prices').then(function (b) { if (b._status === 200) self.book = b; });
          if (me.account) api('orders').then(function (o) { if (o.orders) self.orders = o.orders; });
          if (me.admin) self.loadAdmin();
        }
      });
      window.addEventListener('hashchange', function () { self.readHash(); });
      this.readHash();
    },
    readHash: function () {
      var h = decodeURIComponent((location.hash || '').replace(/^#\/?/, '')), i = h.indexOf('/');
      var r = i < 0 ? h : h.slice(0, i), a = i < 0 ? '' : h.slice(i + 1);
      this.route = r || 'home'; this.arg = a; this.err = ''; this.limit = 24; this.sugOn = false; this.showF = false;
      if (r === 's') this.qInput = a;
      if (r === 'c') this.f = { cat: [a], brand: [], eng: [], photo: false, stock: false };
      if (r === 's' || r === 'g') this.f = { cat: [], brand: [], eng: [], photo: false, stock: false };
      if (r === 'orders' && this.me && this.me.account) { var self = this; api('orders').then(function (o) { if (o.orders) self.orders = o.orders; }); }
      if (r === 'o') this.cur = this.orders.filter(function (o) { return o.id === a; })[0] || this.cur;
      if (r === 'checkout' && !this.cart.length) { location.hash = '#/cart'; return; }
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
    name: function (code) { var r = this.map[code]; return r ? parse(r[1]).title : code; },
    fmt: function (n) { return n == null ? 'Ask us' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    ago: function (t) { if (!t) return 'recently'; var m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; },
    date: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    label: function (s) { return { Received: 'Received', Parked: 'In review', Placed: 'Approved', Backordered: 'Backordered', Completed: 'Shipped', Deleted: 'Cancelled' }[s] || s; },
    stepOf: function (o) { return { Received: 0, Parked: 0, Placed: 1, Backordered: 1, Completed: 2 }[o.status] || 0; },
    bench: function (code) { return !!BENCH[code]; },
    pick: function (code) { return this.picks[code] || 1; },
    setPick: function (code, v) { this.picks[code] = Math.max(1, Math.min(9999, parseInt(v, 10) || 1)); },

    // quote list (anonymous) and cart (signed in)
    addQuote: function (code) {
      var r = this.map[code]; if (!r) return;
      var list = read(QK, []), l = list.filter(function (x) { return x.id === code; })[0];
      if (l) l.qty += 1; else list.push({ id: code, name: r[1], pn: code, app: r[3], cat: r[3], slug: r[2], img: '', pos: '', qty: 1 });
      write(QK, list); this.quoteN = list.length;
      this.flash('Added to your quote list'); track('quote_add_item', { item_id: code, quantity: 1, source: 'store' });
    },
    save: function () { write(CK, this.cart); },
    inCart: function (code) { return this.cart.some(function (l) { return l.code === code; }); },
    add: function (code, n) {
      if (!this.canOrder) return this.addQuote(code);
      n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.cart.filter(function (x) { return x.code === code; })[0];
      if (l) l.qty += n; else this.cart.push({ code: code, qty: n });
      this.picks[code] = 1; this.save(); this.flash('Added to cart');
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
      var self = this, ok = 0, miss = [];
      this.paste.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^(.*?)[\s,;\t]+(\d{1,4})\s*$/), code = m ? m[1] : line, n = m ? parseInt(m[2], 10) : 1, hit = self.find(code);
        if (hit) { var l = self.cart.filter(function (x) { return x.code === hit; })[0]; if (l) l.qty += n; else self.cart.push({ code: hit, qty: n }); ok++; } else miss.push(code);
      });
      this.save();
      this.pasteMsg = ok + ' added' + (miss.length ? '. Not found: ' + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '...' : '') : '');
      if (!miss.length) this.paste = '';
    },
    reorder: function (o) {
      var self = this;
      o.lines.forEach(function (x) { var l = self.cart.filter(function (c) { return c.code === x.code; })[0]; if (l) l.qty += x.qty; else self.cart.push({ code: x.code, qty: x.qty }); });
      this.save(); this.nav('cart'); this.flash(o.lines.length + ' parts added to your cart');
    },
    placeOrder: function () {
      var self = this; this.busy = true; this.err = '';
      var body = { po: this.co.po, notes: this.co.notes, lines: this.cart.map(function (l) { return { code: l.code, qty: l.qty }; }),
        ship: { name: this.co.name, street: this.co.street, city: this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, method: this.co.method } };
      api('order', { body: body }).then(function (r) {
        self.busy = false;
        if (r._status !== 200) { self.err = r.error || 'We could not place the order. Please try again.'; return; }
        track('generate_lead', { form: 'portal_order', quote_id: r.order.number, items: r.order.lines.length });
        self.orders.unshift(r.order); self.cur = r.order; self.co.po = ''; self.co.notes = '';
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
      this.busy = true; this.err = '';
      api('request', { body: Object.assign({}, this.rq, { hp: hp ? hp.value : '', t: Date.now() - T0 }) }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { track('b2b_access_request', { form: 'portal' }); self.nav('requested'); }
        else self.err = r._status === 429 ? 'Too many requests from this connection. Try later or call us.' : 'Please fill in name, company, e-mail and phone.';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    logout: function () { api('logout', { body: {} }).then(function () { location.href = '/portal'; }); },

    // admin
    lookup: function (a) { var self = this; if (!a._q.trim()) return; a._busy = true; api('admin-lookup?code=' + encodeURIComponent(a._q.trim())).then(function (r) { a._busy = false; a._res = r.customers || []; if (r.error) self.flash(r.error); }); },
    approve: function (a) { var self = this; api('admin-approve', { body: { account: a.id, customer: a._pick } }).then(function (r) { if (r._status === 200) { self.flash('Approved. Access e-mail sent.'); self.loadAdmin(); } else self.flash(r.error || 'Could not approve'); }); },
    reject: function (a) { var reason = prompt('Reason (optional, sent to the customer):'); if (reason === null) return; var self = this; api('admin-reject', { body: { account: a.id, reason: reason, notify: true } }).then(function () { self.flash('Declined'); self.loadAdmin(); }); },
    flash: function (m) { var self = this; this.toast = m; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  PetiteVue.createApp(app).mount('#app');
})();
