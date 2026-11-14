/* Maxzz B2B portal (petite-vue). Talks only to /api/portal/* and /api/catalog. */
(function () {
  var CK = 'mx-portal-cart';
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api/portal/' + path, { method: opts.body ? 'POST' : 'GET', credentials: 'same-origin', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function track(ev, p) { try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: ev }, p || {})); } catch (e) {} }
  var T0 = Date.now();

  var app = PetiteVue.reactive({
    view: 'loading', me: null, book: null, cat: [], map: {}, err: '', busy: false, toast: '',
    email: '', sentPending: false,
    rq: { name: '', company: '', email: '', phone: '', city: '', state: '', country: 'United States', type: '', customerNumber: '', notes: '' },
    q: '', kind: '', limit: 30, picks: {}, cart: read(CK, []), paste: '', pasteMsg: '',
    co: { po: '', method: 'Ground', name: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: '' },
    orders: [], cur: null, accounts: [], sync: null,

    get kinds() { return ['Injector', 'Pump', 'Nozzle', 'Rail', 'Repair part', 'Tool', 'Engine parts']; },
    get pendingCount() { return this.accounts.filter(function (a) { return a.status === 'pending'; }).length; },
    get lastOrder() { return this.orders[0] || null; },
    get filtered() {
      var q = this.q.trim(), kind = this.kind, self = this;
      if (q.length < 2 && !kind) return [];
      var list = this.cat;
      if (kind) list = list.filter(function (r) { return r[3] === kind; });
      if (q.length >= 2) {
        var nq = norm(q), words = q.toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter(function (r) {
          if (nq.length >= 4 && norm(r[0]).indexOf(nq) >= 0) return true;
          var hay = (r[1] + ' ' + r[0] + ' ' + (r[6] || '') + ' ' + (r[4] || '')).toLowerCase();
          return words.every(function (w) { return hay.indexOf(w) >= 0; });
        });
        list = list.slice().sort(function (a, b) { return (norm(b[0]).indexOf(nq) === 0) - (norm(a[0]).indexOf(nq) === 0) || self.inStock(b[0]) - self.inStock(a[0]); });
      }
      return list;
    },
    get shown() { return this.filtered.slice(0, this.limit); },
    get subtotal() { var self = this; return this.cart.reduce(function (a, l) { return a + self.lineTotal(l); }, 0); },

    init: function () {
      var self = this, h = location.search;
      if (/e=link/.test(h)) this.err = 'That sign-in link expired or was already used. Ask for a new one below.';
      if (/e=access/.test(h)) this.err = 'Your access is not approved yet.';
      if (h) history.replaceState(null, '', location.pathname + location.hash);
      api('me').then(function (me) {
        if (me._status !== 200) { self.view = location.hash === '#request' ? 'request' : 'login'; return; }
        self.me = me;
        if (me.account && me.account.status !== 'approved' && !me.admin) { self.view = 'pending'; return; }
        if (me.account && me.account.ship) Object.assign(self.co, me.account.ship);
        if (me.account) self.co.name = self.co.name || me.account.company;
        self.loadData();
        var want = (location.hash || '').slice(1);
        self.go(want === 'admin' && me.admin ? 'admin' : want === 'orders' && me.account ? 'orders' : me.account ? 'shop' : 'admin');
      });
    },
    loadData: function () {
      var self = this;
      fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (rows) {
        self.cat = rows; var m = {}; rows.forEach(function (r) { m[r[0]] = r; }); self.map = m;
      });
      api('prices').then(function (b) { if (b._status === 200) self.book = b; else if (b._status === 503) self.flash('Prices are syncing. Try again in a few minutes.'); });
      if (this.me.account) api('orders').then(function (o) { if (o.orders) self.orders = o.orders; });
      if (this.me.admin) this.loadAdmin();
    },
    loadAdmin: function () { var self = this; api('admin-list').then(function (r) { if (r.sync) self.sync = r.sync; if (r.accounts) self.accounts = r.accounts.map(function (a) { return Object.assign(a, { _q: a.customerNumber || '', _res: null, _pick: null, _busy: false }); }); }); },
    go: function (v) {
      this.err = ''; this.view = v;
      if (v === 'orders' && this.me && this.me.account) { var self = this; api('orders').then(function (o) { if (o.orders) self.orders = o.orders; }); }
      if (v === 'checkout' && !this.cart.length) this.view = 'shop';
      history.replaceState(null, '', '#' + v);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // sign in and access
    sendLink: function () {
      var self = this; this.busy = true; this.err = '';
      api('login', { body: { email: this.email } }).then(function (r) {
        self.busy = false;
        if (r._status === 429) { self.err = 'Too many attempts. Wait a few minutes and try again.'; return; }
        if (r._status !== 200) { self.err = 'Check the e-mail address.'; return; }
        if (r.direct) { location.href = '/portal'; return; }
        self.sentPending = !!r.pending; self.view = 'sent';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    sendRequest: function () {
      var self = this, hp = document.getElementById('px-hp');
      this.busy = true; this.err = '';
      api('request', { body: Object.assign({}, this.rq, { hp: hp ? hp.value : '', t: Date.now() - T0 }) }).then(function (r) {
        self.busy = false;
        if (r._status === 200) { track('b2b_access_request', { form: 'portal' }); self.view = 'requested'; }
        else self.err = r._status === 429 ? 'Too many requests from this connection. Try later or call us.' : 'Please fill in name, company, e-mail and phone.';
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Try again.'; });
    },
    logout: function () { api('logout', { body: {} }).then(function () { location.href = '/portal'; }); },

    // catalog helpers
    price: function (code) { var p = this.book && this.book.items[code]; return p ? p[0] : null; },
    qty: function (code) { var p = this.book && this.book.items[code]; return p ? p[1] : null; },
    img: function (code) { var p = this.book && this.book.items[code]; return p && p[2] && /^https:/.test(p[2]) ? p[2] : ''; },
    inStock: function (code) { var n = this.qty(code); return n > 0 ? 1 : 0; },
    stockClass: function (code) { var n = this.qty(code); return n == null ? 'out' : n <= 0 ? 'out' : n < 5 ? 'low' : ''; },
    stockText: function (code) { var n = this.qty(code); if (n == null) return 'Ask us'; if (n <= 0) return 'Backorder'; return n < 5 ? 'Only ' + n + ' left' : 'In stock'; },
    name: function (code) { var r = this.map[code]; return r ? r[1] : code; },
    fmt: function (n) { return n == null ? 'Ask us' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    ago: function (t) { if (!t) return 'recently'; var m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; },
    date: function (t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
    label: function (s) { return { Received: 'Received', Parked: 'In review', Placed: 'Approved', Backordered: 'Backordered', Completed: 'Shipped', Deleted: 'Cancelled' }[s] || s; },
    stepOf: function (o) { return { Received: 0, Parked: 0, Placed: 1, Backordered: 1, Completed: 2 }[o.status] ?? 0; },
    pick: function (code) { return this.picks[code] || 1; },
    setPick: function (code, v) { this.picks[code] = Math.max(1, Math.min(9999, parseInt(v, 10) || 1)); },

    // cart
    save: function () { write(CK, this.cart); },
    inCart: function (code) { return this.cart.some(function (l) { return l.code === code; }); },
    add: function (code, n) {
      n = Math.max(1, parseInt(n, 10) || 1);
      var l = this.cart.find(function (x) { return x.code === code; });
      if (l) l.qty += n; else this.cart.push({ code: code, qty: n });
      this.picks[code] = 1; this.save(); this.flash('Added ' + code);
      track('quote_add_item', { item_id: code, quantity: n, source: 'portal' });
    },
    setQty: function (i, v) { var n = parseInt(v, 10) || 0; if (n <= 0) return this.remove(i); this.cart[i].qty = Math.min(9999, n); this.save(); },
    remove: function (i) { this.cart.splice(i, 1); this.save(); },
    clearCart: function () { this.cart.splice(0); this.save(); },
    lineTotal: function (l) { var p = this.price(l.code); return p == null ? 0 : p * l.qty; },
    find: function (raw) {
      var n = norm(raw); if (n.length < 4) return null;
      var hit = this.cat.find(function (r) { return norm(r[0]) === n; });
      if (!hit) hit = this.cat.find(function (r) { var c = norm(r[0]); return c.length > n.length && c.slice(-n.length) === n && /^[A-Z]{1,4}$/.test(c.slice(0, c.length - n.length)); });
      return hit ? hit[0] : null;
    },
    addPaste: function () {
      var self = this, ok = 0, miss = [];
      this.paste.split(/\n+/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var m = line.match(/^(.*?)[\s,;\t]+(\d{1,4})\s*$/), code = m ? m[1] : line, n = m ? parseInt(m[2], 10) : 1;
        var hit = self.find(code);
        if (hit) { var l = self.cart.find(function (x) { return x.code === hit; }); if (l) l.qty += n; else self.cart.push({ code: hit, qty: n }); ok++; }
        else miss.push(code);
      });
      this.save();
      this.pasteMsg = ok + ' added' + (miss.length ? '. Not found: ' + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '...' : '') : '');
      if (!miss.length) this.paste = '';
    },
    reorder: function (o) {
      var self = this;
      o.lines.forEach(function (x) { var l = self.cart.find(function (c) { return c.code === x.code; }); if (l) l.qty += x.qty; else self.cart.push({ code: x.code, qty: x.qty }); });
      this.save(); this.go('shop'); this.flash(o.lines.length + ' parts added to your cart');
    },
    placeOrder: function () {
      var self = this; this.busy = true; this.err = '';
      var body = { po: this.co.po, notes: this.co.notes, lines: this.cart.map(function (l) { return { code: l.code, qty: l.qty }; }),
        ship: { name: this.co.name, street: this.co.street, city: this.co.city, state: this.co.state, zip: this.co.zip, country: this.co.country, method: this.co.method } };
      api('order', { body: body }).then(function (r) {
        self.busy = false;
        if (r._status !== 200) { self.err = r.error || 'We could not place the order. Please try again.'; return; }
        track('generate_lead', { form: 'portal_order', quote_id: r.order.number, items: r.order.lines.length });
        self.orders.unshift(r.order);
        self.cur = r.order; self.co.po = ''; self.co.notes = '';
        self.go('order'); self.flash('Order received. We will e-mail you when it is approved.');
        // empty the cart after the checkout view is gone, so its list is not patched while being removed
        setTimeout(function () { self.cart.splice(0); self.save(); }, 0);
      }).catch(function () { self.busy = false; self.err = 'Connection problem. Your cart is saved; try again.'; });
    },
    openOrder: function (o) { this.cur = o; this.go('order'); },

    // admin
    lookup: function (a) {
      var self = this; if (!a._q.trim()) return; a._busy = true;
      api('admin-lookup?code=' + encodeURIComponent(a._q.trim())).then(function (r) { a._busy = false; a._res = r.customers || []; if (r.error) self.flash(r.error); });
    },
    approve: function (a) {
      var self = this;
      api('admin-approve', { body: { account: a.id, customer: a._pick } }).then(function (r) {
        if (r._status === 200) { self.flash('Approved. Access e-mail sent.'); self.loadAdmin(); } else self.flash(r.error || 'Could not approve');
      });
    },
    reject: function (a) {
      var reason = prompt('Reason (optional, sent to the customer):'); if (reason === null) return;
      var self = this;
      api('admin-reject', { body: { account: a.id, reason: reason, notify: true } }).then(function () { self.flash('Declined'); self.loadAdmin(); });
    },
    flash: function (m) { var self = this; this.toast = m; clearTimeout(this._t); this._t = setTimeout(function () { self.toast = ''; }, 2600); }
  });

  PetiteVue.createApp(app).mount('#app');
})();
