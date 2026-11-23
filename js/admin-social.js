/* Marketing > Social media: the pieces of the publishing agenda, to approve, ask for changes and edit.
   Lives beside admin.html and uses its helpers through window.MXA (state, api, draw, small HTML helpers). */
(function () {
  var A = window.MXA; if (!A) return;
  var S = A.S, esc = A.esc, n0 = A.n0, app = document.getElementById('app');
  var NET = { ig: 'Instagram', fb: 'Facebook', li: 'LinkedIn' }, ST = { aguardando: ['Waiting for approval', 'wait'], aprovado: ['Approved', 'ok'], ajuste: ['Change requested', 'adj'] };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function M() { if (!S.soc) S.soc = { list: null, open: null, net: 'ig', f: 'todo', mode: null, note: '', ed: null, busy: false }; return S.soc; }
  var css = document.createElement('style');
  css.textContent = '.so-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;padding:16px}.so-c{display:flex;flex-direction:column;background:#fff;border:1px solid #e3e6ea;border-radius:16px;overflow:hidden;cursor:pointer;text-align:left;padding:0;font:inherit;color:inherit;transition:box-shadow .2s,transform .2s}.so-c:hover{box-shadow:0 10px 26px rgba(29,33,38,.12);transform:translateY(-2px)}' +
    '.so-ph{position:relative;aspect-ratio:4/5;background:#eef0f2}.so-ph img{display:block;width:100%;height:100%;object-fit:cover}.so-n{position:absolute;right:8px;top:8px;background:rgba(29,33,38,.78);color:#fff;border-radius:999px;font-size:11px;font-weight:600;padding:2px 8px}' +
    '.so-b{padding:10px 12px 12px;display:flex;flex-direction:column;gap:5px}.so-d{font-size:12px;color:#6b7178}.so-t{font-weight:600;font-size:14px;line-height:1.3}' +
    '.so-st{display:inline-block;align-self:flex-start;font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:#fff4e5;color:#9a4b00}.so-st.ok{background:#eaf6ee;color:#136c33}.so-st.adj{background:#fdecee;color:#b71f2b}.so-st.q{background:#e8e8f6;color:#1e1e87;margin-left:6px}' +
    '.so-v{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;align-items:start}@media(max-width:980px){.so-v{grid-template-columns:1fr}}' +
    '.so-sl{display:flex;gap:10px;overflow-x:auto;padding:16px;scroll-snap-type:x mandatory}.so-fg{flex:none;width:min(320px,70vw);margin:0;scroll-snap-align:start}.so-fg img{display:block;width:100%;border-radius:12px;background:#eef0f2}.so-fg figcaption{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:8px 0 0;font-size:12.5px;color:#6b7178}' +
    '.so-cap{white-space:pre-wrap;font-size:14px;line-height:1.55;margin:12px 0 0;padding:14px;border-radius:12px;background:#f4f5f7}.so-ta{width:100%;box-sizing:border-box;border:1px solid #c9ced3;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;line-height:1.5;resize:vertical}' +
    '.so-f{display:flex;flex-direction:column;gap:5px;margin:0 0 12px}.so-f>span{font-size:12.5px;font-weight:600;color:#3e444b}.so-f input{border:1px solid #c9ced3;border-radius:10px;padding:9px 12px;font:inherit}.so-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.so-note{font-size:13px;line-height:1.5;color:#6b7178;margin:8px 0 0}.so-box{margin:12px 0 0;padding:12px 14px;border-radius:12px;background:#fdecee;color:#7a1620;font-size:13.5px;line-height:1.5}.so-cnt{font-size:12px;color:#8a9097;align-self:flex-end}';
  document.head.appendChild(css);

  function load() { A.api('social-list').then(function (r) { if (r._status === 200) { M().list = r; S.tabErr = null; } else { S.tabErr = r.error || 'Could not load the pieces.'; } A.draw(); }); }
  function img(f) { return /^https:\/\//.test(f) ? f : '/api/admin?a=social-img&f=' + encodeURIComponent(f); }
  function isNew(f) { return /^https:\/\//.test(f); }
  function cur(p) { var e = p.ed || {}, c = e.cap || {}; return { title: e.title || p.title, date: e.date || p.date, time: e.time || p.time, cap: { ig: c.ig != null ? c.ig : p.cap.ig, fb: c.fb != null ? c.fb : p.cap.fb, li: c.li != null ? c.li : p.cap.li } }; }
  function stOf(p) { var s = (p.ap && p.ap.status) || 'aguardando'; return ST[s] ? s : 'aguardando'; }
  function when(c) { var d = new Date(c.date + 'T12:00:00'); return WD[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + ' · ' + String(c.time || '').replace('h', ':') + ' ET'; }
  function who(x) { return x && x.por ? String(x.por).replace(/^n:/, '') : ''; }
  function pill(p) { var s = stOf(p); return '<span class="so-st ' + ST[s][1] + '">' + ST[s][0] + '</span>' + (p.queued ? '<span class="so-st q">In the queue</span>' : ''); }

  function viewList() {
    var m = M(), L = m.list; if (!L) return A.ld();
    var P = L.pieces, cnt = { todo: 0, aguardando: 0, aprovado: 0, ajuste: 0 }; P.forEach(function (p) { cnt.todo++; cnt[stOf(p)]++; });
    var today = new Date().toISOString().slice(0, 10), rows = P.filter(function (p) { return m.f === 'todo' || stOf(p) === m.f; }).slice().sort(function (a, b) { return cur(a).date < cur(b).date ? -1 : 1; });
    var next = P.filter(function (p) { return cur(p).date >= today && stOf(p) !== 'aprovado'; }).length;
    var h = '';
    if (!L.storage) h += '<div class="so-box" style="margin:0 0 14px"><b>The approvals could not be read.</b> The pieces are shown, but approving or asking for a change may fail in this environment.</div>';
    h += '<div class="kpis">' + A.tile('Pieces on the agenda', n0(cnt.todo), 'Instagram, Facebook and LinkedIn', '', 'dark') + A.tile('Waiting for approval', n0(cnt.aguardando), n0(next) + ' still to go out and not approved', '', cnt.aguardando ? 'acc' : '') + A.tile('Approved', n0(cnt.aprovado), 'ready for the day and time set') + A.tile('Change requested', n0(cnt.ajuste), 'back with the team') + '</div>';
    h += '<section class="card flush"><div class="fbar"><div class="seg" style="background:var(--soft)">' + [['todo', 'All'], ['aguardando', 'Waiting'], ['aprovado', 'Approved'], ['ajuste', 'Change requested']].map(function (t) { return '<button data-so="f" data-v="' + t[0] + '" class="' + (m.f === t[0] ? 'on' : '') + '">' + t[1] + ' ' + cnt[t[0]] + '</button>'; }).join('') + '</div><span class="sp"></span><button class="btn ghost sm" data-so="reload">Refresh</button></div>';
    h += rows.length ? '<div class="so-g">' + rows.map(function (p) { var c = cur(p); return '<button type="button" class="so-c" data-so="open" data-id="' + esc(p.id) + '"><span class="so-ph">' + (p.imgs[0] ? '<img loading="lazy" src="' + img(p.imgs[0]) + '" alt="">' : '') + (p.imgs.length > 1 ? '<span class="so-n">' + p.imgs.length + ' screens</span>' : '') + '</span><span class="so-b"><span class="so-d">' + esc(when(c)) + ' · ' + esc(p.kind) + (c.date < today ? ' · past date' : '') + '</span><span class="so-t">' + esc(c.title) + '</span><span>' + pill(p) + (p.ed ? '<span class="so-st q">Edited</span>' : '') + '</span></span></button>'; }).join('') + '</div>' : '<p class="so-note" style="padding:16px">No piece in this view.</p>';
    return h + '</section>';
  }

  function viewOne() {
    var m = M(), p = m.list.pieces.filter(function (x) { return x.id === m.open; })[0]; if (!p) { m.open = null; return viewList(); }
    var c = cur(p), s = stOf(p), dis = m.busy ? ' disabled' : '';
    var h = '<div class="so-row" style="margin:0 0 14px"><button class="btn ghost sm" data-so="back">← All pieces</button><b>' + esc(c.title) + '</b>' + pill(p) + '</div><div class="so-v">';
    h += '<section class="card flush"><div class="fbar"><h2>' + esc(p.kind) + ' <span class="cnt">' + p.imgs.length + '</span></h2><span class="sp"></span><span class="so-d">' + esc(when(c)) + ' · ' + esc(p.pilar) + '</span></div><div class="so-sl">' + p.imgs.map(function (f, i) { return '<figure class="so-fg"><img src="' + img(f) + '" alt="Screen ' + (i + 1) + '" loading="' + (i ? 'lazy' : 'eager') + '"><figcaption><span>Screen ' + (i + 1) + (isNew(f) ? ' · <b>new picture</b>' : '') + '</span><span class="so-row" style="gap:6px"><button class="btn ghost sm" data-so="pic" data-i="' + i + '"' + (m.busy ? ' disabled' : '') + '>' + (m.up === i ? 'Sending' : 'Replace picture') + '</button>' + (isNew(f) ? '<button class="btn ghost sm" data-so="pic-back" data-i="' + i + '"' + (m.busy ? ' disabled' : '') + '>Original</button>' : '') + '</span></figcaption></figure>'; }).join('') + '</div>' + (p.note ? '<p class="so-note" style="padding:0 16px 16px"><b>Note from who made it:</b> ' + esc(p.note) + '</p>' : '') + '</section>';
    var right = '<section class="card">';
    if (m.mode === 'edit') { var E = m.ed;
      right += '<h3 style="margin:0 0 12px">Edit the piece</h3><label class="so-f"><span>Title (internal)</span><input type="text" data-sf="title" maxlength="140" value="' + esc(E.title) + '"></label><div class="so-row" style="align-items:flex-start"><label class="so-f" style="flex:1"><span>Day</span><input type="date" data-sf="date" value="' + esc(E.date) + '"></label><label class="so-f" style="flex:1"><span>Time, Miami (ET)</span><input type="time" data-sf="time" value="' + esc(String(E.time).replace('h', ':')) + '"></label></div>' +
        ['ig', 'fb', 'li'].map(function (n) { return '<label class="so-f"><span>Caption for ' + NET[n] + '</span><textarea class="so-ta" rows="7" data-sf="cap.' + n + '" maxlength="' + (n === 'li' ? 3000 : 2200) + '">' + esc(E.cap[n] || '') + '</textarea></label>'; }).join('') +
        '<div class="so-row"><button class="btn acc" data-so="ed-save"' + dis + '>' + (m.busy ? 'Saving' : 'Save the changes') + '</button><button class="btn ghost" data-so="cancel">Cancel</button></div><p class="so-note">Saving sends the piece back to waiting for approval. To change a picture, use Replace picture under each screen.</p>';
    } else {
      right += '<div class="seg" style="background:var(--soft);margin:0 0 4px">' + ['ig', 'fb', 'li'].map(function (n) { return '<button data-so="net" data-v="' + n + '" class="' + (m.net === n ? 'on' : '') + '">' + NET[n] + '</button>'; }).join('') + '</div><div class="so-cap">' + esc(c.cap[m.net] || '') + '</div><span class="so-cnt" style="display:block;text-align:right;margin:4px 0 0">' + n0((c.cap[m.net] || '').length) + ' characters</span>';
      if (p.ed) right += '<p class="so-note">Edited by ' + esc(who(p.ed)) + ' on ' + esc(A.fmtAt(p.ed.em)) + '.</p>';
      if (s === 'ajuste') right += '<div class="so-box"><b>Change requested' + (who(p.ap) ? ' by ' + esc(who(p.ap)) : '') + ':</b><br>' + esc(p.ap.nota || '') + '</div>';
      if (s === 'aprovado') right += '<p class="so-note">Approved' + (who(p.ap) ? ' by ' + esc(who(p.ap)) : '') + (p.ap.em ? ' on ' + esc(A.fmtAt(p.ap.em)) : '') + '.</p>';
      if (m.mode === 'adjust') right += '<label class="so-f" style="margin-top:14px"><span>What should change?</span><textarea class="so-ta" rows="4" data-sf="note" maxlength="2000" placeholder="e.g. Screen 2: swap the photo for the CP4 pump. Caption: mention same-day shipping.">' + esc(m.note) + '</textarea></label><div class="so-row"><button class="btn acc" data-so="adj-send"' + dis + '>' + (m.busy ? 'Sending' : 'Send the request') + '</button><button class="btn ghost" data-so="cancel">Cancel</button></div>';
      else right += '<div class="so-row" style="margin-top:16px">' + (s !== 'aprovado' ? '<button class="btn acc" data-so="approve"' + dis + '>Approve</button>' : '<button class="btn ghost" data-so="reset"' + dis + '>Back to waiting</button>') + '<button class="btn" data-so="adjust"' + dis + '>Ask for a change</button><button class="btn ghost" data-so="edit"' + dis + '>Edit text and date</button></div>';
    }
    return h + right + '</section></div>';
  }
  function view() { var m = M(); if (S.tabErr) return '<section class="card"><p class="so-note" style="margin:0">' + esc(S.tabErr) + '</p></section>'; return m.list && m.open ? viewOne() : viewList(); }

  function send(body, okMsg) { var m = M(); m.busy = true; A.draw(); A.api('social-save', body).then(function (r) { m.busy = false; if (r._status === 200) { m.mode = null; m.note = ''; m.ed = null; A.toast(okMsg, true); load(); } else { A.toast(r.error || 'Could not save.'); A.draw(); } }); }
  app.addEventListener('click', function (e) {
    if (S.tab !== 'social') return; var t = e.target.closest && e.target.closest('[data-so]'); if (!t) return; var m = M(), act = t.dataset.so, p = m.list && m.list.pieces.filter(function (x) { return x.id === m.open; })[0];
    if (act === 'f') { m.f = t.dataset.v; return A.draw(); }
    if (act === 'reload') { m.list = null; A.draw(); return load(); }
    if (act === 'open') { m.open = t.dataset.id; m.mode = null; m.note = ''; window.scrollTo(0, 0); return A.draw(); }
    if (act === 'back') { if (m.mode === 'edit' && !confirm('Leave without saving the changes?')) return; m.open = null; m.mode = null; return A.draw(); }
    if (act === 'net') { m.net = t.dataset.v; return A.draw(); }
    if (act === 'cancel') { m.mode = null; return A.draw(); }
    if (!p) return;
    if (act === 'pic') { var ix = +t.dataset.i, inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
      inp.onchange = function () { var file = inp.files && inp.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { var im = new Image(); im.onerror = function () { A.toast('This file is not a picture.'); };
        im.onload = function () { var k = Math.min(1, 1440 / im.width), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          m.busy = true; m.up = ix; A.draw(); A.api('social-upload', { id: p.id, i: ix, data: cv.toDataURL('image/jpeg', 0.92) }).then(function (r) { m.busy = false; m.up = null; if (r._status === 200) { A.toast('Picture replaced. The piece is waiting for approval again.', true); load(); } else { A.toast(r.error || 'Could not send the picture.'); A.draw(); } }); }; im.src = rd.result; }; rd.readAsDataURL(file); };
      return inp.click(); }
    if (act === 'pic-back') { if (!confirm('Go back to the original picture of this screen?')) return; return send({ id: p.id, op: 'img-restore', i: +t.dataset.i }, 'Original picture is back.'); }
    if (act === 'adjust') { m.mode = 'adjust'; return A.draw(); }
    if (act === 'edit') { var c = cur(p); m.ed = { title: c.title, date: c.date, time: c.time, cap: { ig: c.cap.ig, fb: c.cap.fb, li: c.cap.li } }; m.mode = 'edit'; return A.draw(); }
    if (act === 'approve') return send({ id: p.id, op: 'approve' }, 'Approved.');
    if (act === 'reset') return send({ id: p.id, op: 'reset' }, 'Back to waiting for approval.');
    if (act === 'adj-send') { if (!String(m.note).trim()) return A.toast('Write what should change.'); return send({ id: p.id, op: 'adjust', note: m.note }, 'Request sent.'); }
    if (act === 'ed-save') return send({ id: p.id, op: 'edit', edit: m.ed }, 'Changes saved. The piece is waiting for approval again.');
  });
  app.addEventListener('input', function (e) {
    if (S.tab !== 'social') return; var k = e.target.dataset && e.target.dataset.sf; if (!k) return; var m = M();
    if (k === 'note') { m.note = e.target.value; return; } if (!m.ed) return;
    if (k.indexOf('cap.') === 0) m.ed.cap[k.slice(4)] = e.target.value; else m.ed[k] = e.target.value;
  });
  window.MXSocial = { view: view, load: function () { var m = M(); m.open = null; m.mode = null; load(); } };
})();
