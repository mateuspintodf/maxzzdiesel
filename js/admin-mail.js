/* Marketing > E-mails: list, block editor with live preview, sending and results.
   Lives beside admin.html and uses its helpers through window.MXA (state, api, draw, small HTML helpers). */
(function () {
  var A = window.MXA; if (!A) return;
  var S = A.S, esc = A.esc, ic = A.ic, n0 = A.n0, app = document.getElementById('app');
  function M() { if (!S.ml) S.ml = { list: null, tab: 'draft', ed: null, rep: null, pick: false, so: { k: 'updated_at', d: -1 } }; return S.ml; }
  var css = '.ml-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}@media(max-width:1100px){.ml-grid{grid-template-columns:1fr}}' +
    '.ml-f{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}.ml-f>span{font-size:12.5px;color:#5f656c;font-weight:500}.ml-f input,.ml-f textarea,.ml-f select{font:inherit;border:1px solid #c9ced3;border-radius:12px;padding:10px 12px;width:100%;box-sizing:border-box;background:#fff}.ml-f textarea{resize:vertical;min-height:84px;line-height:1.45}.ml-f textarea.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px}' +
    '.ml-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ml-3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}' +
    '.ml-b{border:1px solid #e3e6e9;border-radius:16px;padding:14px 16px;margin:0 0 12px;background:#fff}.ml-bh{display:flex;align-items:center;gap:8px;margin:0 0 10px}.ml-bh b{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#5f656c}.ml-bh .sp{flex:1}.ml-ib{border:1px solid #e3e6e9;background:#fff;border-radius:999px;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#1d2126;font-size:14px}.ml-ib:hover{border-color:#1d2126}.ml-ib[disabled]{opacity:.35;cursor:default}' +
    '.ml-add{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 0}.ml-seg{display:inline-flex;background:#f1f2f4;border-radius:999px;padding:3px}.ml-seg button{border:0;background:transparent;border-radius:999px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer;color:#3a4048}.ml-seg button.on{background:#1d2126;color:#fff}' +
    '.ml-prev{position:sticky;top:14px}.ml-fr{width:100%;height:calc(100vh - 250px);min-height:420px;border:1px solid #e3e6e9;border-radius:16px;background:#f2f3f5;display:block;margin:0 auto;transition:width .2s}.ml-fr.m{width:390px;max-width:100%}' +
    '.ml-chips{display:flex;flex-wrap:wrap;gap:6px}.ml-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #c9ced3;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;background:#fff;user-select:none}.ml-chip.on{background:#1d2126;border-color:#1d2126;color:#fff}.ml-chip small{opacity:.7}' +
    '.ml-res{border:1px solid #e3e6e9;border-radius:12px;margin:6px 0 0;max-height:220px;overflow:auto}.ml-res button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef0f2;background:#fff;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}.ml-res button:hover{background:#f7f8f9}.ml-res button b{font-family:ui-monospace,Menlo,monospace}' +
    '.ml-note{font-size:12.5px;color:#5f656c;line-height:1.5;margin:6px 0 0}.ml-warn{background:#fff4e5;border:1px solid #f3d3a4;color:#7a3d00;border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.5;margin:0 0 12px}.ml-good{background:#eaf6ee;border:1px solid #b9e0c6;color:#136c33;border-radius:12px;padding:10px 12px;font-size:13px;margin:0 0 12px}' +
    '.ml-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:6px 16px 18px}.ml-pick button{text-align:left;border:1px solid #e3e6e9;border-radius:16px;background:#fff;padding:16px;cursor:pointer;font:inherit}.ml-pick button:hover{border-color:#1d2126}.ml-pick b{display:block;font-size:15px;margin:0 0 4px}.ml-pick small{color:#5f656c;font-size:12.5px;line-height:1.4;display:block}' +
    '.ml-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ml-row .sp{flex:1}.ml-st{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:#eef0f2;color:#5f656c}.ml-st.sent{background:#eaf6ee;color:#136c33}.ml-st.sending,.ml-st.scheduled{background:#fff4e5;color:#9a4b00}.ml-st.failed,.ml-st.bounced,.ml-st.complained,.ml-st.cancelled{background:#fdecee;color:#b71f2b}.ml-st.held{background:#eef0f2;color:#5f656c}';
  css += '.ml-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:16px;padding:8px 20px 24px}.ml-card{border:1px solid #e3e6e9;border-radius:20px;background:#fff;padding:10px 10px 14px;text-align:left;cursor:pointer;display:flex;flex-direction:column;font:inherit;color:inherit;transition:border-color .15s,transform .15s,box-shadow .15s}.ml-card:hover{border-color:#1d2126;transform:translateY(-2px);box-shadow:0 10px 24px rgba(20,24,28,.10)}.ml-card b{font-size:15px;margin:12px 4px 3px;display:block}.ml-card small{font-size:12.5px;line-height:1.45;color:#5f656c;margin:0 4px;display:block}.ml-card em{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c2410c;margin:0 4px;display:block}' +
    '.ml-th{height:236px;border-radius:12px;background:#e9ebee;overflow:hidden;padding:14px 22px 0;display:block}.ml-wf{display:block;background:#fff;border-radius:8px 8px 0 0;height:100%;overflow:hidden;box-shadow:0 2px 12px rgba(20,24,28,.10)}.ml-th.real{padding:0;position:relative}.ml-th.real iframe{width:680px;height:800px;border:0;transform:scale(.34);transform-origin:0 0;pointer-events:none;display:block;position:absolute;left:50%;margin-left:-116px;top:0}' +
    '.ml-gh{padding:4px 20px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ml-gt{padding:14px 20px 0;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5f656c}.ml-lk{display:grid;grid-template-columns:1fr 2fr;gap:8px;margin:0 0 8px}.ml-lk input{font:inherit;border:1px solid #c9ced3;border-radius:12px;padding:9px 12px;width:100%;box-sizing:border-box;background:#fff}.ml-h4{margin:18px 0 10px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5f656c}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var TYPES = [['heading', 'Heading'], ['text', 'Text'], ['products', 'Products'], ['banner', 'Banner'], ['button', 'Button'], ['image', 'Image'], ['divider', 'Line'], ['spacer', 'Space']];
  var NEWB = { heading: function () { return { type: 'heading', text: '', size: 'm' }; }, text: function () { return { type: 'text', text: '' }; }, products: function () { return { type: 'products', codes: [], layout: 'grid2', price: 'none', cta: 'View part' }; },
    banner: function () { return { type: 'banner', text: '', sub: '', bg: 'red', label: '', url: '' }; }, button: function () { return { type: 'button', label: '', url: 'https://www.maxzzdiesel.com/portal' }; }, image: function () { return { type: 'image', src: '', alt: '', url: '' }; }, divider: function () { return { type: 'divider' }; }, spacer: function () { return { type: 'spacer', h: 20 }; } };
  var STORE = 'https://www.maxzzdiesel.com/portal';
  // layout suggestions and e-mail sections, shared with the designer
  var SX = window.MXSections || null;
  if (!SX) { var sx = document.createElement('script'); sx.src = '/js/mail-sections.js?v=3'; sx.onload = function () { SX = window.MXSections; if (S.tab === 'emails') A.draw(); }; document.head.appendChild(sx); }
  // the small picture of a layout: header, one strip per section, in the order they appear
  var ln = function (w, h, c, m) { return '<span style="display:block;width:' + w + '%;height:' + h + 'px;border-radius:' + Math.min(3, h / 2) + 'px;background:' + c + ';margin:' + (m || 0) + 'px 0 0"></span>'; };
  var bx = function (inner, st) { return '<span style="display:block;padding:7px 11px;' + (st || '') + '">' + inner + '</span>'; };
  var pill = function (c, m) { return '<span style="display:block;width:40px;height:10px;border-radius:5px;background:' + (c || '#d32a37') + ';margin:' + (m == null ? 6 : m) + 'px 0 0"></span>'; };
  var tile = function () { return '<span style="flex:1;border:1px solid #eceef0;border-radius:5px;padding:4px;display:block"><span style="display:block;height:26px;border-radius:3px;background:#e3e6e9"></span>' + ln(80, 3, '#1d2126', 4) + ln(60, 2.5, '#d5d9dd', 3) + '<span style="display:block;width:20px;height:6px;border-radius:3px;background:#d32a37;margin:4px 0 0"></span></span>'; };
  var lrow = function () { return '<span style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #eceef0"><span style="width:18px;height:14px;border-radius:3px;background:#e3e6e9;flex:none"></span><span style="flex:1">' + ln(58, 3, '#1d2126') + ln(80, 2.5, '#d5d9dd', 3) + '</span><span style="width:24px;height:8px;border-radius:4px;background:#d32a37;flex:none"></span></span>'; };
  var WT = {
    hd: bx(ln(22, 3, '#f08a24') + ln(74, 7, '#fff', 5) + ln(88, 3, '#6b727a', 5) + pill(), 'background:#1d2126;padding:12px 11px 14px'),
    hs: bx(ln(22, 3, '#c2410c') + ln(74, 7, '#1d2126', 5) + ln(88, 3, '#c9ced3', 5) + pill(), 'background:#f1f2f4;padding:12px 11px 14px'),
    t: bx(ln(58, 6, '#1d2126'), 'padding:11px 11px 2px'), p: bx(ln(100, 3, '#d5d9dd') + ln(84, 3, '#d5d9dd', 3)), s: bx(ln(90, 2, '#e3e6e9') + ln(60, 2, '#e3e6e9', 3)),
    b: bx(pill('#d32a37', 0), 'padding:6px 11px 9px'), d: bx('<span style="display:block;border-top:1px solid #e3e6e9"></span>', 'padding:6px 11px'),
    bn: bx(bx(ln(30, 3, '#ffc9cd') + ln(76, 7, '#fff', 5) + ln(60, 3, '#ffc9cd', 5) + pill('#fff'), 'background:#d32a37;border-radius:7px;padding:10px'), 'padding:10px 11px 3px'),
    l: bx(lrow() + lrow() + lrow(), 'padding:3px 11px 5px'), l1: bx(lrow(), 'padding:3px 11px 5px'),
    g2: bx('<span style="display:flex;gap:5px">' + tile() + tile() + '</span>'), g3: bx('<span style="display:flex;gap:4px">' + tile() + tile() + tile() + '</span>'),
    f3: bx('<span style="display:flex;gap:4px">' + [0, 1, 2].map(function () { return '<span style="flex:1;background:#f4f5f6;border-radius:5px;padding:6px 5px;display:block">' + ln(30, 3, '#d32a37') + ln(80, 4, '#1d2126', 4) + ln(90, 2.5, '#c9ced3', 4) + '</span>'; }).join('') + '</span>'),
    it: bx('<span style="display:flex;gap:7px;align-items:center"><span style="flex:none;width:44%;height:42px;border-radius:5px;background:#dfe2e6"></span><span style="flex:1">' + ln(80, 5, '#1d2126') + ln(100, 2.5, '#d5d9dd', 5) + ln(70, 2.5, '#d5d9dd', 3) + ln(36, 3, '#d32a37', 5) + '</span></span>'),
    n: bx(bx(ln(40, 4, '#1d2126') + ln(92, 2.5, '#d9c9b0', 4), 'background:#fff3e2;border-left:3px solid #f08a24;border-radius:4px;padding:7px 8px')),
    c: bx('<span style="display:flex;align-items:center;gap:6px;background:#1d2126;border-radius:7px;padding:9px"><span style="flex:1">' + ln(70, 4, '#fff') + ln(90, 2.5, '#6b727a', 4) + '</span><span style="width:32px;height:11px;border-radius:6px;background:#d32a37;flex:none"></span></span>', 'padding:8px 11px')
  };
  function wire(tk) { return '<span class="ml-th"><span class="ml-wf"><span style="display:flex;align-items:center;height:17px;background:#1d2126;padding:0 11px;border-bottom:1px solid #2c3138"><span style="width:28px;height:5px;border-radius:3px;background:#d32a37"></span></span>' + tk.map(function (t) { return WT[t] || ''; }).join('') + '</span></span>'; }

  function fmt(d) { return d ? A.fmtAt(d) : '-'; }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '-'; }
  function f(label, path, val, o) { o = o || {}; var at = ' data-mf="' + path + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '');
    return '<label class="ml-f"><span>' + label + '</span>' + (o.area ? '<textarea' + at + (o.mono ? ' class="mono"' : '') + ' rows="' + (o.rows || 4) + '">' + esc(val || '') + '</textarea>' : o.sel ? '<select' + at + '>' + o.sel.map(function (x) { return A.opt(x[0], x[1], val); }).join('') + '</select>' : '<input type="' + (o.type || 'text') + '"' + at + ' value="' + esc(val == null ? '' : val) + '">') + (o.note ? '<small class="ml-note">' + o.note + '</small>' : '') + '</label>'; }
  function seg(path, val, opts) { return '<div class="ml-seg">' + opts.map(function (x) { return '<button type="button" data-ml="set" data-p="' + path + '" data-v="' + x[0] + '" class="' + (val === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>'; }

  // ------------------------------------------------------------------ list
  function load() { A.api('mail-list').then(function (r) { if (r._status === 200) { M().list = r; S.tabErr = null; A.draw(); } else { S.tabErr = 'emails'; A.draw(); } }); }
  var TABS = [['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['sent', 'Sending and sent'], ['tpl', 'Templates'], ['tx', 'Portal e-mails']];
  function inTab(c, t) { return t === 'tpl' ? c.is_template : c.is_template ? false : t === 'draft' ? c.status === 'draft' : t === 'scheduled' ? c.status === 'scheduled' : ['sending', 'sent', 'cancelled'].indexOf(c.status) >= 0; }
  function viewList() {
    var m = M(), L = m.list; if (!L) return A.ld();
    var h = '';
    if (!L.key) h += '<div class="ml-warn"><b>Sending is not set up:</b> the Resend key (RESEND_API_KEY) is missing in this environment. You can build and preview e-mails, nothing goes out.</div>';
    else if (!L.mailOn) h += '<div class="ml-warn"><b>Customer e-mail is switched off.</b> Campaigns only reach team addresses and the pilot address for now; everyone else is kept on record as "held". Sending from: ' + esc(L.from) + '</div>';
    if (m.pick) return h + viewPick(L);
    var rows = L.campaigns.filter(function (c) { return inTab(c, m.tab); }).map(function (c) { var s = c.stats || {}; c.rec = s.total || 0; c.op = s.opened || 0; c.cl = s.clicked || 0; c.when = c.sent_at || c.scheduled_at || c.updated_at; return c; });
    S.mlso = S.mlso || { k: 'when', d: -1 }; rows = A.sortRows(rows, 'mlso');
    var cnt = function (t) { return t === 'tx' ? (L.templates || []).length : L.campaigns.filter(function (c) { return inTab(c, t); }).length; };
    h += '<section class="card flush"><div class="fbar"><div class="seg" style="background:var(--soft)">' + TABS.map(function (t) { return '<button data-ml="tab" data-v="' + t[0] + '" class="' + (m.tab === t[0] ? 'on' : '') + '">' + t[1] + ' ' + cnt(t[0]) + '</button>'; }).join('') + '</div><span class="sp"></span><button class="btn ghost sm" data-ml="lay">Header and footer</button><button class="btn acc" data-ml="pick">' + ic('plus', 16) + ' New e-mail</button></div>';
    if (m.tab === 'tx') return h + '<p class="ml-note" style="padding:0 20px 6px">These go out by themselves when something happens in the portal. You can change the subject, the title, the button and add a note on top. The details (order lines, links, amounts) are written by the system and cannot be removed.</p>' +
      A.tbl([A.h0('E-mail'), A.h0('Subject'), A.h0('Wording'), A.h0('')], (L.templates || []).map(function (t) { var sv = t.saved; return '<tr data-ml="tx" data-id="' + t.key + '" style="cursor:pointer"><td><b>' + esc(t.name) + '</b></td><td>' + esc((sv && sv.subject) || t.subject) + '</td><td>' + (sv ? '<span class="ml-st sending">changed</span><small>' + esc(String(sv.updated_by || '').split('@')[0]) + ' · ' + esc(fmt(sv.updated_at)) + '</small>' : '<span class="ml-st">built-in</span>') + '</td><td class="r"><button class="btn ghost sm" data-ml="tx" data-id="' + t.key + '">Edit</button></td></tr>'; })) + '</section>';
    var sent = m.tab === 'sent';
    h += A.tbl([A.th('name', 'E-mail', 'mlso'), A.th('status', 'Status', 'mlso'), A.th('when', sent ? 'Sent' : m.tab === 'scheduled' ? 'Goes out' : 'Changed', 'mlso')].concat(sent ? [A.th('rec', 'Recipients', 'mlso', 1), A.th('op', 'Opened', 'mlso', 1), A.th('cl', 'Clicked', 'mlso', 1)] : [A.th('created_by', 'By', 'mlso')]).concat([A.h0('')]),
      rows.map(function (c) { var s = c.stats || {};
        return '<tr data-ml="' + (sent ? 'rep' : 'open') + '" data-id="' + c.id + '" style="cursor:pointer"><td><b>' + esc(c.name) + '</b><small>' + esc(c.subject || 'No subject yet') + '</small></td><td><span class="ml-st ' + c.status + '">' + (c.is_template ? 'template' : c.status) + '</span></td><td class="nw">' + esc(fmt(c.when)) + '</td>' +
          (sent ? '<td class="r">' + n0(s.total) + (s.held ? '<small>' + n0(s.held) + ' held</small>' : '') + '</td><td class="r">' + n0(s.opened) + '<small>' + pct(s.opened, s.reached) + '</small></td><td class="r">' + n0(s.clicked) + '<small>' + pct(s.clicked, s.reached) + '</small></td>' : '<td>' + esc(String(c.created_by || '').split('@')[0]) + '</td>') +
          '<td class="nw r"><button class="btn ghost sm" data-ml="copy" data-id="' + c.id + '">Duplicate</button> ' + (c.status === 'scheduled' ? '<button class="btn ghost sm" data-ml="cancel" data-id="' + c.id + '">Cancel</button>' : c.status === 'sending' ? '' : '<button class="btn ghost sm" data-ml="arch" data-id="' + c.id + '">Archive</button>') + '</td></tr>'; }));
    return h + '</section>';
  }

  // ------------------------------------------------------------------ new e-mail: layout suggestions with a small picture each
  function viewPick(L) {
    var m = M(), g = m.pg || 'All', ST = SX ? SX.STARTERS : [], mine = L.campaigns.filter(function (c) { return c.is_template; });
    var groups = ['All', 'Products', 'Promotions', 'News'].concat(mine.length ? ['Your templates'] : []);
    var h = '<section class="card flush"><div class="fbar"><h2>Start a new e-mail</h2><span class="sp"></span><button class="btn ghost sm" data-ml="pick-x">Cancel</button></div><div class="ml-gh"><div class="seg" style="background:var(--soft)">' + groups.map(function (x) { return '<button data-ml="pg" data-v="' + x + '" class="' + (g === x ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div><span class="ml-note" style="margin:0 0 0 6px">Pick a layout. It opens in the designer with sample parts, ready to change.</span></div>';
    if (!SX) return h + A.ld() + '</section>';
    var cards = ST.map(function (s, i) { return g === 'All' || g === s[2] ? '<button class="ml-card" data-ml="new" data-i="' + i + '">' + wire(s[4]) + '<b>' + esc(s[0]) + '</b><small>' + esc(s[1]) + '</small></button>' : ''; }).join('');
    if (g !== 'Your templates' && cards) h += '<div class="ml-gal">' + cards + '</div>';
    if (mine.length && (g === 'All' || g === 'Your templates')) { m.tp = m.tp || {};
      h += (g === 'All' ? '<div class="ml-gt">Your templates</div>' : '') + '<div class="ml-gal">' + mine.map(function (c) { var pv = m.tp[c.id]; return '<div class="ml-card" role="button" tabindex="0" data-ml="from" data-id="' + c.id + '"><span class="ml-th real">' + (pv && pv !== 1 ? '<iframe sandbox="" tabindex="-1" title="" srcdoc="' + esc(pv) + '"></iframe>' : '') + '</span><b>' + esc(c.name) + '</b><small>' + esc(c.subject || 'No subject yet') + '</small></div>'; }).join('') + '</div>';
      mine.slice(0, 12).forEach(function (c) { if (m.tp[c.id]) return; m.tp[c.id] = 1; A.api('mail-preview', { id: c.id }).then(function (r) { if (r._status === 200 && r.html) { m.tp[c.id] = r.html; if (M().pick) A.draw(); } }); }); }
    return h + '</section>';
  }

  // ------------------------------------------------------------------ header and footer, the same in every e-mail
  function openLay() { var m = M(); m.lay = { loading: true }; A.draw(); A.api('mail-layout').then(function (r) { if (r._status !== 200) { m.lay = null; A.toast(r.error || 'Could not open it.'); return A.draw(); }
    var L = r.layout; while (L.header.links.length < 3) L.header.links.push({ label: '', url: '' }); while (L.footer.links.length < 4) L.footer.links.push({ label: '', url: '' }); m.lay = { L: L, html: '', dev: 'd' }; A.draw(); layPrev(0); }); }
  function layPrev(wait) { clearTimeout(pt); pt = setTimeout(function () { var Y = M().lay; if (!Y || !Y.L || !SX) return; A.api('mail-preview', { name: 'Sample', subject: 'Sample', content: { mode: 'free', html: SX.STARTERS[0][5](), blocks: [] }, layout: Y.L }).then(function (r) { var Y2 = M().lay; if (!Y2 || r._status !== 200) return; Y2.html = r.html; setFrame(); }); }, wait == null ? 600 : wait); }
  function viewLay() { var Y = M().lay; if (Y.loading) return A.ld(); var L = Y.L, H = L.header, Fo = L.footer;
    var lk = function (base, l, i, ph) { return '<div class="ml-lk"><input type="text" data-mf="y.' + base + '.links.' + i + '.label" value="' + esc(l.label || '') + '" placeholder="' + ph + '" maxlength="30" aria-label="Link text"><input type="url" data-mf="y.' + base + '.links.' + i + '.url" value="' + esc(l.url || '') + '" placeholder="https://" aria-label="Link address"></div>'; };
    var left = '<section class="card"><div class="ml-row" style="margin:0 0 6px"><button class="btn ghost sm" data-ml="back">← All e-mails</button><b>Header and footer</b><span class="sp"></span><button class="btn sm" data-ml="lay-save"' + (Y.saving ? ' disabled' : '') + '>Save</button></div><p class="ml-note" style="margin:0 0 4px">Used in every campaign and template, also the ones already saved. The unsubscribe link and the company address always go out.</p>' +
      '<div class="ml-h4">Header</div><div class="ml-row" style="margin:0 0 12px"><span class="ml-note" style="margin:0;min-width:86px">Background</span>' + seg('y.header.bg', H.bg, [['dark', 'Dark'], ['light', 'White']]) + '</div><div class="ml-row" style="margin:0 0 12px"><span class="ml-note" style="margin:0;min-width:86px">Logo</span>' + seg('y.header.align', H.align, [['left', 'Left'], ['center', 'Centered']]) + '</div><div class="ml-f"><span>Links beside the logo (optional, up to 3)</span>' + H.links.map(function (l, i) { return lk('header', l, i, ['Store', 'Promotions', 'Contact'][i]); }).join('') + '</div>' +
      '<div class="ml-h4">Footer</div>' + f('Line beside the name', 'y.footer.tagline', Fo.tagline, { max: 120 }) + '<div class="ml-2">' + f('Phone', 'y.footer.phone', Fo.phone, { max: 40 }) + f('WhatsApp', 'y.footer.whatsapp', Fo.whatsapp, { max: 40 }) + '</div>' + f('E-mail', 'y.footer.email', Fo.email, { max: 120 }) + f('Company address (required by law in marketing e-mail)', 'y.footer.address', Fo.address, { max: 240 }) + f('Why the person receives it', 'y.footer.reason', Fo.reason, { max: 240 }) + '<div class="ml-f"><span>Links (optional, up to 4)</span>' + Fo.links.map(function (l, i) { return lk('footer', l, i, ['Wholesale store', 'Training', 'Instagram', 'LinkedIn'][i]); }).join('') + '</div></section>';
    return '<div class="ml-grid"><div>' + left + '</div><div class="ml-prev"><section class="card"><div class="ml-row" style="margin:0 0 12px"><h3 style="margin:0">Preview</h3><span class="sp"></span>' + seg('y.dev', Y.dev, [['d', 'Desktop'], ['m', 'Phone']]) + '</div><iframe id="ml-fr" class="ml-fr' + (Y.dev === 'm' ? ' m' : '') + '" title="E-mail preview" sandbox=""></iframe></section></div></div>'; }

  // ------------------------------------------------------------------ editor
  function openEd(id, seed) {
    var m = M(); m.pick = false; m.ed = { loading: true }; A.draw();
    A.api('mail-get', null, id ? '&id=' + id : '').then(function (r) {
      if (r._status !== 200) { m.ed = null; closeDesign(); A.toast(r.error || 'Could not open it.'); return; }
      var c = r.campaign || { name: seed && seed.name || 'New e-mail', subject: seed && seed.subject || '', preheader: '', lang: 'en', content: seed && seed.html ? { mode: 'free', html: seed.html, blocks: [] } : { blocks: seed && seed.blocks || [] }, audience: { segments: [], exclude: [], customers: false, tiers: [], salespeople: [], consent: 'optin' }, status: 'draft', is_template: false };
      c.content = c.content || { blocks: [] }; c.audience = Object.assign({ segments: [], exclude: [], customers: false, tiers: [], salespeople: [], consent: 'optin' }, c.audience || {});
      c.content.blocks.forEach(function (b) { if (b.type === 'products') b._txt = (b.codes || []).join('\n'); });
      m.ed = { c: c, canSend: !!r.canSend, simple: false, segs: r.segments, facets: r.facets, from: r.from, dev: 'd', fresh: !id && !!(seed && seed.design), dirty: !id, test: r.me || '', when: '', aud: null, html: '', miss: [], find: {}, lock: c.status !== 'draft' };
      A.draw(); preview(0); if (seed && seed.design) design(); else closeDesign();
      if (!S.cat) A.api('catalog-all').then(function (x) { if (x._status === 200) { S.cat = x; } });
    });
  }
  function payload() { var c = M().ed.c; return { id: c.id, name: c.name, subject: c.subject, preheader: c.preheader, lang: c.lang, is_template: !!c.is_template, audience: c.audience,
    content: { mode: c.content.mode === 'free' ? 'free' : undefined, html: c.content.mode === 'free' ? c.content.html : undefined, project: c.content.mode === 'free' ? c.content.project : undefined, blocks: c.content.blocks.map(function (b) { var o = {}; for (var k in b) if (k.charAt(0) !== '_') o[k] = b[k]; if (b.type === 'products') o.codes = String(b._txt == null ? (b.codes || []).join('\n') : b._txt).split(/[\s,;]+/).filter(Boolean); return o; }) } }; }
  var pt = 0;
  function preview(wait) { clearTimeout(pt); pt = setTimeout(function () { var E = M().ed; if (!E || !E.c) return; A.api('mail-preview', payload()).then(function (r) { var E2 = M().ed; if (!E2 || r._status !== 200) return; E2.html = r.html; var miss = (r.missing || []).join(','), ch = miss !== (E2.miss || []).join(','); E2.miss = r.missing || []; setFrame(); if (ch) A.draw(); }); }, wait == null ? 700 : wait); }
  // the visual designer (GrapesJS) opens over the whole screen, in its own frame, and hands the result back
  var ov = null;
  function closeDesign() { if (ov) { ov.remove(); ov = null; document.documentElement.style.overflow = ''; } }
  // the cover goes up at once (with a spinner), so the form behind it is never seen while the designer loads
  function cover() { if (ov) return; ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:5000;background:#e9ebee;display:flex;align-items:center;justify-content:center;color:#5f656c;font-size:14px'; ov.innerHTML = '<span>Opening the designer…</span>'; document.body.appendChild(ov); document.documentElement.style.overflow = 'hidden'; }
  function design() {
    var E = M().ed; if (!E || E.lock || (ov && ov._data)) return; var c = E.c; cover();
    var start = function (data) { if (!ov) return; ov._data = data; ov.innerHTML = '<iframe src="/mail-editor.html?v=3" title="E-mail designer" style="border:0;width:100%;height:100%;display:block"></iframe>'; };
    if (c.content.mode === 'free' && (c.content.project || c.content.html)) return start({ project: c.content.project || null, html: c.content.html || '' });
    A.api('mail-seed', payload()).then(function (r) { start({ project: null, html: (r && r.html) || '' }); });
  }
  window.addEventListener('message', function (e) { if (e.origin !== location.origin || !e.data || !ov) return; var E = M().ed, d = e.data;
    if (d.type === 'mx-ready' && ov._data) { var fr = ov.querySelector('iframe'); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ type: 'mx-load', project: ov._data.project, html: ov._data.html }, location.origin); }
    if (d.type === 'mx-cancel') { closeDesign(); if (E && E.fresh) { var m0 = M(); m0.ed = null; m0.pick = true; A.draw(); } }
    if (d.type === 'mx-done' && E) { E.fresh = false; E.c.content.mode = 'free'; E.c.content.html = String(d.html || ''); E.c.content.project = d.project || null; E.dirty = true; closeDesign(); A.draw(); preview(0); } });
  function setFrame() { var E = M().lay || M().tx || M().ed, fr = document.getElementById('ml-fr'); if (fr && E && E.html && fr._h !== E.html) { fr._h = E.html; fr.srcdoc = E.html; } }
  function blockForm(b, i, n, lock) {
    var p = 'b.' + i + '.', body = '';
    if (b.type === 'heading') body = f('Text', p + 'text', b.text, { max: 200 }) + seg(p + 'size', b.size || 'm', [['m', 'Normal'], ['l', 'Large']]);
    if (b.type === 'text') body = f('Text', p + 'text', b.text, { area: 1, rows: 5, note: 'Fields: {{first_name}} {{company}} {{salesperson}}. **bold** and [label](https://link) work.' });
    if (b.type === 'button') body = '<div class="ml-2">' + f('Label', p + 'label', b.label, { max: 60 }) + f('Link', p + 'url', b.url, { ph: 'https://' }) + '</div>';
    if (b.type === 'image') body = f('Image address (https)', p + 'src', b.src, { ph: 'https://' }) + '<div class="ml-2">' + f('Description', p + 'alt', b.alt) + f('Link (optional)', p + 'url', b.url, { ph: 'https://' }) + '</div>';
    if (b.type === 'banner') body = f('Headline', p + 'text', b.text, { max: 160 }) + f('Line under it (optional)', p + 'sub', b.sub) + '<div class="ml-2">' + f('Button label (optional)', p + 'label', b.label) + f('Button link', p + 'url', b.url, { ph: 'https://' }) + '</div>' + seg(p + 'bg', b.bg || 'red', [['red', 'Red'], ['dark', 'Dark'], ['orange', 'Orange'], ['soft', 'Light']]);
    if (b.type === 'spacer') body = f('Height in pixels', p + 'h', b.h, { type: 'number' });
    if (b.type === 'products') {
      var E = M().ed, q = E.find[i] || '', res = '';
      if (q.length >= 2 && S.cat) { var qq = q.toLowerCase().replace(/[^a-z0-9]/g, ''), hit = S.cat.rows.filter(function (r) { return (r[0] + ' ' + r[1]).toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(qq) >= 0; }).slice(0, 8);
        res = '<div class="ml-res">' + (hit.length ? hit.map(function (r) { return '<button type="button" data-ml="addp" data-i="' + i + '" data-c="' + esc(r[0]) + '"><b>' + esc(r[0]) + '</b> ' + esc(String(r[1]).slice(0, 70)) + '</button>'; }).join('') : '<button type="button" disabled>Nothing found</button>') + '</div>'; }
      body = '<div class="ml-row" style="margin:0 0 12px"><span class="ml-note" style="margin:0">Layout</span>' + seg(p + 'layout', b.layout || 'list', [['list', 'List'], ['grid2', '2 columns'], ['grid3', '3 columns']]) + '</div>' +
        '<label class="ml-f"><span>Find a part to add</span><input type="search" data-mlfind="' + i + '" value="' + esc(q) + '" placeholder="Part number or description">' + res + '</label>' +
        f('Part numbers, one per line (order is kept)', p + '_txt', b._txt, { area: 1, mono: 1, rows: 4 }) +
        '<div class="ml-2">' + f('Price', p + 'price', b.price || 'none', { sel: [['none', 'No price'], ['tier', 'Price of each customer (their tier)']] }) + f('Button text', p + 'cta', b.cta, { max: 40 }) + '</div>' +
        (b.price === 'tier' ? '<p class="ml-note">Each person sees the price of their own account. People who are not matched to a customer see no price.</p>' : '');
    }
    var name = (TYPES.filter(function (t) { return t[0] === b.type; })[0] || [0, b.type])[1];
    return '<div class="ml-b"><div class="ml-bh"><b>' + name + '</b><span class="sp"></span>' + (lock ? '' : '<button class="ml-ib" data-ml="up" data-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button class="ml-ib" data-ml="down" data-i="' + i + '"' + (i < n - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button><button class="ml-ib" data-ml="del" data-i="' + i + '" aria-label="Remove">×</button>') + '</div>' + body + '</div>';
  }
  function audPanel(E) {
    var a = E.c.audience, F = E.facets || { tiers: [], salespeople: [], customers: 0 };
    var chip = function (k, v, label, n) { var on = (a[k] || []).indexOf(v) >= 0; return '<span class="ml-chip ' + (on ? 'on' : '') + '" data-ml="aud" data-k="' + k + '" data-v="' + esc(v) + '">' + esc(label) + (n != null ? ' <small>' + n0(n) + '</small>' : '') + '</span>'; };
    var h = '<h3 style="margin:0 0 10px">Who receives it</h3><div class="ml-f"><span>Lists</span><div class="ml-chips"><span class="ml-chip ' + (a.customers ? 'on' : '') + '" data-ml="audc">All Unleashed customers with e-mail <small>' + n0(F.customers) + '</small></span>' + E.segs.map(function (s) { return chip('segments', s.id, s.name, s.n); }).join('') + '</div></div>';
    h += '<div class="ml-f"><span>Only these tiers (none ticked means all)</span><div class="ml-chips">' + F.tiers.map(function (t) { return chip('tiers', t[0], t[0], t[1]); }).join('') + '</div></div>';
    h += '<div class="ml-f"><span>Only these salespeople (none ticked means all)</span><div class="ml-chips">' + F.salespeople.map(function (t) { return chip('salespeople', t[0], t[0], t[1]); }).join('') + '</div></div>';
    if (E.segs.length) h += '<div class="ml-f"><span>Leave out the people of these lists</span><div class="ml-chips">' + E.segs.map(function (s) { return chip('exclude', s.id, s.name, s.n); }).join('') + '</div></div>';
    h += f('Consent', 'a.consent', a.consent, { sel: [['optin', 'Only people who asked to receive promotions and news'], ['customers', 'Customers and contacts on file (always with the unsubscribe link)']] });
    h += f('Limit per person', 'a.maxPerWeek', String(a.maxPerWeek || 0), { sel: [['0', 'No limit'], ['1', 'At most 1 campaign in 7 days'], ['2', 'At most 2 campaigns in 7 days'], ['3', 'At most 3 campaigns in 7 days']] });
    h += '<div class="ml-row"><button class="btn sm" data-ml="count"' + (E.counting ? ' disabled' : '') + '>Count recipients</button>';
    if (E.aud) { var I = E.aud.info, out = []; if (I.noOptin) out.push(n0(I.noOptin) + ' without opt-in'); if (I.unsubscribed) out.push(n0(I.unsubscribed) + ' unsubscribed'); if (I.bounced) out.push(n0(I.bounced) + ' bounced or reported spam'); if (I.excludedList) out.push(n0(I.excludedList) + ' in the left out lists'); if (I.invalid) out.push(n0(I.invalid) + ' invalid addresses'); if (I.capped) out.push(n0(I.capped) + ' already at the weekly limit');
      h += '<b>' + n0(I.count) + ' will receive</b></div><p class="ml-note">' + n0(I.matched) + ' matched the lists and filters' + (out.length ? '. Left out: ' + out.join(', ') : '') + '.' + (E.aud.sample.length ? ' For example: ' + E.aud.sample.slice(0, 4).map(function (p) { return esc(p.email); }).join(', ') + '.' : '') + '</p>'; }
    else h += '</div>';
    return h;
  }
  function viewEd() {
    var E = M().ed; if (E.loading) return A.ld();
    var c = E.c, bl = c.content.blocks, lock = E.lock;
    var left = '<section class="card"><div class="ml-row" style="margin:0 0 14px"><button class="btn ghost sm" data-ml="back">← All e-mails</button><span class="sp"></span><span class="ml-st ' + c.status + '">' + (c.is_template ? 'template' : c.status) + '</span>' + (E.dirty ? '<span class="ml-note" style="margin:0">Not saved</span>' : '') + (lock ? '' : '<button class="btn sm" data-ml="save"' + (E.saving ? ' disabled' : '') + '>Save</button>') + '</div>';
    if (lock) left += '<div class="ml-warn">This e-mail is ' + esc(c.status) + ' and cannot be changed. Duplicate it to send a new version.</div>';
    left += f('Name (only you see it)', 'c.name', c.name, { max: 120 }) + f('Subject', 'c.subject', c.subject, { max: 200, ph: 'What the person reads in the inbox' }) + f('Preview text (the grey line after the subject)', 'c.preheader', c.preheader, { max: 200 }) + '</section>';
    var free = c.content.mode === 'free';
    if (!lock) left += '<section class="card"><h3 style="margin:0 0 6px">Design</h3><p class="ml-note" style="margin:0 0 12px">' + (free ? 'This e-mail was built in the designer. Open it again to change anything.' : 'Drag and drop blocks, change colours and text on the e-mail itself, and place products in a list, 2 or 3 columns.') + '</p><div class="ml-row"><button class="btn acc" data-ml="design">' + (free ? 'Open the designer' : 'Open the visual designer') + '</button>' + (free ? '<button class="btn ghost sm" data-ml="unfree">Go back to simple blocks</button>' : '<button class="btn ghost sm" data-ml="simple">' + (E.simple ? 'Hide the simple blocks' : 'Or fill in simple blocks') + '</button>') + '</div></section>';
    if (!free && (E.simple || lock)) left += bl.map(function (b, i) { return blockForm(b, i, bl.length, lock); }).join('');
    if (!lock && !free && E.simple) left += '<section class="card"><b style="font-size:13px;color:#5f656c">Add a block</b><div class="ml-add">' + TYPES.map(function (t) { return '<button class="btn ghost sm" data-ml="addb" data-t="' + t[0] + '">' + ic('plus', 14) + ' ' + t[1] + '</button>'; }).join('') + '</div></section>';
    var right = '<div class="ml-prev"><section class="card"><div class="ml-row" style="margin:0 0 12px"><h3 style="margin:0">Preview</h3><span class="sp"></span>' + seg('e.dev', E.dev, [['d', 'Desktop'], ['m', 'Phone']]) + '</div>' +
      (E.miss && E.miss.length ? '<div class="ml-warn">Not in the catalog, left out of the e-mail: ' + esc(E.miss.join(', ')) + '</div>' : '') + '<iframe id="ml-fr" class="ml-fr' + (E.dev === 'm' ? ' m' : '') + '" title="E-mail preview" sandbox=""></iframe><p class="ml-note">Shown with a sample contact. Links are tracked only in the e-mails that are really sent.</p></section></div>';
    var send = '';
    if (!c.is_template) {
      send = '<section class="card">' + audPanel(E) + '</section><section class="card"><h3 style="margin:0 0 10px">Test</h3><div class="ml-row"><input type="text" data-mf="e.test" value="' + esc(E.test) + '" placeholder="one or more e-mails" style="flex:1;min-width:220px;border:1px solid #c9ced3;border-radius:999px;padding:9px 14px;font:inherit"><button class="btn sm" data-ml="test"' + (E.testing ? ' disabled' : '') + '>Send test</button></div>' + (E.testMsg ? '<p class="ml-note">' + esc(E.testMsg) + '</p>' : '') + '</section>';
      if (!lock && !E.canSend) send += '<section class="card"><h3 style="margin:0 0 10px">Send</h3><p class="ml-note" style="margin:0">Only a superadmin can send or schedule a campaign. Save it and ask one to review and send.</p></section>';
      if (!lock && E.canSend) send += '<section class="card"><h3 style="margin:0 0 10px">Send</h3><p class="ml-note" style="margin:0 0 10px">From ' + esc(E.from || '') + '. Save first: what goes out is the saved version.</p><div class="ml-row"><input type="datetime-local" data-mf="e.when" value="' + esc(E.when) + '" style="border:1px solid #c9ced3;border-radius:999px;padding:8px 14px;font:inherit"><button class="btn ghost sm" data-ml="sched"' + (E.sending ? ' disabled' : '') + '>Schedule</button><span class="sp"></span><button class="btn acc" data-ml="now"' + (E.sending ? ' disabled' : '') + '>' + (E.sending ? 'Sending' : 'Send now') + '</button></div>' + (E.sendMsg ? '<p class="ml-note">' + esc(E.sendMsg) + '</p>' : '') + '</section>';
    }
    left += (lock ? '' : '<section class="card"><div class="ml-row"><label class="mck" style="margin:0"><input type="checkbox" class="ck" data-mlchk="tpl"' + (c.is_template ? ' checked' : '') + '> Keep as a template (it is never sent, only copied)</label></div></section>') + send;
    return '<div class="ml-grid"><div>' + left + '</div>' + right + '</div>';
  }

  // ------------------------------------------------------------------ report
  function openRep(id) { var m = M(); m.rep = { id: id, loading: true }; A.draw(); loadRep(); }
  function loadRep(sync) { var m = M(); if (!m.rep) return; A.api('mail-report', null, '&id=' + m.rep.id + (sync ? '&sync=1' : '')).then(function (r) { if (!m.rep) return; if (r._status !== 200) { m.rep = null; A.toast(r.error || 'Could not load the results.'); return; } m.rep = Object.assign({ id: m.rep.id, q: m.rep.q || '' }, r); A.draw(); }); }
  function viewRep() {
    var R = M().rep; if (R.loading) return A.ld();
    var s = R.stats, c = R.campaign, base = s.reached || 0;
    var h = '<div class="ml-row" style="margin:0 0 14px"><button class="btn ghost sm" data-ml="back">← All e-mails</button><b>' + esc(c.name) + '</b><span class="ml-st ' + c.status + '">' + c.status + '</span><span class="sp"></span>' + (c.status === 'sending' ? '<button class="btn sm" data-ml="cont"' + (R.busy ? ' disabled' : '') + '>' + (R.busy ? 'Sending' : 'Keep sending') + '</button><button class="btn ghost sm" data-ml="cancel" data-id="' + c.id + '">Cancel the rest</button>' : '') + '<button class="btn ghost sm" data-ml="rep-refresh">Refresh</button></div>';
    h += '<div class="kpis">' + A.tile('Sent', n0(base), n0(s.total) + ' on the list' + (s.queued ? ', ' + n0(s.queued) + ' still to go' : ''), '', 'dark') + A.tile('Opened', n0(s.opened), pct(s.opened, base) + ' of sent') + A.tile('Clicked', n0(s.clicked), pct(s.clicked, base) + ' of sent', '', s.clicked ? 'acc' : '') + A.tile('Unsubscribed', n0(s.unsubscribed), pct(s.unsubscribed, base)) + '</div>';
    h += '<div class="kpis">' + A.tile('Delivered', n0(s.delivered), s.delivered ? pct(s.delivered, base) + ' of sent' : 'press Refresh a few minutes after sending') + A.tile('Bounced', n0(s.bounced), 'address does not exist') + A.tile('Spam reports', n0(s.complained), '') + A.tile('Not sent', n0(s.held + s.failed), n0(s.held) + ' held, ' + n0(s.failed) + ' failed') + '</div>';
    h += '<p class="ml-note" style="margin:0 0 14px">Opens are only a hint: Apple Mail opens everything by itself and other programs hide it. Clicks are the number to trust.</p>';
    if (R.sales) { var SL = R.sales, m$ = function (n) { return '$' + n0(n); }; h += '<section class="card flush"><div class="fbar"><h2>Orders after this e-mail</h2></div>' + A.tbl([A.h0('Who'), A.hr('Customers'), A.hr('Orders in 7 days'), A.hr('Revenue in 7 days'), A.hr('Orders in 30 days'), A.hr('Revenue in 30 days')], [['Customers who clicked', SL.clickers, SL.click7, SL.click30], ['All customers who received', SL.customers, SL.all7, SL.all30]].map(function (x) { return '<tr><td><b>' + x[0] + '</b></td><td class="r">' + n0(x[1]) + '</td><td class="r">' + n0(x[2].orders) + '</td><td class="r">' + m$(x[2].revenue) + '</td><td class="r">' + n0(x[3].orders) + '</td><td class="r">' + m$(x[3].revenue) + '</td></tr>'; })) + '<p class="ml-note" style="padding:0 16px 14px">Invoiced orders in Unleashed since ' + esc(SL.since) + ', from the customers matched by e-mail. It shows what happened after the e-mail, not that the e-mail caused it.</p></section>'; }
    if (R.links.length) h += '<section class="card flush"><div class="fbar"><h2>What was clicked</h2></div>' + A.tbl([A.h0('Link or part'), A.hr('People'), A.hr('Clicks')], R.links.map(function (l) { return '<tr><td>' + (l.code ? '<b class="mono">' + esc(l.code) + '</b>' : esc(l.key.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90))) + '</td><td class="r">' + n0(l.people) + '</td><td class="r">' + n0(l.clicks) + '</td></tr>'; })) + '</section>';
    var q = String(R.q || '').toLowerCase(), rows = R.sends.filter(function (x) { return !q || (x.email + ' ' + (x.name || '') + ' ' + (x.company || '') + ' ' + x.status).toLowerCase().indexOf(q) >= 0; });
    rows.forEach(function (x) { x.op = x.opened_at ? 1 : 0; x.cl = x.click_count || 0; }); S.mlrs = S.mlrs || { k: 'cl', d: -1 }; rows = A.sortRows(rows, 'mlrs');
    h += '<section class="card flush"><div class="fbar"><h2>Recipients <span class="cnt">' + n0(rows.length) + '</span></h2><span class="sp"></span><label class="srch">' + ic('search', 16) + '<input type="search" data-mf="r.q" data-redraw="1" value="' + esc(R.q || '') + '" placeholder="E-mail, company or status"></label></div>' +
      A.tbl([A.th('email', 'Person', 'mlrs'), A.th('company', 'Company', 'mlrs'), A.th('status', 'Status', 'mlrs'), A.th('op', 'Opened', 'mlrs', 1), A.th('cl', 'Clicks', 'mlrs', 1)], rows.slice(0, 300).map(function (x) { return '<tr><td><b>' + esc(x.email) + '</b><small>' + esc(x.name || '') + '</small></td><td>' + esc(x.company || '') + '</td><td><span class="ml-st ' + x.status + '">' + x.status + '</span>' + (x.unsubscribed_at ? ' <span class="ml-st cancelled">unsubscribed</span>' : '') + (x.error && x.status !== 'sent' ? '<small>' + esc(x.error) + '</small>' : '') + '</td><td class="r">' + (x.opened_at ? 'Yes' : '-') + '</td><td class="r">' + (x.click_count || '-') + '</td></tr>'; })) +
      (rows.length > 300 ? '<p class="ml-note" style="padding:0 16px 14px">First 300 of ' + n0(rows.length) + '. Use the search to find one person.</p>' : '') + '</section>';
    return h;
  }

  function viewTx() { var T = M().tx, t = T.t;
    var left = '<section class="card"><div class="ml-row" style="margin:0 0 14px"><button class="btn ghost sm" data-ml="back">← All e-mails</button><b>' + esc(t.name) + '</b><span class="sp"></span>' + (t.saved ? '<button class="btn ghost sm" data-ml="tx-reset">Restore the built-in text</button>' : '') + '<button class="btn sm" data-ml="tx-save"' + (T.saving ? ' disabled' : '') + '>Save</button></div>' +
      f('Subject', 'x.subject', T.f.subject, { max: 200, ph: t.subject, note: 'Empty keeps: ' + esc(t.subject) + (/\{\{/.test(t.subject) ? '. Keep the {{fields}}: they are filled in by the system.' : '') }) + f('Title inside the e-mail', 'x.title', T.f.title, { max: 120, ph: t.title }) +
      f('Note on top of the e-mail (optional)', 'x.note', T.f.note, { area: 1, rows: 4, ph: 'For example: our warehouse is closed on Thursday for Thanksgiving.' }) + f('Button text', 'x.cta_label', T.f.cta_label, { max: 60, ph: 'Keeps the built-in button text' }) + '</section>';
    return '<div class="ml-grid"><div>' + left + '</div><div class="ml-prev"><section class="card"><h3 style="margin:0 0 4px">Preview</h3><p class="ml-note" style="margin:0 0 12px">Subject: ' + esc(T.subject || '') + '</p><iframe id="ml-fr" class="ml-fr" title="E-mail preview" sandbox=""></iframe></section></div></div>'; }
  function txPrev(wait) { clearTimeout(pt); pt = setTimeout(function () { var T = M().tx; if (!T) return; A.api('mail-tx-preview', Object.assign({ key: T.t.key }, T.f)).then(function (r) { var T2 = M().tx; if (!T2 || r._status !== 200) return; T2.html = r.html; var ch = T2.subject !== r.subject; T2.subject = r.subject; setFrame(); if (ch) A.draw(); }); }, wait == null ? 600 : wait); }
  function view() { var m = M(); var h = m.lay ? viewLay() : m.tx ? viewTx() : m.rep ? viewRep() : m.ed ? viewEd() : viewList(); setTimeout(setFrame, 0); return h; }

  // ------------------------------------------------------------------ events
  function setPath(path, v) { var m = M(), E = m.ed, k = path.split('.');
    if (k[0] === 'c') { E.c[k[1]] = v; E.dirty = true; return 1; } if (k[0] === 'a') { E.c.audience[k[1]] = v; E.aud = null; E.dirty = true; return 2; }
    if (k[0] === 'x') { m.tx.f[k[1]] = v; return 3; }
    if (k[0] === 'y') { if (k[1] === 'dev') { m.lay.dev = v; return 0; } var o = m.lay.L; for (var i = 1; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = v; return 4; }
    if (k[0] === 'e') { E[k[1]] = v; return 0; } if (k[0] === 'r') { m.rep[k[1]] = v; return 0; }
    if (k[0] === 'b') { var b = E.c.content.blocks[+k[1]]; if (b) { b[k[2]] = k[2] === 'h' ? parseInt(v, 10) || 20 : v; E.dirty = true; } return 1; } return 0; }
  function keep(sel) { A.draw(); var n = app.querySelector(sel); if (n) { n.focus(); try { var l = n.value.length; n.setSelectionRange(l, l); } catch (x) {} } }
  app.addEventListener('input', function (e) { var d = e.target.dataset || {}; if (S.tab !== 'emails') return;
    if (d.mlfind != null) { M().ed.find[d.mlfind] = e.target.value; return keep('[data-mlfind="' + d.mlfind + '"]'); }
    if (!d.mf) return; var r = setPath(d.mf, e.target.value); if (d.redraw) return keep('[data-mf="' + d.mf + '"]'); if (r === 1) preview(); if (r === 3) txPrev(); if (r === 4) layPrev(); });
  app.addEventListener('change', function (e) { var d = e.target.dataset || {}; if (S.tab !== 'emails') return;
    if (d.mlchk === 'tpl') { M().ed.c.is_template = e.target.checked; M().ed.dirty = true; return A.draw(); }
    if (d.mf && e.target.tagName === 'SELECT') { setPath(d.mf, e.target.value); A.draw(); preview(0); } });
  function save(then) { var E = M().ed; if (!E || E.lock) return then && then(); E.saving = true; A.draw();
    A.api('mail-save', payload()).then(function (r) { E.saving = false; if (r._status === 200 && r.campaign) { E.c.id = r.campaign.id; E.c.status = r.campaign.status; E.dirty = false; M().list = null; A.draw(); if (then) then(); else A.toast('Saved.', true); } else { A.draw(); A.toast(r.error || 'Could not save.'); } }); }
  app.addEventListener('click', function (e) {
    if (S.tab !== 'emails') return; var t = e.target.closest && e.target.closest('[data-ml]'); if (!t) return;
    var m = M(), act = t.dataset.ml, E = m.ed, id = t.dataset.id;
    if (t.tagName === 'TR' && e.target.closest('button')) return; // a button inside the row has its own action
    e.preventDefault();
    if (act === 'tab') { m.tab = t.dataset.v; return A.draw(); }
    if (act === 'pick') { m.pick = true; return A.draw(); } if (act === 'pick-x') { m.pick = false; return A.draw(); }
    if (act === 'pg') { m.pg = t.dataset.v; return A.draw(); }
    if (act === 'lay') return openLay();
    if (act === 'lay-save') { m.lay.saving = true; A.draw(); return A.api('mail-layout-save', { layout: m.lay.L }).then(function (r) { if (r._status === 200) { m.lay = null; m.tp = null; A.toast('Saved. Every e-mail uses it from now on.', true); A.draw(); } else { m.lay.saving = false; A.draw(); A.toast(r.error || 'Could not save.'); } }); }
    if (act === 'new') { if (!SX) return; var s = SX.STARTERS[+t.dataset.i]; cover(); return openEd(null, { name: s[0] === 'Blank' ? 'New e-mail' : s[0], subject: s[3], html: s[5](), design: true }); }
    if (act === 'from' || act === 'copy') return A.api('mail-copy', { id: id }).then(function (r) { if (r._status === 200) { m.list = null; openEd(r.campaign.id); } else A.toast(r.error || 'Could not copy.'); });
    if (act === 'open') return openEd(id);
    if (act === 'tx') { var tt = (m.list.templates || []).filter(function (x) { return x.key === id; })[0]; if (!tt) return; var sv = tt.saved || {}; m.tx = { t: tt, f: { subject: sv.subject || '', title: sv.title || '', note: sv.note || '', cta_label: sv.cta_label || '' }, html: '', subject: '' }; A.draw(); return txPrev(0); }
    if (act === 'tx-save' || act === 'tx-reset') { if (act === 'tx-reset' && !confirm('Go back to the built-in text of this e-mail?')) return; m.tx.saving = true; A.draw(); return A.api('mail-tx-save', Object.assign({ key: m.tx.t.key, reset: act === 'tx-reset' }, m.tx.f)).then(function (r) { if (r._status === 200) { m.tx = null; m.list = null; A.toast('Saved. The next e-mails of this kind use it.', true); load(); } else { m.tx.saving = false; A.toast(r.error || 'Could not save.'); } }); }
    if (act === 'design') return design();
    if (act === 'simple') { E.simple = !E.simple; return A.draw(); }
    if (act === 'unfree') { if (!confirm('Go back to simple blocks? The design made in the designer is discarded.')) return; E.c.content.mode = undefined; E.c.content.html = undefined; E.c.content.project = undefined; E.simple = true; E.dirty = true; A.draw(); return preview(0); }
    if (act === 'rep') return openRep(id);
    if (act === 'arch') { if (!confirm('Archive this e-mail? It leaves the lists; the results are kept.')) return; return A.api('mail-archive', { id: id }).then(function (r) { if (r._status === 200) load(); else A.toast(r.error || 'Could not archive.'); }); }
    if (act === 'cancel') { if (!confirm('Cancel this sending? People who already received it are not affected.')) return; return A.api('mail-cancel', { id: id }).then(function (r) { if (r._status === 200) { A.toast('Cancelled.', true); if (m.rep) loadRep(); load(); } else A.toast(r.error || 'Could not cancel.'); }); }
    if (act === 'back') { if (E && E.dirty && !E.lock && !confirm('Leave without saving the changes?')) return; m.ed = null; m.rep = null; m.tx = null; m.lay = null; if (!m.list) load(); return A.draw(); }
    if (act === 'rep-refresh') { m.rep.busy2 = true; A.toast('Checking the delivery of the last e-mails…', true); return loadRep(true); }
    if (act === 'cont') { m.rep.busy = true; A.draw(); return A.api('mail-continue', { id: m.rep.id }).then(function () { loadRep(); }); }
    if (act === 'set' && m.lay) { setPath(t.dataset.p, t.dataset.v); A.draw(); return layPrev(0); }
    if (!E) return;
    if (act === 'set') { setPath(t.dataset.p, t.dataset.v); A.draw(); return preview(0); }
    var bl = E.c.content.blocks, i = +t.dataset.i;

    if (act === 'addb') { var nb = NEWB[t.dataset.t](); if (nb.type === 'products') nb._txt = ''; bl.push(nb); E.dirty = true; A.draw(); return preview(0); }
    if (act === 'del') { bl.splice(i, 1); E.dirty = true; A.draw(); return preview(0); }
    if (act === 'up' && i > 0) { bl.splice(i - 1, 0, bl.splice(i, 1)[0]); E.dirty = true; A.draw(); return preview(0); }
    if (act === 'down' && i < bl.length - 1) { bl.splice(i + 1, 0, bl.splice(i, 1)[0]); E.dirty = true; A.draw(); return preview(0); }
    if (act === 'addp') { var b = bl[i], cur = String(b._txt || '').split(/[\s,;]+/).filter(Boolean); if (cur.indexOf(t.dataset.c) < 0) cur.push(t.dataset.c); b._txt = cur.join('\n'); E.find[i] = ''; E.dirty = true; A.draw(); return preview(0); }
    if (act === 'aud') { var a = E.c.audience, k = t.dataset.k, v = t.dataset.v, L = a[k] = a[k] || [], p = L.indexOf(v); if (p >= 0) L.splice(p, 1); else L.push(v); E.aud = null; E.dirty = true; return A.draw(); }
    if (act === 'audc') { E.c.audience.customers = !E.c.audience.customers; E.aud = null; E.dirty = true; return A.draw(); }
    if (act === 'count') { E.counting = true; A.draw(); return A.api('mail-audience', { audience: E.c.audience }).then(function (r) { E.counting = false; if (r._status === 200) E.aud = r; else A.toast(r.error || 'Could not count.'); A.draw(); }); }
    if (act === 'save') return save();
    if (act === 'test') { E.testing = true; E.testMsg = ''; A.draw(); return A.api('mail-test', Object.assign(payload(), { emails: E.test })).then(function (r) { E.testing = false; E.testMsg = r.error ? r.error : 'Test sent to ' + r.sent + (r.sent === 1 ? ' address' : ' addresses') + (r.blocked && r.blocked.length ? '. Not sent (customer e-mail is off): ' + r.blocked.join(', ') : '') + '.'; A.draw(); }); }
    if (act === 'now' || act === 'sched') {
      var when = act === 'sched' ? E.when : ''; if (act === 'sched' && !when) { E.sendMsg = 'Pick the date and time first.'; return A.draw(); }
      save(function () { A.api('mail-audience', { audience: E.c.audience }).then(function (a2) {
        var n = a2 && a2.info ? a2.info.count : 0; if (!n) { E.aud = a2 && a2.info ? a2 : null; E.sendMsg = 'Nobody would receive it. Check the lists and the consent rule.'; return A.draw(); }
        if (!confirm((when ? 'Schedule "' : 'Send "') + E.c.name + '" to ' + n + (n === 1 ? ' person' : ' people') + (when ? ' on ' + new Date(when).toLocaleString() : ' now') + '?')) return;
        E.sending = true; E.sendMsg = ''; A.draw();
        A.api('mail-send', { id: E.c.id, when: when ? new Date(when).toISOString() : null }).then(function (r) { E.sending = false; if (r._status !== 200) { E.sendMsg = r.error || 'Could not send.'; return A.draw(); } m.list = null; var cid = E.c.id; m.ed = null; if (when) { m.tab = 'scheduled'; A.toast('Scheduled for ' + new Date(when).toLocaleString() + '.', true); load(); } else { A.toast(r.done ? 'Sent to ' + r.sent + '.' + (r.held ? ' ' + r.held + ' held.' : '') : 'Sending started.', true); openRep(cid); } }); }); });
    }
  });

  window.MXMail = { view: view, load: function () { var m = M(); m.ed = null; m.rep = null; m.tx = null; m.lay = null; m.pick = false; load(); } };
})();
