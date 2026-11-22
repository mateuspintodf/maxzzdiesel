// Public endpoints of the marketing e-mail, all on signed tokens (no login):
//   GET  /api/e?o=<token>                 open pixel
//   GET  /api/e?c=<token>&u=<url>&s=<sig> click: counts it and sends the person to the page
//   GET  /api/e?u=<token>                 unsubscribe page;  POST the same address unsubscribes (also the one-click header)
//   POST /api/e?hook=resend               delivery, bounce and complaint events from Resend (needs RESEND_WEBHOOK_SECRET)
const crypto = require('crypto');
const db = require('../lib/db');
const E = require('../lib/email-engine');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Maxzz Diesel</title></head>
<body style="margin:0;background:#f2f3f5;font-family:Helvetica,Arial,sans-serif;color:#1d2126"><div style="max-width:520px;margin:0 auto;padding:48px 16px"><div style="background:#fff;border-radius:20px;overflow:hidden">
<div style="background:#1d2126;padding:22px 28px"><img src="https://www.maxzzdiesel.com/assets/email/logo-negative.png" width="136" alt="Maxzz Diesel" style="display:block"></div>
<div style="padding:28px"><h1 style="margin:0 0 12px;font-size:22px">${esc(title)}</h1><div style="font-size:15px;line-height:1.6;color:#3a4048">${body}</div></div></div></div></body></html>`;
const mask = (e) => String(e || '').replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2');
const html = (res, s, h) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(s).send(h); };

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return await new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 2e5) req.destroy(); }); req.on('end', () => ok(d)); req.on('error', () => ok('')); });
}
// Resend signs webhooks the Svix way: HMAC-SHA256 of "id.timestamp.body" with the base64 part of the secret
function hookOk(req, body) {
  const sec = String(process.env.RESEND_WEBHOOK_SECRET || ''); if (!sec) return false;
  const id = req.headers['svix-id'], ts = req.headers['svix-timestamp'], sig = String(req.headers['svix-signature'] || '');
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const want = crypto.createHmac('sha256', Buffer.from(sec.replace(/^whsec_/, ''), 'base64')).update(id + '.' + ts + '.' + body).digest('base64');
  return sig.split(' ').some((p) => { const v = p.split(',')[1] || ''; const a = Buffer.from(v), b = Buffer.from(want); return a.length === b.length && crypto.timingSafeEqual(a, b); });
}

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (q.hook === 'resend') {
      if (req.method !== 'POST') return res.status(405).end();
      const body = await rawBody(req); if (!hookOk(req, body)) return res.status(401).json({ error: 'signature' });
      let ev; try { ev = JSON.parse(body); } catch (e) { return res.status(400).end(); }
      const pid = ev && ev.data && ev.data.email_id, type = String((ev && ev.type) || ''), now = new Date().toISOString();
      if (pid && /^[A-Za-z0-9-]{8,80}$/.test(pid)) {
        const s = (await db.select('email_sends', 'select=id,email,campaign_id&provider_id=eq.' + encodeURIComponent(pid) + '&limit=1'))[0];
        if (s) {
          if (type === 'email.delivered') await db.update('email_sends', 'id=eq.' + s.id, { delivered_at: now });
          if (type === 'email.bounced') { await db.update('email_sends', 'id=eq.' + s.id, { status: 'bounced', error: 'Bounced' }); await db.insert('email_suppressions', [{ email: s.email, reason: 'bounced', campaign_id: s.campaign_id }], { onConflict: 'email', ignoreDuplicates: true }); }
          if (type === 'email.complained') { await db.update('email_sends', 'id=eq.' + s.id, { status: 'complained', error: 'Marked as spam' }); await db.insert('email_suppressions', [{ email: s.email, reason: 'complained', campaign_id: s.campaign_id }], { onConflict: 'email' }); }
        }
      }
      return res.status(200).json({ ok: true });
    }
    if (q.o) {
      const id = E.untok(q.o);
      if (id) { const s = (await db.select('email_sends', 'select=id,opened_at,open_count&id=eq.' + id + '&limit=1'))[0]; if (s) await db.update('email_sends', 'id=eq.' + id, { opened_at: s.opened_at || new Date().toISOString(), open_count: (s.open_count || 0) + 1 }); }
      res.setHeader('Content-Type', 'image/gif'); res.setHeader('Cache-Control', 'no-store, private'); return res.status(200).send(GIF);
    }
    if (q.c) {
      const id = E.untok(q.c), url = E.unb64(q.u);
      // the address is only followed when it carries our signature for this send: no open redirect
      const sig = String(q.s || ''), want = id ? E.linkSig(id, url) : '';
      if (!id || !/^https?:\/\//i.test(url) || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.redirect(302, 'https://www.maxzzdiesel.com/');
      const s = (await db.select('email_sends', 'select=id,campaign_id,clicked_at,click_count,opened_at&id=eq.' + id + '&limit=1'))[0];
      if (s) { const now = new Date().toISOString();
        await db.update('email_sends', 'id=eq.' + id, { clicked_at: s.clicked_at || now, click_count: (s.click_count || 0) + 1, opened_at: s.opened_at || now }).catch(() => {});
        await db.insert('email_clicks', [{ send_id: id, campaign_id: s.campaign_id, url: url.slice(0, 600), code: q.p ? String(q.p).slice(0, 60) : null }]).catch(() => {}); }
      res.setHeader('Cache-Control', 'no-store'); return res.redirect(302, url);
    }
    if (q.u) {
      if (q.u === 'preview') return html(res, 200, page('This is a preview', '<p>The unsubscribe link works in the e-mails that are actually sent.</p>'));
      const id = E.untok(q.u); if (!id) return html(res, 400, page('This link is not valid', '<p>Write to <a href="mailto:sales@maxzzdiesel.com">sales@maxzzdiesel.com</a> and we will take you off the list.</p>'));
      const s = (await db.select('email_sends', 'select=id,email,campaign_id&id=eq.' + id + '&limit=1'))[0];
      if (!s) return html(res, 404, page('This link is not valid', '<p>Write to <a href="mailto:sales@maxzzdiesel.com">sales@maxzzdiesel.com</a> and we will take you off the list.</p>'));
      if (req.method === 'POST') {
        await db.insert('email_suppressions', [{ email: String(s.email).toLowerCase(), reason: 'unsubscribed', campaign_id: s.campaign_id }], { onConflict: 'email', ignoreDuplicates: true });
        await db.update('email_sends', 'id=eq.' + id, { unsubscribed_at: new Date().toISOString() }).catch(() => {});
        return html(res, 200, page('You are unsubscribed', `<p><b>${esc(mask(s.email))}</b> will not get promotions or news from Maxzz Diesel again.</p><p>E-mails about your orders and quotes are not affected.</p>`));
      }
      return html(res, 200, page('Unsubscribe from Maxzz Diesel e-mails?', `<p>Stop sending promotions and news to <b>${esc(mask(s.email))}</b>. E-mails about your orders and quotes are not affected.</p><form method="post" action="/api/e?u=${esc(q.u)}" style="margin:22px 0 0"><button type="submit" style="background:#d32a37;color:#fff;border:0;border-radius:50px;padding:14px 26px;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`));
    }
    return res.status(404).end();
  } catch (e) {
    console.error('mail endpoint', e.message);
    if (q.o) { res.setHeader('Content-Type', 'image/gif'); return res.status(200).send(GIF); }
    return res.status(500).end();
  }
};
