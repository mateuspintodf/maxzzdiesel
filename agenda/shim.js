// Stand-in for the claude.ai artifact runtime on the Maxzz Vercel site.
// Implements the small part of window.claude.use('db' | 'user') the approval page needs,
// backed by /api/agenda (Vercel Blob). Polls every 15s for changes from other people.
(function () {
  var KEY = 'maxzz-agenda-name';
  function getName() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setName(n) { try { localStorage.setItem(KEY, n); } catch (e) {} }
  function askName() {
    var n = getName();
    if (n) return n;
    n = (window.prompt('Seu nome, para registrar quem aprovou:') || '').trim().slice(0, 40);
    if (n) setName(n);
    return n || 'Equipe';
  }
  var listeners = {}; // collection -> [{cb, err}]
  var cache = {};     // collection -> json string
  function snap(docs) {
    return { docs: Object.keys(docs).map(function (id) { var v = docs[id]; return { id: id, exists: true, data: function () { return v; } }; }) };
  }
  function load(c, force) {
    return fetch('/api/agenda?c=' + encodeURIComponent(c), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw { code: 'unavailable' }; return r.json(); })
      .then(function (j) {
        var s = JSON.stringify(j.docs || {});
        if (!force && cache[c] === s) return;
        cache[c] = s;
        (listeners[c] || []).forEach(function (l) { try { l.cb(snap(j.docs || {})); } catch (e) { console.error(e); } });
      })
      .catch(function (e) { (listeners[c] || []).forEach(function (l) { if (l.err) l.err(e); }); });
  }
  function write(c, id, op, data) {
    if (c === 'aprovacoes' || c === 'stories') { data = Object.assign({}, data, { por: 'n:' + askName() }); }
    return fetch('/api/agenda', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: c, id: id, op: op, data: data })
    }).then(function (r) { if (!r.ok) throw { code: 'unavailable' }; return load(c, true); });
  }
  var db = {
    collection: function (c) {
      return {
        onSnapshot: function (cb, err) { (listeners[c] = listeners[c] || []).push({ cb: cb, err: err }); load(c, true); return function () {}; },
        doc: function (id) {
          return {
            set: function (o) { return write(c, id, 'set', o); },
            update: function (o) { return write(c, id, 'update', o); }
          };
        }
      };
    }
  };
  setInterval(function () { if (document.visibilityState === 'visible') Object.keys(listeners).forEach(function (c) { load(c, false); }); }, 15000);
  var user = {
    id: function () { var n = getName(); return Promise.resolve(n ? 'n:' + n : ''); },
    can: function () { return Promise.resolve(true); },
    profiles: function (ids) {
      var o = {}; (ids || []).forEach(function (i) { o[i] = { name: String(i).indexOf('n:') === 0 ? i.slice(2) : 'alguém da equipe' }; });
      return Promise.resolve(o);
    }
  };
  window.claude = { use: function (k) { return k === 'db' ? Promise.resolve(db) : k === 'user' ? Promise.resolve(user) : Promise.reject(new Error('n/a')); } };
})();
