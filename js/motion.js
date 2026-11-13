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
