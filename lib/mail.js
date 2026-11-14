// Transactional e-mail for the portal through Resend (RESEND_API_KEY). Without a key, nothing is sent and the
// event is only logged (no links or personal data in the log).
const { esc } = require('./hubspot');
const FROM = () => process.env.PORTAL_MAIL_FROM || 'Maxzz Diesel <portal@maxzzdiesel.com>';

function layout(title, bodyHtml, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f2f3f5;font-family:Helvetica,Arial,sans-serif;color:#1d2126">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="background:#1d2126;padding:22px 28px;color:#fff;font-weight:700;font-size:20px;letter-spacing:-.02em">Maxzz <span style="color:#fc771d">Diesel</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.55;color:#3a4048">${bodyHtml}</div>
${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#d32a37;color:#fff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:50px">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #eef0f2;font-size:12px;color:#8a9097">Maxzz Diesel · 6601 Lyons Road, Ste H-6, Coconut Creek, FL · Diesel specialists for over 30 years.</td></tr>
</table></td></tr></table></body></html>`;
}

async function send(to, subject, title, bodyHtml, cta) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log('mail (not sent, no RESEND_API_KEY):', subject); return { sent: false }; }
  const post = (from) => fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html: layout(title, bodyHtml, cta) })
  });
  let r = await post(FROM());
  // while maxzzdiesel.com is not verified in Resend, its test sender still delivers to the Resend account owner
  if (r.status === 403) r = await post('Maxzz Diesel <onboarding@resend.dev>');
  if (!r.ok) { console.error('mail failed', r.status); return { sent: false }; }
  return { sent: true };
}

module.exports = { send, esc };
