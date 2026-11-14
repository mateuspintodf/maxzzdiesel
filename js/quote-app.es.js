/* Quote builder for /quote. petite-vue app on #app.
   Lines are kept in localStorage 'mx-quote' (same format the quote button on other pages reads).
   Deep links for campaigns: /quote?add=CODE:QTY,CODE2&utm_source=...  (parts go straight into the list)
   Other params: q= (search), gen= (engine generation key, e.g. PS67-A), mode=vehicle|search|bench */
(function () {
  var QK = 'mx-quote', DK = 'mx-quote-d', SK = 'mx-src', T0 = Date.now();
  var TBD = 'Número de parte por confirmar';
  function read(k, dflt) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function tidy(desc) {
    return String(desc || '').replace(/\s+/g, ' ').replace(/\s*\/\s*(Application|application|Suitable for|Suitable)\s*:?\s*/g, ' · ').replace(/\s*\/\s*/g, ' / ').trim();
  }
  var POPULAR = [{ label: 'Cummins ISX15 XPI', q: 'isx' }, { label: 'Duramax L5P', q: 'l5p' }, { label: 'Ford 6.7 Power Stroke', q: '6.7 powerstroke' },
    { label: 'Cummins 6.7', q: '6.7 cummins' }, { label: 'Detroit DD15', q: 'dd15' }, { label: 'Cat C7 / C9', q: 'c7' }, { label: 'CP3 pump', q: 'cp3' },
    { label: 'CP4 pump', q: 'cp4' }, { label: 'Control valve', q: 'control valve' }, { label: 'Nozzle', q: 'nozzle' }, { label: 'Volvo D13', q: 'd13' }, { label: 'ISO 4113 fluid', q: '4113' }];
  var SHIP = [{ v: 'Ground', h: 'UPS or FedEx ground, the most economical' }, { v: 'Express', h: 'Next day or 2nd day air' }, { v: 'LTL freight', h: 'Pallets and heavy items' },
    { v: 'Pickup', h: 'Will call at our Coconut Creek, Florida warehouse' }, { v: 'My carrier', h: 'We ship on your UPS / FedEx / freight account' }, { v: 'Forwarder', h: 'We deliver to your freight forwarder for export' }];

  var app = PetiteVue.reactive({
    phase: 1, mode: 'vehicle', make: '', engIdx: -1, gen: '', bench: '', q: '', kind: '', limit: 30,
    lines: read(QK, []), d: Object.assign({ name: '', company: '', email: '', phone: '', type: '', country: '', state: '', city: '', zip: '', street: '', num: '', ship: 'Ground', needBy: '', po: '', notes: '', b2b: false }, read(DK, {})),
    reviewing: false, sheet: false, zipMsg: '', addr: [], addrOn: true, xsAt: 0, addrIdx: -1, sent: [], bad: [], pasteMsg: '', pasteMiss: [], number: '', sending: false, err: '', toast: '', copied: false, b2bDone: false, b2bSending: false,
    cat: [], map: {}, fit: { tree: [], items: {}, rel: {}, bench: [] }, ready: false,
    popular: POPULAR, shipOpts: SHIP,
    get tree() { return this.fit.tree; },
    get curMake() { var m = this.make; return this.fit.tree.filter(function (x) { return x.key === m; })[0] || null; },
    get curEngine() { var m = this.curMake; return m && this.engIdx >= 0 ? m.engines[this.engIdx] : null; },
    get curGen() { var g = this.gen, out = null; this.fit.tree.forEach(function (m) { m.engines.forEach(function (e) { e.gens.forEach(function (x) { if (x.key === g) out = x; }); }); }); return out; },
    get units() { return this.lines.reduce(function (s, l) { return s + (l.qty || 1); }, 0); },
    get benchGroups() {
      var self = this;
      return (this.fit.bench || []).map(function (b) { return { label: b.label, n: self.benchItems(b.label).length }; }).filter(function (b) { return b.n; });
    },
    get showList() { return (this.mode === 'vehicle' && !!this.gen) || (this.mode === 'search' && norm(this.q).length >= 2) || (this.mode === 'bench' && !!this.bench); },
    get baseList() {
      if (!this.ready) return [];
      var self = this;
      if (this.mode === 'vehicle') {
        var g = this.gen;
        return this.cat.filter(function (p) { var f = self.fit.items[p.code]; return f && f[0].indexOf(g) >= 0; }).sort(byKind);
      }
      if (this.mode === 'bench') return this.benchItems(this.bench);
      var toks = String(this.q).toLowerCase().split(/\s+/).map(norm).filter(Boolean);
      if (!toks.length || norm(this.q).length < 2) return [];
      var out = [], extra = [];
      for (var i = 0; i < this.cat.length; i++) {
        var p = this.cat[i];
        if (toks.every(function (t) { return p.hay.indexOf(t) >= 0; })) (self.fit.items[p.code] ? out : extra).push(p);
        if (out.length + extra.length > 400) break;
      }
      var nq = norm(this.q);
      var exact = function (p) { return p.ncode.indexOf(nq) >= 0 ? 0 : 1; };
      return out.concat(extra).sort(function (a, b) { return exact(a) - exact(b); });
    },
    get kindChips() {
      var c = {}; this.baseList.forEach(function (p) { c[p.kind] = (c[p.kind] || 0) + 1; });
      return Object.keys(c).sort(function (a, b) { return KORDER(a) - KORDER(b); }).map(function (k) { return { label: k, n: c[k] }; });
    },
    get filtered() { var k = this.kind; return k ? this.baseList.filter(function (p) { return p.kind === k; }) : this.baseList; },
    get shown() { return this.filtered.slice(0, this.limit); },
    get gensForQuery() {
      var t = norm(this.q); if (t.length < 2) return [];
      var out = [];
      this.fit.tree.forEach(function (m) { m.engines.forEach(function (e) { e.gens.forEach(function (g) {
        var hay = norm(m.label + ' ' + e.label + ' ' + g.label + ' ' + g.key + ' ' + g.years);
        var toks = String(app.q).toLowerCase().split(/\s+/).map(norm).filter(function (x) { return x.length >= 2; });
        if (toks.length && toks.every(function (x) { return hay.indexOf(x) >= 0; })) out.push(Object.assign({ make: m.key }, g));
      }); }); });
      return out.slice(0, 6);
    },
    get suggest() {
      var self = this, have = {}, out = [], seen = {};
      this.lines.forEach(function (l) { have[l.id] = 1; });
      this.lines.forEach(function (l) { (self.fit.rel[l.id] || []).forEach(function (c) {
        if (have[c] || seen[c] || !self.map[c] || out.length >= 8) return; seen[c] = 1;
        var p = self.map[c]; out.push({ code: c, name: p.name, why: p.kind });
      }); });
      return out;
    },
    get xsShown() { var a = this.suggest, n = a.length; if (n <= 2) return a; var at = this.xsAt % n; return [a[at], a[(at + 1) % n]]; },
    xsNext: function () { this.xsAt = (this.xsAt + 2) % Math.max(1, this.suggest.length); },
    benchItems: function (label) {
      var self = this;
      return this.cat.filter(function (p) { var f = self.fit.items[p.code]; return f && f[2] && f[1] === label; });
    },
    logosOf: function (k) { return { ford: ['ford.png'], ram: ['ram.png'], gm: ['chevrolet.svg', 'gmc.png'], nissan: ['nissan.svg'] }[k] || []; },
    monoOf: function (k) { return { ford: 'Ford', ram: 'Ram', gm: 'Chevy · GMC', nissan: 'Nissan', hd: 'Heavy duty' }[k] || k; },
    makeHint: function (m) { return m.engines.map(function (e) { return e.label; }).slice(0, 4).join(' · '); },
    genTitle: function (g, e) {
      if (g.key === 'DMAX') return 'Not sure of the generation?';
      var same = e && e.gens.filter(function (x) { return x.label === g.label; }).length > 1;
      return same && g.years ? g.years : g.label;
    },
    genSub: function (g, e) {
      if (g.key === 'DMAX') return 'All 6.6L Duramax parts we stock';
      var same = e && e.gens.filter(function (x) { return x.label === g.label; }).length > 1;
      return same ? g.label : (g.years || 'All years');
    },
    // Street autocomplete (Google Places via /api/address). Off silently when the server has no key.
    addrInput: function () {
      var self = this, d = this.d, q = String(d.street || '').trim();
      clearTimeout(this._at); this.addrIdx = -1;
      if (!this.addrOn || q.length < 4 || q === this._addrPicked) { this.addr = []; return; }
      if (!this._as) this._as = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      var codes = { 'United States': ['US'], 'Puerto Rico': ['PR'], 'Canada': ['CA'], 'Mexico': ['MX'], 'Brazil': ['BR'], 'Colombia': ['CO'], 'Chile': ['CL'], 'Peru': ['PE'],
        'Other Latin America': ['AR', 'BO', 'CR', 'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PY', 'SV', 'UY', 'VE'] };
      var regions = codes[d.country] || (d.country ? [] : ['US', 'PR']);
      var near = [d.city, d.state, d.zip].filter(Boolean).join(' ');
      var input = q.indexOf(',') < 0 && near ? q + ', ' + near : q;
      this._at = setTimeout(function () {
        fetch('/api/address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: input, session: self._as, regions: regions }) })
          .then(function (r) { if (r.status === 503 || r.status === 403) { self.addrOn = false; throw 0; } if (!r.ok) throw 0; return r.json(); })
          .then(function (x) { if (String(self.d.street || '').trim() === q) self.addr = x.items || []; })
          .catch(function () { self.addr = []; });
      }, 260);
    },
    addrKey: function (e) {
      if (!this.addr.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.addrIdx = (this.addrIdx + 1) % this.addr.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.addrIdx = (this.addrIdx - 1 + this.addr.length) % this.addr.length; }
      else if (e.key === 'Enter' && this.addrIdx >= 0) { e.preventDefault(); this.pickAddr(this.addr[this.addrIdx]); }
      else if (e.key === 'Escape') { this.addr = []; }
    },
    addrBlur: function () { var self = this; setTimeout(function () { self.addr = []; }, 180); },
    pickAddr: function (a) {
      var self = this, d = this.d, sess = this._as;
      this.addr = []; this._as = null;
      d.street = a.main; this._addrPicked = a.main;
      fetch('/api/address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, session: sess }) })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (x) {
          var names = { US: 'United States', PR: 'Puerto Rico', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', CO: 'Colombia', CL: 'Chile', PE: 'Peru' };
          if (x.street) { d.street = x.street; self._addrPicked = x.street; }
          if (x.city) d.city = x.city;
          if (x.state) d.state = x.state;
          if (x.zip) d.zip = x.zip;
          if (x.country) d.country = names[x.country] || (/^(AR|BO|CR|DO|EC|GT|HN|NI|PA|PY|SV|UY|VE)$/.test(x.country) ? 'Other Latin America' : 'Other');
          if (x.sub && !d.num) d.num = x.sub;
          self.zipMsg = [d.city, d.state].filter(Boolean).join(', ');
          self.save();
        }).catch(function () {})
        .then(function () { var n = document.getElementById('qx-num'); if (n) n.focus(); });
    },
    // ZIP / CEP lookup: fills city and state (and the street for Brazilian CEPs), then asks for the number
    lookupZip: function () {
      var self = this, d = this.d, z = String(d.zip || '').trim(), c = d.country || 'United States';
      clearTimeout(this._zt); this.zipMsg = '';
      var url = '', br = false;
      if (/United States|Puerto Rico/.test(c) && /^\d{5}/.test(z)) url = 'https://api.zippopotam.us/us/' + z.slice(0, 5);
      else if (c === 'Canada' && /^[A-Za-z]\d[A-Za-z]/.test(z)) url = 'https://api.zippopotam.us/ca/' + z.slice(0, 3).toUpperCase();
      else if (c === 'Mexico' && /^\d{5}$/.test(z)) url = 'https://api.zippopotam.us/mx/' + z;
      else if (c === 'Brazil' && /^\d{5}-?\d{3}$/.test(z)) { url = 'https://viacep.com.br/ws/' + z.replace('-', '') + '/json/'; br = true; }
      if (!url) return;
      this._zt = setTimeout(function () {
        fetch(url).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (x) {
          var city = '', state = '', street = '';
          if (br) { if (x.erro) throw 0; city = x.localidade; state = x.uf; street = [x.logradouro, x.bairro].filter(Boolean).join(', '); }
          else { var pl = (x.places || [])[0] || {}; city = pl['place name'] || ''; state = pl['state abbreviation'] || pl.state || ''; }
          if (!d.country && city) d.country = 'United States';
          if (city && (!d.city || self._autoCity === d.city)) { d.city = city; self._autoCity = city; }
          if (state && (!d.state || self._autoState === d.state)) { d.state = state; self._autoState = state; }
          if (street && (!d.street || self._autoStreet === d.street)) { d.street = street; self._autoStreet = street; }
          self.zipMsg = [city, state].filter(Boolean).join(', ') + (street ? ' · add the number' : ' · add the street and number');
          var next = document.getElementById(street ? 'qx-num' : 'qx-street'); if (next && !next.value) next.focus();
        }).catch(function () { self.zipMsg = ''; });
      }, 350);
    },
    fadeLines: function (el) { var w = el.parentElement; if (w) w.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 8); },
    get zipRequired() { return /United States|Canada|Puerto Rico/.test(this.d.country || 'United States'); },
    backToMake: function () { this.gen = ''; this.engIdx = -1; this.kind = ''; },
    backToEngine: function () { var m = this.curMake; this.gen = ''; this.kind = ''; if (m && m.engines.length === 1) this.engIdx = 0; },
    addQueryAsCustom: function () { var q = String(this.q).trim(); if (!q) return; var hit = this.findCode(q); if (hit) this.add(hit); else { this.addRaw(q, q, 1); this.flash('Added as a custom line'); } this.setQ(''); },
    countGen: function (key) { var n = 0, it = this.fit.items; for (var c in it) if (it[c][0].indexOf(key) >= 0 && this.map[c]) n++; return n; },
    countEngine: function (e) { var self = this; return e.gens.reduce(function (s, g) { return s + self.countGen(g.key); }, 0); },
    setMode: function (m) { this.mode = m; this.kind = ''; this.limit = 30; if (m === 'search') setTimeout(function () { var el = document.getElementById('qx-q'); if (el) el.focus(); }, 30); },
    pickMake: function (k) { this.make = k; this.engIdx = -1; this.gen = ''; this.kind = ''; var m = this.curMake; if (m && m.engines.length === 1) this.pickEngine(0); else goTo('#qx-s2'); },
    pickEngine: function (i) { this.engIdx = i; this.gen = ''; this.kind = ''; var e = this.curEngine; if (e && e.gens.length === 1) this.pickGen(e.gens[0].key); else goTo('#qx-s3'); },
    pickGen: function (k) { this.gen = k; this.kind = ''; this.limit = 30; goTo('.qx-path'); },
    clearVehicle: function () { this.gen = ''; this.kind = ''; },
    jumpGen: function (g) {
      var self = this; this.mode = 'vehicle'; this.make = g.make;
      var m = this.curMake; m.engines.forEach(function (e, i) { if (e.gens.some(function (x) { return x.key === g.key; })) self.engIdx = i; });
      this.pickGen(g.key);
    },
    pickBench: function (l) { this.bench = l; this.kind = ''; this.limit = 30; },
    setQ: function (v) { this.q = v; this.kind = ''; this.limit = 30; clearTimeout(this._st); var sv = String(v || '').trim(); if (sv.length >= 3) this._st = setTimeout(function () { track('search', { search_term: sv.slice(0, 80), source: 'quote' }); }, 1500); var el = document.getElementById('qx-q'); if (el && el.value !== v) el.value = v; },
    qtyOf: function (code) { for (var i = 0; i < this.lines.length; i++) if (this.lines[i].id === code) return this.lines[i].qty; return 0; },
    save: function () { setTimeout(function () { var el = document.querySelector('.qx-lines'); if (el) app.fadeLines(el); }, 30); write(QK, this.lines.map(function (l) { return Object.assign({}, l); })); },
    add: function (code, qty, quiet) {
      var p = this.map[code]; if (!p) return false; qty = Math.max(1, parseInt(qty, 10) || 1);
      var i = this.lines.findIndex(function (l) { return l.id === code; });
      if (i >= 0) this.lines[i].qty += qty;
      else this.lines.push({ id: code, name: p.name, pn: code, app: p.kind, cat: p.kind, slug: p.slug, img: '', pos: '', qty: qty });
      this.save(); if (!quiet) this.flash('Added ' + code + ' to your list');
      track('quote_add_item', { item_id: code, item_category: p.kind, quantity: qty });
      return true;
    },
    addRaw: function (pn, name, qty) {
      this.lines.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), name: name || 'Custom part', pn: pn || TBD, app: 'Custom line', cat: 'Other', slug: 'other', img: '', pos: '', qty: Math.max(1, parseInt(qty, 10) || 1), needPn: !pn, custom: true });
      this.save();
    },
    addCustom: function () {
      var pn = val('qx-cpn'), ds = val('qx-cds'), qt = val('qx-cqt');
      if (!pn && !ds) { this.flash('Type a part number or a description'); return; }
      var hit = pn && this.findCode(pn);
      if (hit) this.add(hit, qt); else { this.addRaw(pn, ds || pn, qt); this.flash('Custom line added'); }
      setVal('qx-cpn', ''); setVal('qx-cds', ''); setVal('qx-cqt', '1');
    },
    findCode: function (s) {
      var n = norm(s); if (n.length < 4) return '';
      if (this.map[s]) return s;
      var best = '';
      for (var i = 0; i < this.cat.length; i++) {
        var c = this.cat[i].ncode; if (c === n) return this.cat[i].code;
        if ((!best || best.indexOf('BO.') !== 0) && c.length > n.length && c.slice(-n.length) === n && /^[a-z]{1,4}$/.test(c.slice(0, c.length - n.length))) { if (!best || c.indexOf('bo') === 0) best = this.cat[i].code; }
      }
      if (!best && n.length >= 8) { for (var k = 0; k < this.cat.length; k++) { if (this.cat[k].hay.indexOf(n) >= 0) { best = this.cat[k].code; break; } } }
      if (!best && /^d[ls]la/.test(n)) return this.findCode('b' + n.slice(1));
      return best;
      return '';
    },
    addPaste: function () {
      var self = this, txt = val('qx-paste'), found = 0, custom = 0, miss = [];
      txt.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^(.+?)[\s,;\t]+(\d{1,5})$/), pn = m ? m[1].trim() : line, qty = m ? m[2] : 1;
        var hit = self.findCode(pn);
        if (hit) { self.add(hit, qty, true); found++; } else { self.addRaw(pn, pn, qty); custom++; miss.push(pn); }
      });
      setVal('qx-paste', '');
      this.pasteMsg = found + (found === 1 ? ' part matched' : ' parts matched') + (custom ? ', ' + custom + ' added as custom lines' : '') + '.';
      this.pasteMiss = miss;
      this.flash(this.pasteMsg);
    },
    inc: function (i) { this.lines[i].qty++; this.save(); },
    dec: function (i) { if (this.lines[i].qty > 1) { this.lines[i].qty--; this.save(); } },
    setQty: function (i, v) { this.lines[i].qty = Math.max(1, Math.min(99999, parseInt(v, 10) || 1)); this.save(); },
    setPn: function (i, v) { v = String(v || '').trim(); this.lines[i].pnUser = v; this.lines[i].pn = v || TBD; this.save(); },
    remove: function (i) { this.lines.splice(i, 1); this.save(); },
    clearAll: function () { if (window.confirm && !window.confirm('Clear every part from your list?')) return; this.lines.splice(0); this.save(); },
    copyLink: function () {
      var self = this;
      var codes = this.lines.filter(function (l) { return self.map[l.id]; }).map(function (l) { return l.id + (l.qty > 1 ? ':' + l.qty : ''); });
      if (!codes.length) { this.flash('Custom lines cannot go in a link'); return; }
      var url = location.origin + '/quote?add=' + encodeURIComponent(codes.join(','));
      var done = function () { self.copied = true; self.flash('Link copied. Anyone who opens it gets the same list.'); setTimeout(function () { self.copied = false; }, 2500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
      else window.prompt('Copy this link', url);
    },
    toDetails: function () { if (!this.lines.length) return; this.sheet = false; track('quote_start_details', { items: this.lines.length }); this.phase = 2; this.reviewing = false; this.err = ''; this.toast = ''; scrollTop(); },
    validate: function () {
      var d = this.d, bad = [];
      if (!d.name.trim()) bad.push('name'); if (!d.company.trim()) bad.push('company');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) bad.push('email');
      if (d.phone.replace(/\D/g, '').length < 7) bad.push('phone');
      if (!d.country) bad.push('country'); if (this.zipRequired && !d.zip.trim()) bad.push('zip');
      this.bad = bad;
      var first = null;
      document.querySelectorAll('[data-k]').forEach(function (el) { var b = bad.indexOf(el.getAttribute('data-k')) >= 0; el.classList.toggle('qx-err', b); el.setAttribute('aria-invalid', b ? 'true' : 'false'); if (b && !first) first = el; });
      if (first) setTimeout(function () { first.focus(); }, 50);
      return bad;
    },
    toReview: function () {
      write(DK, Object.assign({}, this.d));
      var bad = this.validate();
      if (bad.length) { this.err = 'Please fill in the fields marked in orange.'; return; }
      this.err = '';
      if (!this.number) { var t = new Date(); this.number = 'QR-' + String(t.getFullYear()).slice(2) + ('0' + (t.getMonth() + 1)).slice(-2) + ('0' + t.getDate()).slice(-2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
      this.reviewing = true; scrollTop();
    },
    submit: function () {
      if (this.sending) return; var self = this, d = this.d;
      this.sending = true; this.err = '';
      var body = { number: this.number, customer: { name: d.name, company: d.company, email: d.email, phone: d.phone, type: d.type, notes: d.notes },
        shipping: { country: d.country, street: [d.street, d.num].filter(Boolean).join(' '), state: d.state, city: d.city, zip: d.zip, method: d.ship, needBy: d.needBy, po: d.po },
        b2b: !!d.b2b, source: read(SK, ''), hp: val('qx-hp'), t: Date.now() - T0, lines: this.lines.map(function (l) { return { pn: l.pn, name: l.name, qty: l.qty }; }) };
      fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function () { track('generate_lead', { form: 'quote', quote_id: self.number, items: self.lines.length, units: self.units, country: d.country, b2b_interest: !!d.b2b }); self.sending = false; self.phase = 3; self.b2bDone = !!d.b2b; self.sent = self.lines.slice(); write(QK, []); scrollTop(); })
        .catch(function () { self.sending = false; self.err = 'We could not send it right now. Please try again, or email the list to sales@maxzzdiesel.com.'; });
    },
    askB2B: function () {
      if (this.b2bSending) return; var self = this, d = this.d; this.b2bSending = true;
      fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hp: val('qx-hp'), t: Date.now() - T0, name: d.name, email: d.email, phone: d.phone, type: 'B2B platform early access · ' + (d.type || '') + ' · ' + d.company }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); track('b2b_access_request', { form: 'b2b' }); self.b2bDone = true; self.b2bSending = false; })
        .catch(function () { self.b2bSending = false; self.flash('Could not send. Email sales@maxzzdiesel.com and we will add you.'); });
    },
    startOver: function () { this.lines.splice(0); this.save(); this.phase = 1; this.reviewing = false; this.number = ''; this.b2bDone = false; scrollTop(); },
    printIt: function () { window.print(); },
    maskPhone: function (v, country) {
      var d = String(v || '').replace(/\D/g, '');
      if (/United States|Puerto Rico|Canada/.test(country || 'United States')) { if (d.length === 11 && d[0] === '1') d = d.slice(1); d = d.slice(0, 10); if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
      return v && String(v).trim().charAt(0) === '+' ? '+' + d.slice(0, 15) : (d ? '+' + d.slice(0, 15) : '');
    },
    flash: function (msg) { var self = this; this.toast = msg; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  var KO = ['Injectors', 'Pumps', 'Rails and lines', 'Kits', 'Sensors and regulators', 'Install hardware', 'Nozzles', 'Control valves', 'Solenoids', 'Repair kits', 'Pump repair kits', 'Pump components', 'Injector components', 'Shims', 'Seals and O-rings', 'Tool sets and tools', 'Testers', 'Fluids', 'Engine parts', 'Aftertreatment'];
  function KORDER(k) { var i = KO.indexOf(k); return i < 0 ? 99 : i; }
  function byKind(a, b) { return KORDER(a.kind) - KORDER(b.kind) || (a.code < b.code ? -1 : 1); }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v; }
  // after a pick, bring the next step to the top of the screen (below the fixed header), unless it is already well in view
  // Analytics events go to the dataLayer; GTM decides where they are sent. No personal data in events.
function track(ev, params) { try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: ev }, params || {})); } catch (e) {} }
function goTo(sel) {
    setTimeout(function () {
      var el = document.querySelector(sel); if (!el) return;
      var top = el.getBoundingClientRect().top, head = window.innerWidth <= 640 ? 100 : 140;
      if (top < head || top > window.innerHeight * 0.45) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: window.scrollY + top - head - 10, behavior: reduce ? 'auto' : 'smooth' });
      }
    }, 60);
  }
  function scrollTop() { try { document.querySelector('.qx-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }

  var CATLABEL = { injectors: 'Injectors', pumps: 'Pumps', rail: 'Rails and lines', nozzle: 'Nozzles', tool: 'Tool sets and tools', fluids: 'Fluids', kits: 'Kits', engine: 'Engine parts', seal: 'Repair parts' };
  var P = new URLSearchParams(location.search);
  // campaign / source tracking (kept for the session, sent with the request)
  var src = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map(function (k) { return P.get(k) ? k.replace('utm_', '') + '=' + P.get(k) : ''; }).filter(Boolean).join(' ');
  if (src) write(SK, src);

  Promise.all([
    fetch('/api/catalog').then(function (r) { return r.json(); }),
    fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).catch(function () { return { tree: [], items: {}, rel: {}, bench: [] }; })
  ]).then(function (res) {
    var rows = res[0] || [], fit = res[1];
    var map = {}, cat = rows.map(function (r) {
      var f = fit.items[r[0]];
      var p = { code: r[0], name: tidy(r[1]), slug: r[2], kind: f ? f[1] : (CATLABEL[r[2]] || r[3]), brand: r[4] || '', ncode: norm(r[0]) };
      p.hay = norm(r[0] + ' ' + r[1] + ' ' + (r[4] || '') + ' ' + p.kind);
      map[r[0]] = p; return p;
    });
    app.fit = fit; app.cat = cat; app.map = map; app.ready = true;
    // refresh names of lines added elsewhere
    app.lines.forEach(function (l) { if (map[l.id] && (!l.name || l.name === l.id)) l.name = map[l.id].name; if (!l.pn || l.pn === TBD) { l.pn = TBD; l.needPn = true; } });
    // deep links
    var add = P.get('add'), n = 0, miss = 0;
    if (add) {
      add.split(',').forEach(function (it) {
        var m = it.trim().match(/^(.+?)(?::(\d{1,5}))?$/); if (!m) return;
        var code = map[m[1]] ? m[1] : app.findCode(m[1]);
        if (code && app.add(code, m[2] || 1, true)) n++; else miss++;
      });
      if (n) app.flash(n + (n === 1 ? ' part' : ' parts') + ' added from your link' + (miss ? ' (' + miss + ' not found)' : ''));
    }
    var g = P.get('gen'), q = P.get('q'), mode = P.get('mode'), mk = P.get('make');
    if (g) { var hit = null; fit.tree.forEach(function (mk) { mk.engines.forEach(function (e) { e.gens.forEach(function (x) { if (x.key.toLowerCase() === g.toLowerCase()) hit = Object.assign({ make: mk.key }, x); }); }); }); if (hit) app.jumpGen(hit); }
    else if (mk && fit.tree.some(function (x) { return x.key === mk; })) { app.mode = 'vehicle'; app.pickMake(mk); }
    else if (q) { app.mode = 'search'; app.setQ(q); }
    else if (mode === 'search' || mode === 'bench') app.mode = mode;
    if (add || g || q || src || mk) try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }).catch(function () { app.flash('Parts catalog is loading slowly. Search will work in a moment.'); });

  // keep in sync if the list changes in another tab
  window.addEventListener('storage', function (e) { if (e.key === QK) app.lines = read(QK, []); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.activeElement && document.activeElement.id === 'qx-q') app.setQ(''); });

  PetiteVue.createApp(app).mount('#app');
})();
