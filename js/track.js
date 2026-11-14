/* Analytics events for GTM / GA4. No personal data is sent: no names, emails or phone numbers typed by visitors. */
(function () {
  var dl = window.dataLayer = window.dataLayer || [];
  function push(ev, p) { try { var o = { event: ev }; for (var k in p) o[k] = p[k]; dl.push(o); } catch (e) {} }
  window.mxTrack = push;
  function where(el) { return el.closest('footer') ? 'footer' : el.closest('header,nav,.mnav-panel') ? 'header' : el.closest('.qb,.qp') ? 'quote_widget' : 'body'; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a,button,summary'); if (!a) return;
    var href = a.getAttribute('href') || '', txt = (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (a.hasAttribute('data-chat')) return push('contact_click', { method: 'chat', link_location: where(a) });
    if (/^tel:/.test(href)) return push('contact_click', { method: 'phone', link_location: where(a) });
    if (/wa\.me|whatsapp/i.test(href)) return push('contact_click', { method: 'whatsapp', link_location: where(a), whatsapp_line: /17867164857/.test(href) ? 'latam' : 'us' });
    if (/^mailto:/.test(href)) return push('contact_click', { method: 'email', link_location: where(a) });
    if (a.hasAttribute('hreflang') && /English|Español|Português/.test(txt)) return push('language_switch', { language_to: a.getAttribute('hreflang') });
    if (/^\/(es\/|pt\/)?quote(\?|$)/.test(href)) return push('cta_click', { cta: 'quote', cta_text: txt, link_location: where(a), search_term: (href.split('q=')[1] || '').replace(/\+/g, ' ') || undefined });
    if (/^\/portal|store\.unleashedsoftware/.test(href)) return push('cta_click', { cta: 'b2b_portal', cta_text: txt, link_location: where(a) });
    if (/^\/(es\/|pt\/)?parts(\/|$)/.test(href)) return push('cta_click', { cta: 'parts_catalog', cta_text: txt, link_location: where(a) });
    if (/^#account|account/.test(href) && a.closest('section')) return push('cta_click', { cta: 'account', cta_text: txt, link_location: where(a) });
    if (a.tagName === 'SUMMARY' && a.closest('.fq-i') && !a.parentNode.open) return push('faq_open', { faq_question: txt });
  }, true);
})();
