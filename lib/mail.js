// Transactional e-mail for the portal through Resend (RESEND_API_KEY). Without a key, nothing is sent and the
// event is only logged (no links or personal data in the log).
const { esc } = require('./hubspot');
const FROM = () => process.env.PORTAL_MAIL_FROM || 'Maxzz Diesel <portal@maxzzdiesel.com>';

const SITE = 'https://www.maxzzdiesel.com';
const IMG = SITE + '/assets/email/';
const F = 'Helvetica,Arial,sans-serif';
const first = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30);
const icon = (href, name, alt) => `<a href="${href}" style="display:inline-block;margin:0 8px 0 0;text-decoration:none"><img src="${IMG}${name}.png" width="32" height="32" alt="${alt}" style="display:block;border:0;width:32px;height:32px"></a>`;

// opts: { name } greets the person by first name; { greet: true } greets without a name; { internal: true } is a
// notification for the Maxzz team (no greeting or sign-off). The footer is the same for every e-mail.
function layout(title, bodyHtml, cta, opts) {
  const o = opts || {};
  const hi = o.internal ? '' : (o.name ? `<p style="margin:0 0 14px">Hi ${esc(first(o.name))},</p>` : (o.greet ? '<p style="margin:0 0 14px">Hello,</p>' : ''));
  const bye = o.internal ? '' : '<p style="margin:24px 0 0">Best regards,<br><b style="color:#1d2126">Maxzz Diesel team</b></p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f2f3f5;font-family:${F};color:#1d2126;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#1d2126;padding:24px 28px">
<a href="${SITE}" style="text-decoration:none"><img src="${IMG}logo-negative.png" width="136" height="30" alt="Maxzz Diesel" style="display:block;border:0;width:136px;height:auto"></a>
</td></tr>
<tr><td style="padding:30px 28px 28px;font-family:${F}">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:#1d2126">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#3a4048">${hi}${bodyHtml}</div>
${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0"><tr><td style="background:#d32a37;border-radius:50px"><a href="${esc(cta.url)}" style="display:inline-block;padding:14px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:${F}">${esc(cta.label)}</a></td></tr></table>` : ''}
<div style="font-size:15px;line-height:1.6;color:#3a4048">${bye}</div>
</td></tr>
<tr><td style="background:#f7f8f9;border-top:1px solid #eceef0;padding:24px 28px;font-family:${F};font-size:13px;line-height:1.6;color:#5f6670">
<p style="margin:0 0 10px;color:#1d2126;font-weight:700">Maxzz Diesel <span style="color:#d32a37">·</span> <span style="font-weight:400;color:#5f6670">Diesel is all we do. Since 1992.</span></p>
<p style="margin:0">Phone <a href="tel:+19545864158" style="color:#1d2126;text-decoration:none;white-space:nowrap">+1 (954) 586-4158</a><br>
WhatsApp <a href="https://wa.me/19543716996" style="color:#1d2126;text-decoration:none;white-space:nowrap">+1 (954) 371-6996</a> (US) · <a href="https://wa.me/17862412167" style="color:#1d2126;text-decoration:none;white-space:nowrap">+1 (786) 241-2167</a> (Latin America)<br>
<a href="mailto:sales@maxzzdiesel.com" style="color:#1d2126;text-decoration:none">sales@maxzzdiesel.com</a> · <a href="${SITE}" style="color:#1d2126;text-decoration:none">maxzzdiesel.com</a><br>
<a href="https://maps.google.com/?q=6601+Lyons+Road+Ste+H-6+Coconut+Creek+FL+33073" style="color:#5f6670;text-decoration:none">6601 Lyons Road, Ste H-6, Coconut Creek, FL 33073</a></p>
<p style="margin:16px 0 0">${icon('https://www.linkedin.com/company/maxzzdiesel/', 'linkedin', 'LinkedIn')}${icon('https://www.instagram.com/maxzzdiesel.us/', 'instagram', 'Instagram')}${icon('https://www.facebook.com/maxzzdiesel', 'facebook', 'Facebook')}${icon('https://wa.me/19543716996', 'whatsapp', 'WhatsApp')}</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-family:${F};font-size:11px;line-height:1.5;color:#8a9097;max-width:680px">You received this e-mail because of an action on the Maxzz Diesel website or B2B portal.</p>
</td></tr></table></body></html>`;
}

// Safety switch: e-mail to customers is OFF unless CUSTOMER_MAIL=on is set in Vercel (all environments, since preview and
// production share the same database and customers). While off, only the Maxzz team gets e-mail: @maxzzdiesel.com
// addresses and the ones in PORTAL_ADMINS. Everything else is dropped and only counted in the log.
const customerMailOn = () => String(process.env.CUSTOMER_MAIL || '').toLowerCase() === 'on';
// pilot: CUSTOMER_MAIL=pilot lets through only the addresses listed in CUSTOMER_MAIL_PILOT (comma separated)
const pilotTo = (e) => String(process.env.CUSTOMER_MAIL || '').toLowerCase() === 'pilot' && String(process.env.CUSTOMER_MAIL_PILOT || '').toLowerCase().split(/[,\s;]+/).includes(String(e || '').trim().toLowerCase());
const internalTo = (e) => { e = String(e || '').trim().toLowerCase(); return /@maxzzdiesel\.com$/.test(e) || String(process.env.PORTAL_ADMINS || '').toLowerCase().split(/[,\s]+/).includes(e); };
async function send(to, subject, title, bodyHtml, cta, opts) {
  let list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  // opts.team: the caller already checked the address belongs to the team (admin sign-in links)
  if (!customerMailOn() && !(opts && opts.team)) {
    const kept = list.filter((e) => internalTo(e) || pilotTo(e));
    if (kept.length < list.length) console.log('mail blocked (CUSTOMER_MAIL is off):', list.length - kept.length, 'recipient(s) ·', subject.replace(/\S+@\S+/g, '<email>').slice(0, 80));
    if (!kept.length) return { sent: false, blocked: true };
    list = kept;
  }
  to = list;
  // replies from customers go to the sales inbox, not to the no-reply portal sender
  const replyTo = (opts && opts.replyTo) || (list.some((e) => !internalTo(e)) ? (process.env.PORTAL_REPLY_TO || 'sales@maxzzdiesel.com') : null);
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('mail (not sent, no RESEND_API_KEY):', subject); return { sent: false }; }
  const post = (from) => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ from, to: Array.isArray(to) ? to : [to], subject, html: layout(title, bodyHtml, cta, opts) }, replyTo ? { reply_to: replyTo } : {}))
  });
  let r = await post(FROM());
  // while maxzzdiesel.com is not verified in Resend, its test sender still delivers to the Resend account owner
  // only for team addresses: a customer must never get mail from a resend.dev sender
  if (r.status === 403 && list.every(internalTo)) r = await post('Maxzz Diesel <onboarding@resend.dev>');
  if (!r.ok) { let why = ''; try { const j = await r.json(); why = String(j.name || '') + ' ' + String(j.message || '').replace(/\S+@\S+/g, '<email>').slice(0, 200); } catch (e) {} console.error('mail failed', r.status, why); return { sent: false }; }
  return { sent: true };
}

module.exports = { send, esc, layout, customerMailOn, internalTo, pilotTo };
