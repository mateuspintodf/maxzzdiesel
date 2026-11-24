/* One search for the whole site: a button in the header opens it on every page (also "/" or Ctrl/Cmd+K).
   Parts follow the finder's rule (only what is in stock, the part itself first) and open the part's own page;
   engines, guides and product lines come from the list below. "Have a list?" sends pasted numbers to the quote list.
   Loads /api/catalog, /data/fitment.json and /api/instock on first open. No prices leave the server. */
(function () {
  if (window.__mxSearch) return; window.__mxSearch = 1;
  var LANG = (document.documentElement.lang || 'en').slice(0, 2);
  var D = {
    en: { btn: 'Search', ph: 'Part number, engine or system (e.g., 2872405, ISX15, CP4)', parts: 'Parts in stock', more: 'See all results in the store', pages: 'Engines, guides and products',
      none: 'No in-stock match. Add the number to your quote list and our team will check availability.', add: 'Add to quote list', added: 'Added', custom: 'Add part number {x} to my quote list',
      list: 'Have a list? Paste it', listPh: 'One part number per line. Add the quantity after it if you want (e.g., 0445120384 6)', send: 'Send to my quote list', close: 'Close', hint: 'Type at least 2 characters', loading: 'Loading the catalog...' },
    es: { btn: 'Buscar', ph: 'Número de parte, motor o sistema (ej.: 2872405, ISX15, CP4)', parts: 'Piezas en stock', more: 'Ver todos los resultados en la tienda', pages: 'Motores, guías y productos',
      none: 'Sin coincidencia en stock. Agregue el número a su lista de cotización y nuestro equipo confirmará la disponibilidad.', add: 'Agregar a la cotización', added: 'Agregado', custom: 'Agregar el número {x} a mi cotización',
      list: '¿Tiene una lista? Péguela', listPh: 'Un número por línea. Puede poner la cantidad después (ej.: 0445120384 6)', send: 'Enviar a mi cotización', close: 'Cerrar', hint: 'Escriba al menos 2 caracteres', loading: 'Cargando el catálogo...' },
    pt: { btn: 'Buscar', ph: 'Número da peça, motor ou sistema (ex.: 2872405, ISX15, CP4)', parts: 'Peças em estoque', more: 'Ver todos os resultados na loja', pages: 'Motores, guias e produtos',
      none: 'Nada em estoque com esse termo. Adicione o número à sua lista de cotação e nossa equipe confirma a disponibilidade.', add: 'Adicionar à cotação', added: 'Adicionado', custom: 'Adicionar o número {x} à minha cotação',
      list: 'Tem uma lista? Cole aqui', listPh: 'Um número por linha. Pode pôr a quantidade depois (ex.: 0445120384 6)', send: 'Enviar para minha cotação', close: 'Fechar', hint: 'Digite pelo menos 2 caracteres', loading: 'Carregando o catálogo...' }
  };
  if (!D[LANG]) LANG = 'en';
  var T = D[LANG];
  var P = LANG === 'en' ? '' : '/' + LANG;
  var PAGES = [
    ['Cummins ISX15 / X15 XPI', '/systems/cummins-isx15-xpi', 'Engine', 'isx15 x15 xpi cummins heavy duty 2872405 qsx'],
    ['Detroit DD15 (Bosch CRIN 4.2)', '/systems/detroit-dd15-bosch-crin-4-2', 'Engine', 'dd15 dd13 dd16 detroit crin 4.2 bosch'],
    ['Duramax L5P (Denso G4S)', '/systems/duramax-l5p-denso-g4s', 'Engine', 'l5p duramax denso g4s gm chevy gmc silverado sierra'],
    ['Ram 6.7L Cummins (Bosch CRIN)', '/systems/cummins-6-7-bosch-crin', 'Engine', 'cummins 6.7 ram isb crin cp3 bosch dodge'],
    ['Ford 6.7L Power Stroke (CP4)', '/systems/ford-6-7-powerstroke-cp4', 'Engine', 'ford powerstroke power stroke 6.7 cp4 bosch f250 f350'],
    ['CAT C15 / C7 / C9', '/systems/caterpillar-c15-c7-c9', 'Engine', 'cat caterpillar c15 c7 c9 heui meui'],
    ['Diesel fuel injection guide', P + '/guides/diesel-fuel-injection', 'Guide', 'guide basics common rail how it works injector pump nozzle failure symptoms'],
    ['Bosch CRIN 4.2 (Detroit DD15) rebuild guide', '/resources/detroit-dd15-bosch-crin-4-2-rebuild-solenoid-guide', 'Guide', 'dd15 crin 4.2 rebuild solenoid pins disassembly'],
    ['Cummins ISX15 XPI injector failure symptoms', '/resources/cummins-isx15-xpi-injector-failure-symptoms-repair-parts', 'Guide', 'isx15 xpi failure symptoms bench test'],
    ['Bosch piezo injector cleaning warning', '/resources/bosch-piezo-injector-ultrasonic-cleaning-warning-0445115', 'Guide', 'piezo 0445115 0445116 0445117 ultrasonic cleaning'],
    ['CP4 pump failure and contamination', '/resources/cp4-pump-failure-ford-6-7-powerstroke-ram-cummins-solution', 'Guide', 'cp4 pump failure contamination metal debris ford ram'],
    ['All technical guides', '/resources', 'Guide', 'guides resources articles technical'],
    ['Injection parts', P + '/injection-parts', 'Products', 'injection parts injectors nozzles pumps valves'],
    ['Aftertreatment', P + '/aftertreatment', 'Products', 'aftertreatment dpf scr def nox egr doc'],
    ['Fluids (ISO 4113 calibration fluid)', P + '/fluids', 'Products', 'fluids iso 4113 calibration fluid cleaner solvent'],
    ['Tool sets (Robiel)', P + '/tool-sets', 'Products', 'tool sets robiel tools bench tooling'],
    ['Contamination kits', P + '/contamination-kits', 'Products', 'contamination kit cp4 kit'],
    ['Diesel Tech Academy courses', '/training', 'Training', 'training course class academy dta learn'],
    ['Wholesale store and quote list', '/portal', 'Store', 'portal store wholesale login account quote order']
  ];
  var QK = 'mx-quote', cat = null, hay = null, stock = null, loading = null, root, inp, out, ta, last = '';

  function norm(s) { return String(s || '').toLowerCase().normalize ? String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '') : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug(s) { return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function shown(code) { return code.indexOf('.') > -1 ? code.split('.').slice(1).join('.') : code; }
  function oem(code, name) {
    var t = String(name || '').split(/\s+/);
    for (var i = 0; i < t.length; i++) { var x = t[i].replace(/[:,=()#]/g, ''); if (/\d/.test(x) && x.replace(/[^0-9a-z]/gi, '').length >= 4 && !/^(ISX|ISL|ISB|QSX|DD|CP|L5P|C)\d*[A-Z]?\d*$/i.test(x)) return x; }
    return shown(code);
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('/api/catalog').then(function (r) { return r.json(); }),
      fetch('/data/fitment.json?v=1').then(function (r) { return r.json(); }).catch(function () { return { tree: [], items: {} }; }),
      fetch('/api/instock').then(function (r) { return r.json(); }).catch(function () { return { codes: null }; })
    ]).then(function (v) {
      cat = v[0]; var fit = v[1] || {};
      if (v[2] && v[2].codes && v[2].codes.length) { stock = {}; v[2].codes.forEach(function (c) { stock[c] = 1; }); }
      var gl = {};
      (fit.tree || []).forEach(function (mk) { (mk.engines || []).forEach(function (en) { (en.gens || []).forEach(function (g) { gl[g.key] = [mk.label, en.label, g.label, g.years, g.vehicles].join(' '); }); }); });
      hay = cat.map(function (r) { var f = (fit.items || {})[r[0]], g = f ? (f[0] || []).map(function (k) { return gl[k] || k; }).join(' ') : ''; return norm(r[0] + ' ' + oem(r[0], r[1]) + ' ' + r[1] + ' ' + r[3] + ' ' + (r[4] || '') + ' ' + g); });
    }).catch(function () { loading = null; cat = []; hay = []; });
    return loading;
  }

  function readList() { try { var v = JSON.parse(localStorage.getItem(QK) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function add(item) {
    var ls = readList(), i = -1;
    for (var k = 0; k < ls.length; k++) { if (ls[k].id === item.id) { i = k; break; } }
    if (i >= 0) ls[i].qty = (ls[i].qty || 1) + (item.qty || 1); else ls.push(item);
    try { localStorage.setItem(QK, JSON.stringify(ls)); } catch (e) {}
    try { window.dispatchEvent(new StorageEvent('storage', { key: QK })); } catch (e) {}
    try { (window.dataLayer = window.dataLayer || []).push({ event: 'quote_add_item', item_id: item.pn, source: 'site_search' }); } catch (e) {}
  }

  var CSS = '.mxs-b{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:transparent;color:#fff;cursor:pointer;flex:none;transition:background .2s,border-color .2s}' +
    '.mxs-b:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.45)}.mxs-b svg{width:19px;height:19px}' +
    '.mxs{position:fixed;inset:0;z-index:9999;display:none;font-family:"BDO Grotesk","Helvetica Neue",Arial,sans-serif}.mxs.on{display:block}' +
    '.mxs-s{position:absolute;inset:0;background:rgba(14,15,17,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:mxsf .18s ease}' +
    '.mxs-p{position:relative;max-width:760px;margin:90px auto 0;background:#fff;border-radius:26px;box-shadow:0 30px 80px rgba(14,15,17,.35);overflow:hidden;animation:mxsu .22s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;max-height:calc(100vh - 130px)}' +
    '@keyframes mxsf{from{opacity:0}}@keyframes mxsu{from{opacity:0;transform:translateY(-10px) scale(.985)}}' +
    '.mxs-h{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 24px;border-bottom:1px solid #eceef1}.mxs-h svg{flex:none;color:#8a9099}' +
    '.mxs-i{flex:1;min-width:0;height:56px;border:0;outline:0;font:inherit;font-size:18px;color:#1d2126;background:transparent}.mxs-i::placeholder{color:#9aa1ab}.mxs-i::-webkit-search-cancel-button{display:none}' +
    '.mxs-x{border:0;background:#f1f2f4;color:#1d2126;border-radius:50px;height:36px;padding:0 14px;font:inherit;font-size:13px;cursor:pointer}' +
    '.mxs-o{overflow:auto;padding:8px 12px 12px}.mxs-k{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8a9099;padding:14px 12px 6px}' +
    '.mxs-r{display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:14px;text-decoration:none;color:#1d2126}.mxs-r:hover,.mxs-r.sel{background:#f5f6f8}' +
    '.mxs-r .t{flex:1;min-width:0}.mxs-r b{display:block;font-weight:600;font-size:15px}.mxs-r small{display:block;color:#5a5a60;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.mxs-tag{flex:none;font-size:11px;font-weight:600;color:#5a5a60;background:#f1f2f4;border-radius:50px;padding:3px 10px}' +
    '.mxs-a{flex:none;border:1px solid #d3d7dc;background:#fff;color:#1d2126;border-radius:50px;height:34px;padding:0 14px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}.mxs-a:hover{border-color:#d32a37;color:#d32a37}.mxs-a.ok{background:#1d2126;border-color:#1d2126;color:#fff}' +
    '.mxs-m{display:block;padding:12px;color:#d32a37;font-weight:600;font-size:14px;text-decoration:none}.mxs-n{padding:12px;font-size:14px;color:#5a5a60;line-height:1.5}' +
    '.mxs-c{display:inline-block;margin:4px 12px 8px;border:0;background:#d32a37;color:#fff;border-radius:50px;padding:10px 18px;font:inherit;font-size:14px;cursor:pointer}' +
    '.mxs-f{border-top:1px solid #eceef1;padding:12px 24px;background:#fafbfc}.mxs-l{border:0;background:none;padding:0;color:#1d2126;font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}' +
    '.mxs-ta{display:none;margin-top:10px}.mxs-ta.on{display:block}.mxs-ta textarea{width:100%;min-height:110px;border:1px solid #d3d7dc;border-radius:14px;padding:12px 14px;box-sizing:border-box;font:inherit;font-size:14px;resize:vertical}' +
    '.mxs-ta button{margin-top:8px;border:0;background:#d32a37;color:#fff;border-radius:50px;height:42px;padding:0 20px;font:inherit;font-size:14px;cursor:pointer}' +
    '@media (max-width:700px){.mxs-p{margin:0;border-radius:0;max-height:100vh;height:100vh}.mxs-r small{white-space:normal}.mxs-b{width:40px;height:40px}}';

  var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.className = 'mxs'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', T.btn);
    root.innerHTML = '<div class="mxs-s" data-x></div><div class="mxs-p"><div class="mxs-h">' + ICON + '<input class="mxs-i" type="search" autocomplete="off" spellcheck="false" placeholder="' + esc(T.ph) + '" aria-label="' + esc(T.btn) + '"><button type="button" class="mxs-x" data-x>' + esc(T.close) + '</button></div>' +
      '<div class="mxs-o" aria-live="polite"></div><div class="mxs-f"><button type="button" class="mxs-l" data-list>' + esc(T.list) + '</button><div class="mxs-ta"><textarea placeholder="' + esc(T.listPh) + '"></textarea><button type="button" data-send>' + esc(T.send) + '</button></div></div></div>';
    document.body.appendChild(root);
    inp = root.querySelector('.mxs-i'); out = root.querySelector('.mxs-o'); ta = root.querySelector('textarea');
    var tm;
    inp.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { load().then(function () { render(inp.value); }); }, 110); });
    inp.addEventListener('keydown', function (e) {
      var rs = [].slice.call(out.querySelectorAll('.mxs-r')), i = rs.indexOf(out.querySelector('.mxs-r.sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!rs.length) return; if (i >= 0) rs[i].classList.remove('sel'); i = e.key === 'ArrowDown' ? Math.min(rs.length - 1, i + 1) : Math.max(0, i - 1); rs[i].classList.add('sel'); rs[i].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { var el = out.querySelector('.mxs-r.sel') || rs[0]; if (el) { e.preventDefault(); location.href = el.getAttribute('href'); } else if (inp.value.trim().length >= 2) location.href = '/portal?q=' + encodeURIComponent(inp.value.trim()); }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) return close();
      var a = e.target.closest('.mxs-a'), c = e.target.closest('.mxs-c');
      if (a) { e.preventDefault(); e.stopPropagation(); var r = null; for (var i = 0; i < cat.length; i++) { if (cat[i][0] === a.getAttribute('data-id')) { r = cat[i]; break; } }
        if (r) { add({ id: r[0], name: r[1], pn: r[0], app: r[3] || '', cat: r[3] || '', slug: slug(r[0]), img: '', pos: '', qty: 1 }); a.classList.add('ok'); a.textContent = T.added; } return; }
      if (c) { var cu = c.getAttribute('data-custom'); add({ id: 'custom-' + slug(cu), name: 'Part number: ' + cu, pn: cu, app: 'Part number to confirm', cat: 'Other', slug: 'other', img: '', pos: '', qty: 1, custom: true }); c.textContent = T.added; return; }
      if (e.target.closest('[data-list]')) { root.querySelector('.mxs-ta').classList.toggle('on'); ta.focus(); return; }
      if (e.target.closest('[data-send]')) {
        var L = ta.value.split(/\n+/).map(function (l) { l = l.trim(); if (!l) return null; var m = l.match(/^(.*?)[\s,;\t]+(\d{1,4})\s*$/); var code = (m ? m[1] : l).replace(/[,:]/g, ' ').trim().slice(0, 60); return code ? code + ':' + (m ? m[2] : 1) : null; }).filter(Boolean).slice(0, 60);
        if (!L.length) return ta.focus();
        location.href = '/portal?add=' + encodeURIComponent(L.join(','));
      }
    });
  }

  function render(term) {
    var raw = String(term || '').trim();
    if (raw === last) return; last = raw;
    if (raw.length < 2) { out.innerHTML = '<div class="mxs-n">' + esc(T.hint) + '</div>'; return; }
    if (!cat) { out.innerHTML = '<div class="mxs-n">' + esc(T.loading) + '</div>'; return; }
    var toks = raw.toLowerCase().split(/[\s,]+/).map(norm).filter(Boolean), nq = norm(raw), sc = [];
    for (var i = 0; i < cat.length; i++) {
      var ok = true;
      for (var t = 0; t < toks.length; t++) { if (hay[i].indexOf(toks[t]) < 0) { ok = false; break; } }
      if (!ok || (stock && !stock[cat[i][0]])) continue;
      var c = norm(cat[i][0]), c2 = norm(String(cat[i][0]).replace(/^[A-Za-z]{2,4}[.\s]+/, ''));
      sc.push([nq.length >= 4 && (c === nq || c2 === nq) ? 0 : nq.length >= 4 && c.indexOf(nq) >= 0 ? 1 : 2, i]);
      if (sc.length > 800) break;
    }
    sc.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var hits = sc.slice(0, 7).map(function (x) { return cat[x[1]]; });
    var pg = PAGES.filter(function (p) { var h = norm(p[0] + ' ' + p[3]); return toks.every(function (t) { return h.indexOf(t) > -1; }); }).slice(0, 5);
    var h = '';
    if (pg.length) h += '<div class="mxs-k">' + esc(T.pages) + '</div>' + pg.map(function (p) { return '<a class="mxs-r" href="' + p[1] + '"><span class="t"><b>' + esc(p[0]) + '</b></span><span class="mxs-tag">' + esc(p[2]) + '</span></a>'; }).join('');
    if (hits.length) {
      h += '<div class="mxs-k">' + esc(T.parts) + '</div>' + hits.map(function (r) {
        return '<a class="mxs-r" href="/parts/' + slug(r[0]) + '"><span class="t"><b>' + esc(shown(r[0])) + '</b><small>' + esc(r[1]) + (r[4] ? ' · ' + esc(r[4]) : '') + '</small></span>' +
          '<button type="button" class="mxs-a" data-id="' + esc(r[0]) + '">' + esc(T.add) + '</button></a>';
      }).join('');
      if (sc.length > hits.length) h += '<a class="mxs-m" href="/portal?q=' + encodeURIComponent(raw) + '">' + esc(T.more) + ' (' + sc.length + ') &rarr;</a>';
    } else if (!pg.length || /\d/.test(raw)) {
      h += '<div class="mxs-n">' + esc(T.none) + '</div>';
    }
    if (!hits.length && /\d/.test(raw) && raw.replace(/[^0-9a-z]/gi, '').length >= 4) h += '<button type="button" class="mxs-c" data-custom="' + esc(raw.replace(/\s+/g, ' ').slice(0, 60)) + '">' + esc(T.custom.replace('{x}', raw.slice(0, 40))) + '</button>';
    out.innerHTML = h;
    try { (window.dataLayer = window.dataLayer || []).push({ event: 'search', search_term: raw.slice(0, 60), source: 'site_search', results: hits.length }); } catch (e) {}
  }

  var opener = null;
  function open() {
    if (!root) build();
    opener = document.activeElement; root.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    last = null; render(inp.value); load().then(function () { last = null; render(inp.value); });
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
  }
  function close() { root.classList.remove('on'); document.documentElement.style.overflow = ''; if (opener && opener.focus) opener.focus(); }

  function mount() {
    var btn = '<button type="button" class="mxs-b" aria-label="' + esc(T.btn) + '" title="' + esc(T.btn) + ' (/)">' + ICON + '</button>';
    var cta = document.querySelector('nav .nav-cta');
    if (cta && cta.parentNode && !cta.parentNode.querySelector('.mxs-b')) { cta.insertAdjacentHTML('beforebegin', btn); }
    else { var mn = document.querySelector('nav details.mnav'); if (mn && !mn.parentNode.querySelector('.mxs-b')) mn.insertAdjacentHTML('beforebegin', btn); }
    if (!document.getElementById('mxs-css0')) { var s0 = document.createElement('style'); s0.id = 'mxs-css0'; s0.textContent = CSS.split('.mxs{')[0]; document.head.appendChild(s0); }
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.mxs-b')) { e.preventDefault(); open(); } });
    document.addEventListener('keydown', function (e) {
      var tg = e.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); }
      else if (e.key === '/' && !typing) { e.preventDefault(); open(); }
      else if (e.key === 'Escape' && root && root.classList.contains('on')) close();
    });
    var m = /[?&]search=([^&]*)/.exec(location.search);
    if (m) { open(); inp.value = decodeURIComponent(m[1].replace(/\+/g, ' ')); last = null; load().then(function () { render(inp.value); }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
