/* Gated downloads: links with data-gate="<file>" open a short form (e-mail required), the contact goes to
   HubSpot through /api/download, then the file downloads. If the API fails, the file still downloads. */
(function () {
  var T0 = Date.now(), box = null;
  var L = { ey: 'Free download', h: 'Get the Robiel Electronic Line catalog', p: '294 pages, English and Spanish. Tell us where to send updates and new kits.',
    em: 'Work e-mail', ph: 'you@yourshop.com', nm: 'Name', nmph: 'Full name (optional)', co: 'Company', coph: 'Shop or company (optional)', go: 'Download the catalog',
    note: 'We only use your e-mail for Maxzz Diesel updates. No spam.', bad: 'Enter a valid e-mail.', wait: 'Preparing…', x: 'Close' };
  function el(h) { var d = document.createElement('div'); d.innerHTML = h.trim(); return d.firstChild; }
  function close() { if (!box) return; box.classList.remove('gt-on'); var b = box; box = null; setTimeout(function () { b.remove(); }, 250); document.documentElement.style.overflow = ''; }
  function get(url) { var a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
  function open(link) {
    var file = link.getAttribute('data-gate'), url = link.getAttribute('href');
    box = el('<div class="gt" role="dialog" aria-modal="true" aria-labelledby="gt-h"><div class="gt-bd"></div><form class="gt-card" novalidate>' +
      '<button type="button" class="gt-x" aria-label="' + L.x + '">×</button>' +
      '<span class="gt-ey">' + L.ey + '</span><h3 id="gt-h">' + L.h + '</h3><p>' + L.p + '</p>' +
      '<label class="gt-f">' + L.em + ' *<span class="gt-iw"><svg class="gt-ii" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>' +
      '<input class="gt-in" name="email" type="email" autocomplete="email" placeholder="' + L.ph + '" required></span><span class="gt-fe"></span></label>' +
      '<label class="gt-f">' + L.nm + '<span class="gt-iw"><svg class="gt-ii" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>' +
      '<input class="gt-in" name="name" type="text" autocomplete="name" placeholder="' + L.nmph + '"></span></label>' +
      '<label class="gt-f">' + L.co + '<span class="gt-iw"><svg class="gt-ii" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3M3 21h18"/></svg>' +
      '<input class="gt-in" name="company" type="text" autocomplete="organization" placeholder="' + L.coph + '"></span></label>' +
      '<input name="hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">' +
      '<button type="submit" class="gt-go">' + L.go + '</button><small>' + L.note + '</small></form></div>');
    document.body.appendChild(box); document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () { box.classList.add('gt-on'); box.querySelector('input[name=email]').focus(); });
    box.querySelector('.gt-bd').onclick = close; box.querySelector('.gt-x').onclick = close;
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    var f = box.querySelector('form');
    f.onsubmit = function (e) {
      e.preventDefault();
      var em = f.email.value.trim(), err = f.querySelector('.gt-fe'), btn = f.querySelector('.gt-go');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { err.textContent = L.bad; f.email.classList.add('bad'); f.email.focus(); return; }
      f.email.classList.remove('bad');
      btn.disabled = true; btn.textContent = L.wait; err.textContent = '';
      var done = function (u) {
        try { (window.dataLayer = window.dataLayer || []).push({ event: 'generate_lead', form: 'catalog_download', source: file }); } catch (x) {}
        get(u || url); close();
      };
      fetch('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: file, email: em, name: f.name.value, company: f.company.value, hp: f.hp.value, t: Date.now() - T0, lang: document.documentElement.lang }) })
        .then(function (r) { return r.json(); }).then(function (j) { done(j && j.url); }).catch(function () { done(); });
    };
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-gate]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); open(a);
  });
  var css = '.gt{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"BDO Grotesk","Helvetica Neue",Arial,sans-serif}' +
    '.gt-bd{position:absolute;inset:0;background:rgba(14,15,17,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .25s}' +
    '.gt-card{position:relative;width:100%;max-width:420px;background:#fff;border-radius:26px;padding:30px 28px 22px;box-sizing:border-box;box-shadow:0 30px 70px rgba(14,15,17,.35);opacity:0;transform:translateY(16px) scale(.98);transition:opacity .3s,transform .4s cubic-bezier(.2,.8,.2,1)}' +
    '.gt-on .gt-bd{opacity:1}.gt-on .gt-card{opacity:1;transform:none}' +
    '.gt-x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;border:0;background:#eef0f2;color:#1d2126;font-size:22px;line-height:1;cursor:pointer}' +
    '.gt-ey{display:inline-block;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#d32a37;border:1px solid #f0c5c9;border-radius:50px;padding:5px 10px}' +
    '.gt h3{margin:14px 0 6px;font-size:23px;line-height:1.15;letter-spacing:-.01em;color:#1d2126}.gt p{margin:0 0 16px;font-size:14px;line-height:1.5;color:#5a5a60}' +
    '.gt-f{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:13px;color:#5f656c}' +
    '.gt-iw{position:relative;display:block}.gt-ii{position:absolute;left:14px;top:15px;color:#9aa0a6;pointer-events:none;transition:color .2s}.gt-iw:focus-within .gt-ii{color:#1d2126}' +
    '.gt-in{width:100%;box-sizing:border-box;height:48px;border:1px solid #dfe2e6;border-radius:7px;padding:0 14px 0 42px;font:inherit;font-size:16px;color:#1d2126;background:#fff;outline:0;transition:border-color .2s,box-shadow .2s}' +
    '.gt-in::placeholder{color:#a9aeb4}.gt-in:focus{border-color:#1d2126;box-shadow:0 0 0 3px rgba(29,33,38,.08)}.gt-in.bad{border-color:#d32a37;background:#fff8f8}' +
    '.gt-fe{color:#b42318;font-size:12px}.gt-fe:empty{display:none}' +
    '.gt-go{margin-top:6px;width:100%;height:54px;border:0;border-radius:50px;background:#d32a37;color:#fff;font:inherit;font-size:16px;font-weight:500;cursor:pointer;transition:background-color .2s}.gt-go:hover{background:#b71f2b}.gt-go:disabled{opacity:.7;cursor:default}' +
    '.gt small{display:block;margin-top:12px;font-size:12px;color:#8a9099;text-align:center}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
