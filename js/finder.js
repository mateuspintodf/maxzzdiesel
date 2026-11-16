/* Quick part finder: search by engine, system or OEM / Bosch / Denso part number.
   Loads /api/catalog and /data/fitment.json on first focus, no prices or stock. */
(function () {
  var q = document.getElementById('pf-q');
  var out = document.getElementById('pf-out');
  if (!q || !out) return;
  var QK = 'mx-quote';
  var cat = null, fit = null, loading = null, hay = null;

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function oem(code, name) {
    var t = String(name || '').split(/\s+/);
    for (var i = 0; i < t.length; i++) { var x = t[i].replace(/[:,]/g, ''); if (/\d/.test(x) && x.replace(/[^0-9a-z]/gi, '').length >= 4 && !/^(ISX|ISL|ISB|QSX|DD|CP|L5P|C)\d*[A-Z]?\d*$/i.test(x)) return x; }
    return code.indexOf('.') > -1 ? code.split('.').slice(1).join('.') : code;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('/api/catalog').then(function (r) { return r.json(); }),
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).catch(function () { return { tree: [], items: {} }; })
    ]).then(function (v) {
      cat = v[0]; fit = v[1];
      var gl = {};
      (fit.tree || []).forEach(function (mk) { (mk.engines || []).forEach(function (en) { (en.gens || []).forEach(function (g) { gl[g.key] = [mk.label, en.label, g.label, g.years, g.vehicles].join(' '); }); }); });
      hay = cat.map(function (r) {
        var f = (fit.items || {})[r[0]];
        var g = f ? (f[0] || []).map(function (k) { return gl[k] || k; }).join(' ') : '';
        return norm(r[0] + ' ' + oem(r[0], r[1]) + ' ' + r[1] + ' ' + r[3] + ' ' + (r[4] || '') + ' ' + g);
      });
    });
    return loading;
  }

  function readList() { try { var v = JSON.parse(localStorage.getItem(QK) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function add(item) {
    var ls = readList(), i = -1;
    for (var k = 0; k < ls.length; k++) { if (ls[k].id === item.id) { i = k; break; } }
    if (i >= 0) ls[i].qty = (ls[i].qty || 1) + 1; else ls.push(item);
    try { localStorage.setItem(QK, JSON.stringify(ls)); } catch (e) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: QK })); } catch (e) {}
  }

  var SYS = [
    ['Cummins ISX15 / X15 XPI', '/systems/cummins-isx15-xpi', 'isx15 x15 xpi cummins heavy duty 2872405'],
    ['Detroit DD15 (Bosch CRIN 4.2)', '/systems/detroit-dd15-bosch-crin-4-2', 'dd15 detroit crin 4.2 bosch'],
    ['Duramax L5P (Denso G4S)', '/systems/duramax-l5p-denso-g4s', 'l5p duramax denso g4s gm chevy gmc'],
    ['Ram 6.7L Cummins (Bosch CRIN)', '/systems/cummins-6-7-bosch-crin', 'cummins 6.7 ram isb crin cp3 bosch dodge'],
    ['Ford 6.7L Power Stroke (CP4)', '/systems/ford-6-7-powerstroke-cp4', 'ford powerstroke power stroke 6.7 cp4 bosch'],
    ['CAT C15 / C7 / C9', '/systems/caterpillar-c15-c7-c9', 'cat caterpillar c15 c7 c9 heui meui']
  ];
  function sysHits(toks) {
    return SYS.filter(function (x) {
      var h = norm(x[0] + ' ' + x[2]);
      return toks.every(function (t) { return h.indexOf(t) > -1; });
    });
  }

  function render(term) {
    var raw = term.trim();
    if (raw.length < 2) { out.innerHTML = ''; return; }
    var toks = raw.toLowerCase().split(/[\s,]+/).map(norm).filter(Boolean);
    var hits = [];
    for (var i = 0; i < cat.length && hits.length < 8; i++) {
      var ok = true;
      for (var t = 0; t < toks.length; t++) { if (hay[i].indexOf(toks[t]) < 0) { ok = false; break; } }
      if (ok) hits.push(cat[i]);
    }
    var h = '';
    var sh = sysHits(toks);
    if (sh.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:2px 0 12px;align-items:center;font-size:13px;color:#8a9099">Systems: ' +
        sh.map(function (x) { return '<a href="' + x[1] + '" style="border:1px solid #d3d7dc;border-radius:50px;padding:4px 14px;color:#1d2126">' + esc(x[0]) + '</a>'; }).join('') + '</div>';
    }
    hits.forEach(function (r) {
      h += '<div class="pf-r"><b>' + esc(oem(r[0], r[1])) + '</b><span>' + esc(r[1]) + '</span>' +
        '<button type="button" data-id="' + esc(r[0]) + '">Add to quote list</button></div>';
    });
    if (!hits.length) h += '<div style="padding:8px 4px;font-size:14px;color:#5a5a60">No match in the catalog for this search.</div>';
    var code = raw.replace(/\s+/g, ' ');
    if (/\d/.test(code) && code.length >= 4) {
      h += '<div style="padding-top:14px"><button type="button" class="pf-c" data-custom="' + esc(code) + '">Add custom Part Number ' + esc(code) + ' directly to your Quote List</button></div>';
    }
    out.innerHTML = h;
  }

  var tm;
  q.addEventListener('focus', function () { load(); });
  q.addEventListener('input', function () {
    clearTimeout(tm);
    tm = setTimeout(function () { load().then(function () { render(q.value); }); }, 120);
  });

  out.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var id = b.getAttribute('data-id'), cu = b.getAttribute('data-custom');
    if (id) {
      var r = null;
      for (var i = 0; i < cat.length; i++) { if (cat[i][0] === id) { r = cat[i]; break; } }
      if (!r) return;
      add({ id: r[0], name: r[1], pn: r[0], app: r[3] || '', cat: r[3] || '', slug: slug(r[0]), img: '', pos: '', qty: 1 });
    } else if (cu) {
      add({ id: 'custom-' + slug(cu), name: 'Part number: ' + cu, pn: cu, app: 'Part number to confirm', cat: 'Other', slug: 'other', img: '', pos: '', qty: 1 });
    } else return;
    var t = b.textContent; b.textContent = 'Added to your list';
    setTimeout(function () { b.textContent = t; }, 1600);
  });

  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-q]');
    if (!c) return;
    q.value = c.getAttribute('data-q');
    q.focus();
    load().then(function () { render(q.value); });
  });

  var m = /[?&]q=([^&]*)/.exec(location.search);
  if (m) { q.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); load().then(function () { render(q.value); }); }
})();
