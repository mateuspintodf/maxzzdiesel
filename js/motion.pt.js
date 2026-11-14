/* Motion layer for maxzzdiesel.com (see /assets/motion.css). Works on top of the petite-vue
   templates without changing them: it watches the DOM and adds the transition classes. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ready = false; // ignore the mutations petite-vue makes while mounting

  function replay(el, cls) {
    if (!el || reduce) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add(cls);
  }

  function initTabs(list) {
    if (list.__tPill) return;
    var pill = document.createElement('span');
    pill.className = 't-pill';
    pill.setAttribute('aria-hidden', 'true');
    list.appendChild(pill);
    list.classList.add('t-has-pill');
    list.__tPill = pill;
    var first = true, lastSel = null;
    var place = function (instant) {
      var sel = list.querySelector('[role="tab"][aria-selected="true"]');
      if (!sel) return;
      if (instant || first || reduce) pill.style.transition = 'none';
      pill.style.width = sel.offsetWidth + 'px';
      pill.style.height = sel.offsetHeight + 'px';
      pill.style.transform = 'translate(' + sel.offsetLeft + 'px,' + sel.offsetTop + 'px)';
      pill.style.borderRadius = getComputedStyle(sel).borderRadius;
      if (sel.style.backgroundColor) pill.style.backgroundColor = sel.style.backgroundColor;
      if (instant || first || reduce) { void pill.offsetWidth; pill.style.transition = ''; }
      if (!first && sel !== lastSel) {
        var wrap = list.closest('.l-tabs');
        if (wrap) {
          replay(wrap.querySelector('.l-tabtext'), 't-swap');
          replay(wrap.querySelector('.l-tabmedia'), 't-swap-media');
        }
      }
      lastSel = sel; first = false;
    };
    place(true);
    new MutationObserver(function () { place(false); }).observe(list, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
    window.addEventListener('resize', function () { place(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(true); });
  }

  function onText(muts) {
    if (!ready) return;
    for (var i = 0; i < muts.length; i++) {
      var t = muts[i].target;
      var el = t.nodeType === 1 ? t : t.parentElement;
      if (!el || el.tagName !== 'SPAN') continue;
      var badge = el.closest('.qb-n');
      if (badge) { replay(badge, 't-pop'); continue; }
      if (el.closest('.btn')) replay(el, 't-text-in');
    }
  }

  function start() {
    var lists = document.querySelectorAll('.l-tablist');
    for (var i = 0; i < lists.length; i++) initTabs(lists[i]);
    var app = document.getElementById('app') || document.body;
    new MutationObserver(onText).observe(app, { childList: true, characterData: true, subtree: true });
    setTimeout(function () { ready = true; }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  else setTimeout(start, 0);
})();

// Fold the language bar away after the first bit of scroll
(function () {
  var root = document.documentElement, on = false;
  function check() { var s = window.scrollY > 40; if (s !== on) { on = s; root.classList.toggle('mx-scrolled', s); } }
  window.addEventListener('scroll', check, { passive: true }); check();
})();

/* Scroll reveal fallback: browsers without animation-timeline: view() (older iOS Safari) get an
   IntersectionObserver version of the same reveal, with a small stagger inside lists. */
(function () {
  try { if (window.CSS && CSS.supports && CSS.supports('animation-timeline: view()')) return; } catch (e) {}
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var SEL = '.rv,.l-subs > *,.l-engs > *,.l-brands > *,.l-why > *,.l-stats > *,.l-feat > *,.l-pair > *,.l-steps > *,.l-core > *,.l-checks > *,.l-tl > *,.l-logos > *';
  document.documentElement.classList.add('io');
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('io-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  function scan() {
    document.querySelectorAll(SEL).forEach(function (el) {
      if (el.__io) return; el.__io = 1;
      var p = el.parentNode, i = p && !el.classList.contains('rv') ? Array.prototype.indexOf.call(p.children, el) : 0;
      if (i > 0) el.style.setProperty('--io-d', Math.min(i, 6) * 0.07 + 's');
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) { requestAnimationFrame(function () { el.classList.add('io-in'); }); return; }
      io.observe(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  setTimeout(scan, 600); setTimeout(scan, 2000);
})();

/* Mobile: quote button in the header shows a list icon with the number of parts, and a fixed bottom bar
   with "Pedir cotação" and WhatsApp (LATAM line on the Spanish and Portuguese pages). */
(function () {
  var M = { quote: 'Pedir cotação', wa: 'WhatsApp', list: 'Minha lista de cotação' };
  var lang = (document.documentElement.lang || 'en').slice(0, 2);
  var path = location.pathname;
  if (/\/portal|\/painel|\/agenda/.test(path)) return;
  var onQuote = /\/quote(\.html)?$/.test(path);
  function count() { try { var v = JSON.parse(localStorage.getItem('mx-quote') || '[]'); return Array.isArray(v) ? v.length : 0; } catch (e) { return 0; } }
  var LIST = '<svg class="nav-ic-list" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4V3h6v1"></path><path d="M9 10h6M9 14h6M9 18h3"></path></svg>';
  function setup() {
    var cta = document.querySelector('.nav-cta'), ic = cta && cta.querySelector('.ic');
    if (cta && !cta.getAttribute('aria-label')) { var lbl = cta.textContent.replace(/\s+/g, ' ').trim(); if (lbl) cta.setAttribute('aria-label', lbl); }
    if (ic && !ic.querySelector('.nav-ic-list')) { ic.insertAdjacentHTML('beforeend', LIST + '<b class="nav-cnt" aria-hidden="true"></b>'); }
    if (!onQuote && !document.querySelector('.mbar')) {
      var wa = (lang === 'es' || lang === 'pt') ? 'https://wa.me/17867164857' : 'https://wa.me/19543716996';
      var href = (cta && cta.getAttribute('href')) || '/quote';
      document.body.insertAdjacentHTML('beforeend', '<div class="mbar"><a class="mbar-q" href="' + href + '">' + LIST + '<span>' + M.quote + '</span><b class="mbar-n"></b></a>' +
        '<a class="mbar-wa" href="' + wa + '" target="_blank" rel="noopener" aria-label="' + M.wa + '"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3Z"/></svg><span>' + M.wa + '</span></a></div>');
      document.documentElement.classList.add('has-mbar');
    }
    sync();
  }
  function sync() {
    var n = count();
    document.querySelectorAll('.nav-cnt,.mbar-n').forEach(function (b) { b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.addEventListener('storage', sync); setInterval(sync, 1500);
})();

/* Number badges and toasts pop when their value changes; "add" buttons pop when the quantity changes. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var SEL = '.nav-cnt,.mbar-n,.qb-n,.qx-p2-count,.qx-mbar-l,.qx-toast,.qx-add,.px-cnt,.px-badge';
  function pop(el) { el.classList.remove('m-pop'); void el.offsetWidth; el.classList.add('m-pop'); }
  var last = new WeakMap();
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      var t = m.target.nodeType === 3 ? m.target.parentNode : m.target;
      var el = t && t.closest && t.closest(SEL);
      if (!el) return;
      var v = (el.textContent || '') + '|' + (el.getAttribute('data-n') || '');
      if (last.get(el) === v) return;
      var had = last.has(el); last.set(el, v);
      if (had && el.textContent.trim()) pop(el);
    });
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-n'] });
  document.addEventListener('animationend', function (e) { if (e.animationName === 'm-badge' || e.animationName === 'm-toast') e.target.classList.remove('m-pop'); });
})();
