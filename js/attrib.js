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
    if ((cur.campaign || cur.gclid || cur.fbclid || cur.msclkid || cur.ttclid) && !sessionStorage.getItem('mx-cc')) { // campaign landing for the marketing trail
      sessionStorage.setItem('mx-cc', '1'); var vid = localStorage.getItem('mx-vid'); if (!vid) { vid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('mx-vid', vid); }
      var ev = JSON.stringify({ visitor: vid, referrer: ref, events: [{ type: 'campaign_click', path: location.pathname.slice(0, 120), props: { campaign: cur.campaign || '', source: cur.source || '', medium: cur.medium || '' } }] });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([ev], { type: 'text/plain' }));
    }
  } catch (e) {}
  window.mzAttr = function () { return read(); };
})();
