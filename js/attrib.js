// First-party lead attribution: remembers the first and the latest visit source (UTM, click ids, referrer, landing page)
// in this browser and hands it to the quote and access forms through window.mzAttr(). No cookies, nothing leaves the browser until a form is sent.
(function () {
  var K = 'mz_attr';
  function read() { try { return JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { return null; } }
  try {
    var sp = new URLSearchParams(location.search), cur = {}, has = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid', 'ttclid'].forEach(function (k) { var v = sp.get(k); if (v) { cur[k.replace('utm_', '')] = v.slice(0, 120); has = true; } });
    var ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
    if (ref === location.hostname.replace(/^www\./, '')) ref = '';
    var t = Object.assign({}, cur, { ref: ref, landing: (location.pathname + (has ? '' : '')).slice(0, 160), t: Date.now() });
    var st = read() || {};
    if (!st.first) st.first = t;
    if (has || ref || !st.last) st.last = t;
    localStorage.setItem(K, JSON.stringify(st));
  } catch (e) {}
  window.mzAttr = function () { return read(); };
})();
