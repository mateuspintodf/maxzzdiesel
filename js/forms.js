// Wholesale account form (footer of every page) → POST /api/account
(function () {
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function mask(el) {
    var raw = el.value, d = raw.replace(/\D/g, '');
    if (raw.trim().charAt(0) === '+') { el.value = '+' + d.slice(0, 15); return; }
    d = d.slice(0, 10);
    el.value = d.length > 6 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : d.length > 3 ? '(' + d.slice(0, 3) + ') ' + d.slice(3) : d;
  }
  function init(form) {
    var inputs = form.querySelectorAll('input'), sel = form.querySelector('select'), btn = form.querySelector('button');
    var name = inputs[0], phone = inputs[1], email = inputs[2];
    var hp = document.createElement('input');
    hp.type = 'text'; hp.name = 'company_site'; hp.tabIndex = -1; hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true'); hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    form.appendChild(hp);
    var msg = document.createElement('p');
    msg.setAttribute('role', 'status');
    msg.style.cssText = 'flex-basis:100%;margin:0;font-size:14px;line-height:21px;color:#fc9a55;display:none';
    form.parentNode.appendChild(msg);
    function say(t, ok) { msg.textContent = t; msg.style.color = ok ? '#ffffff' : '#fc9a55'; msg.style.display = t ? 'block' : 'none'; }
    phone.addEventListener('input', function () { mask(phone); });
    [name, phone, email].forEach(function (el) { el.required = true; el.addEventListener('input', function () { el.style.boxShadow = ''; }); });
    function mark(el, bad) { el.style.boxShadow = bad ? 'inset 0 -2px 0 #fc771d' : ''; return bad; }
    async function submit(ev) {
      if (ev) ev.preventDefault();
      if (btn.disabled) return;
      var bad = [mark(name, !name.value.trim()), mark(phone, phone.value.replace(/\D/g, '').length < 7), mark(email, !EMAIL.test(email.value.trim()))];
      if (bad.some(Boolean)) { say('Please fill in your name, phone and a valid email.'); return; }
      var label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…'; say('');
      try {
        var r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.value, phone: phone.value, email: email.value, type: sel ? sel.value : '', hp: hp.value }) });
        if (!r.ok) throw new Error(r.status);
        form.reset(); btn.textContent = 'Request sent';
        say('Thanks. Our team will contact you within one business day.', true);
        setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 6000);
      } catch (e) {
        btn.textContent = label; btn.disabled = false;
        say('We could not send your request. Please try again or call +1 (954) 586-4158.');
      }
    }
    form.addEventListener('submit', submit);
    btn.addEventListener('click', submit);
  }
  function boot() { document.querySelectorAll('.acct-form').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
