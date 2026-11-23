// Admin handlers of the e-mail campaigns (Marketing > E-mails). Mounted into api/admin.js with the same helpers the
// other handlers use: who (session), can (role), originOk, readBody, clean, audit.
const db = require('./db');
const E = require('./email-engine');
const { EMAIL } = require('./validate');

const TYPES = ['heading', 'text', 'button', 'image', 'banner', 'products', 'divider', 'spacer'];
const uuid = (x) => /^[0-9a-f-]{36}$/i.test(String(x || ''));

module.exports = function mount(A, H) {
  const { who, can, originOk, readBody, clean, audit, base, names } = H;
  const role = async (req, res, post) => {
    if (post && (req.method !== 'POST' || !originOk(req))) { res.status(405).json({ error: 'method' }); return null; }
    const w = await who(req, res); if (!w) return null;
    if (!can(w, 'marketing')) { res.status(403).json({ error: 'role' }); return null; }
    return w;
  };
  // only known block types and fields are kept, each with a size limit
  const cleanBlocks = (list) => (Array.isArray(list) ? list : []).slice(0, 60).map((b) => {
    if (!b || TYPES.indexOf(b.type) < 0) return null;
    const o = { type: b.type };
    if (b.type === 'heading') { o.text = clean(b.text, 200); o.size = b.size === 'l' ? 'l' : 'm'; }
    if (b.type === 'text') o.text = String(b.text || '').replace(/\r/g, '').slice(0, 6000);
    if (b.type === 'button') { o.label = clean(b.label, 60); o.url = clean(b.url, 600); }
    if (b.type === 'image') { o.src = clean(b.src, 600); o.alt = clean(b.alt, 160); o.url = clean(b.url, 600); }
    if (b.type === 'banner') { o.text = clean(b.text, 160); o.sub = clean(b.sub, 300); o.bg = ['red', 'dark', 'orange', 'soft'].includes(b.bg) ? b.bg : 'red'; o.label = clean(b.label, 60); o.url = clean(b.url, 600); }
    if (b.type === 'products') { o.codes = [...new Set((Array.isArray(b.codes) ? b.codes : String(b.codes || '').split(/[\s,;]+/)).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 24); o.layout = ['list', 'grid2', 'grid3', 'hero'].includes(b.layout) ? b.layout : 'list'; o.price = b.price === 'tier' ? 'tier' : 'none'; o.cta = clean(b.cta, 40) || 'View part'; o.look = E.parseLook(b.look); o.hide = [...new Set((Array.isArray(b.hide) ? b.hide : String(b.hide || '').split(',')).filter((x) => E.HIDE.includes(x)))]; }
    if (b.type === 'spacer') o.h = Math.max(4, Math.min(80, parseInt(b.h, 10) || 20));
    return o;
  }).filter(Boolean);
  // free design: the HTML is kept without anything that could run (scripts, event attributes, frames, forms)
  const safeHtml = (h) => String(h || '').slice(0, 400000).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<\/?(script|iframe|object|embed|form|input|link|meta|base)[^>]*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
  const cleanContent = (c) => { c = c || {}; const o = { blocks: cleanBlocks(c.blocks) }; if (c.noHeader) o.noHeader = true; if (c.page && typeof c.page === 'object') o.page = E.cleanPage(c.page); if (c.mode === 'free') { o.mode = 'free'; o.html = safeHtml(c.html); const pj = c.project && typeof c.project === 'object' ? c.project : null; if (pj && JSON.stringify(pj).length < 1500000) o.project = pj; } return o; };
  const cleanAudience = (a) => { a = a || {}; return { maxPerWeek: Math.max(0, Math.min(14, parseInt(a.maxPerWeek, 10) || 0)), segments: (Array.isArray(a.segments) ? a.segments : []).filter(uuid).slice(0, 40), exclude: (Array.isArray(a.exclude) ? a.exclude : []).filter(uuid).slice(0, 40), customers: !!a.customers,
    tiers: (Array.isArray(a.tiers) ? a.tiers : []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 20), salespeople: (Array.isArray(a.salespeople) ? a.salespeople : []).map((t) => clean(t, 80)).filter(Boolean).slice(0, 40), profiles: (Array.isArray(a.profiles) ? a.profiles : []).filter((x) => E.PROFILES.includes(x)), skip: E.cleanSkip(a.skip).slice(0, 500), consent: a.consent === 'customers' ? 'customers' : 'optin' }; };
  const draftOf = (b) => ({ name: clean(b.name, 120) || 'Untitled e-mail', subject: clean(b.subject, 200), preheader: clean(b.preheader, 200), lang: ['en', 'es', 'pt'].includes(b.lang) ? b.lang : 'en', content: cleanContent(b.content), audience: cleanAudience(b.audience) });
  const getC = async (id) => (uuid(id) ? (await db.select('email_campaigns', 'select=*&id=eq.' + id + '&limit=1'))[0] : null);

  A['mail-list'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const rows = await db.select('email_campaigns', 'select=id,name,subject,status,is_template,scheduled_at,started_at,sent_at,created_by,updated_at,audience&status=neq.archived&order=updated_at.desc&limit=300');
    const live = rows.filter((c) => ['sending', 'sent', 'cancelled'].includes(c.status)).slice(0, 40), st = {};
    if (live.length) { const all = await db.selectAll('email_sends', 'select=campaign_id,status,delivered_at,opened_at,clicked_at,unsubscribed_at&campaign_id=in.(' + live.map((c) => c.id).join(',') + ')', 60000); const by = {}; all.forEach((s) => { (by[s.campaign_id] = by[s.campaign_id] || []).push(s); }); live.forEach((c) => { st[c.id] = E.statsOf(by[c.id] || []); }); }
    const ML = require('./mail'), ov = await db.select('email_templates', 'select=*').catch(() => []), om = {}; ov.forEach((x) => { om[x.key] = x; });
    return res.json({ templates: ML.TEMPLATES.map((t) => ({ key: t[0], name: t[1], subject: t[2], title: t[3], saved: om[t[0]] || null })), canSend: w.role === 'superadmin', campaigns: rows.map((c) => Object.assign({}, c, { stats: st[c.id] || null })), from: E.FROM(), mailOn: E.allowed('someone@example.org'), key: !!process.env.RESEND_API_KEY });
  };
  A['mail-get'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const c = await getC(req.query.id); if (req.query.id && !c) return res.status(404).json({ error: 'not found' });
    const [segs, links, f] = await Promise.all([db.select('segments', 'select=id,name&order=name'), db.selectAll('company_segments', 'select=segment_id'), E.facets()]);
    const n = {}; links.forEach((l) => { n[l.segment_id] = (n[l.segment_id] || 0) + 1; });
    return res.json({ canSend: w.role === 'superadmin', campaign: c || null, segments: segs.map((s) => ({ id: s.id, name: s.name, n: n[s.id] || 0 })), facets: f, from: E.FROM(), me: w.email });
  };
  A['mail-save'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b = readBody(req), d = draftOf(b), now = new Date().toISOString();
    if (b.id) { const c = await getC(b.id); if (!c) return res.status(404).json({ error: 'not found' });
      if (c.status !== 'draft') return res.status(409).json({ error: 'This e-mail is ' + c.status + '. Cancel the sending or duplicate it to edit.' });
      const up = await db.update('email_campaigns', 'id=eq.' + c.id, Object.assign(d, { is_template: !!b.is_template, updated_by: w.email, updated_at: now })); return res.json({ ok: true, campaign: up[0] }); }
    const ins = await db.insert('email_campaigns', [Object.assign(d, { is_template: !!b.is_template, created_by: w.email, updated_by: w.email })]);
    await audit(w.email, 'mail.create', 'email', ins[0].id, null, { name: d.name });
    return res.json({ ok: true, campaign: ins[0] });
  };
  A['mail-copy'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b = readBody(req), c = await getC(b.id); if (!c) return res.status(404).json({ error: 'not found' });
    const ins = await db.insert('email_campaigns', [{ name: (b.as_template ? '' : 'Copy of ') + c.name, subject: c.subject, preheader: c.preheader, lang: c.lang, content: c.content, audience: b.as_template ? {} : c.audience, is_template: !!b.as_template, created_by: w.email, updated_by: w.email }]);
    return res.json({ ok: true, campaign: ins[0] });
  };
  A['mail-archive'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const c = await getC(readBody(req).id); if (!c) return res.status(404).json({ error: 'not found' });
    if (c.status === 'sending' || c.status === 'scheduled') return res.status(409).json({ error: 'Cancel the sending first.' });
    await db.update('email_campaigns', 'id=eq.' + c.id, { status: 'archived', updated_by: w.email, updated_at: new Date().toISOString() });
    await audit(w.email, 'mail.archive', 'email', c.id, null, { name: c.name });
    return res.json({ ok: true });
  };
  // what one person would see: the first of the audience, or a sample contact
  A['mail-preview'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b0 = readBody(req), saved = b0.id && !b0.content ? await getC(b0.id) : null; if (b0.id && !b0.content && !saved) return res.status(404).json({ error: 'not found' });
    const d = saved || draftOf(b0), C = await E.loadCatalog(); if (b0.layout) C.layout = E.cleanLayout(b0.layout);
    let r = { email: w.email, name: 'Alex Sample', company: 'Sample Diesel Service', tier: null, sp: 'Michael', priced: true };
    const missing = []; ((d.content && d.content.blocks) || []).forEach((b) => { if (b.type === 'products') b.codes.forEach((c) => { if (!C.map[c]) missing.push(c); }); });
    const m = E.render(d, r, C, { base: base(req) });
    return res.json({ html: m.html, subject: m.subject, missing: [...new Set(missing)].slice(0, 20) });
  };
  // the visual designer: the starting HTML of a block e-mail, and how a product block looks with real parts
  A['mail-seed'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const d = draftOf(readBody(req)); return res.json({ html: E.seedHtml(await E.loadCatalog(), d) });
  };
  A['mail-products'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b = cleanBlocks([Object.assign({}, readBody(req), { type: 'products' })])[0], C = await E.loadCatalog();
    const missing = b.codes.filter((c) => !C.map[c]);
    return res.json({ html: E.productsHtml(C, b, { priced: true, tier: null }, base(req)), missing });
  };
  // the standard header and footer: what the designer shows around the e-mail, and saving a new version
  A['mail-layout'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const C = await E.loadCatalog(), ch = E.chrome(C.layout, (u) => u, '#', base(req));
    return res.json({ layout: C.layout, header: ch.header, footer: ch.footer });
  };
  // standing exception list: e-mails, domains or customer codes that never receive a campaign
  A['mail-exceptions-save'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const items = E.cleanSkip(readBody(req).items);
    await db.insert('email_settings', [{ key: 'exceptions', value: { items }, updated_by: w.email, updated_at: new Date().toISOString() }], { onConflict: 'key' });
    await audit(w.email, 'mail.exceptions', 'email', 'exceptions', null, { count: items.length });
    return res.json({ ok: true, items });
  };
  A['mail-layout-save'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const L = E.cleanLayout(readBody(req).layout);
    await db.insert('email_settings', [{ key: 'layout', value: L, updated_by: w.email, updated_at: new Date().toISOString() }], { onConflict: 'key' });
    await audit(w.email, 'mail.layout', 'email', 'layout', null, L);
    return res.json({ ok: true, layout: L });
  };
  // a picture for an e-mail (a campaign banner, a photo): made lighter and kept in the public photo store
  A['mail-upload'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    if (!process.env.FOTOS_READ_WRITE_TOKEN) return res.status(500).json({ error: 'The photo store is not set up.' });
    const buf = Buffer.from(String(readBody(req).data || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length || buf.length > 3.2 * 1024 * 1024) return res.status(400).json({ error: 'The image must be 3 MB or less.' });
    try {
      const sharp = require('sharp'), img = sharp(buf, { failOn: 'none' }).rotate(), meta = await img.metadata();
      if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) return res.status(400).json({ error: 'Use a JPG, PNG, WebP or GIF image.' });
      const png = meta.hasAlpha, out = await (png ? img.resize({ width: 1360, withoutEnlargement: true }).png({ compressionLevel: 9 }) : img.resize({ width: 1360, withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true })).toBuffer();
      const { put } = require('@vercel/blob'), name = 'email/' + require('crypto').randomBytes(8).toString('hex') + (png ? '.png' : '.jpg');
      const r = await put(name, out, { access: 'public', token: process.env.FOTOS_READ_WRITE_TOKEN, contentType: png ? 'image/png' : 'image/jpeg', addRandomSuffix: false, cacheControlMaxAge: 31536000 });
      await audit(w.email, 'mail.upload', 'email', '', null, { url: r.url, bytes: out.length });
      return res.json({ ok: true, url: r.url, width: Math.min(meta.width || 1360, 1360) });
    } catch (e) { console.error('mail upload', e.message); return res.status(502).json({ error: 'Could not save the image. Try another file.' }); }
  };
  A['mail-audience'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const a = await E.audience(cleanAudience(readBody(req).audience));
    return res.json({ info: a.info, sample: a.list.slice(0, 8).map((p) => ({ email: p.email, name: p.name, company: p.company, tier: p.tier })) });
  };
  A['mail-test'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b = readBody(req), d = draftOf(b);
    const emails = [...new Set(String(b.emails || '').toLowerCase().split(/[\s,;]+/).filter((e) => EMAIL.test(e)))].slice(0, 5);
    if (!emails.length) return res.status(400).json({ error: 'Type at least one e-mail address.' });
    if (!d.subject) return res.status(400).json({ error: 'Write the subject first.' });
    const r = await E.sendTest(d, emails, base(req));
    await audit(w.email, 'mail.test', 'email', b.id || '', null, { to: emails, sent: r.sent });
    return res.json(Object.assign({ ok: !r.error }, r));
  };
  A['mail-send'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin can send or schedule a campaign. Ask one to review and send it.' });
    const b = readBody(req), c = await getC(b.id); if (!c) return res.status(404).json({ error: 'not found' });
    if (c.status !== 'draft') return res.status(409).json({ error: 'This e-mail is already ' + c.status + '.' });
    if (c.is_template) return res.status(400).json({ error: 'This is a template. Create an e-mail from it first.' });
    if (!c.subject) return res.status(400).json({ error: 'Write the subject first.' });
    if (!((c.content && c.content.blocks) || []).length && !(c.content && c.content.mode === 'free' && c.content.html)) return res.status(400).json({ error: 'The e-mail is empty.' });
    const a = await E.audience(c.audience); if (!a.list.length) return res.status(400).json({ error: 'Nobody would receive it. Check the lists and the consent rule.' });
    let when = b.when ? new Date(b.when) : null; if (when && (isNaN(when) || when.getTime() < Date.now() - 60000)) return res.status(400).json({ error: 'Pick a time in the future.' });
    await audit(w.email, when ? 'mail.schedule' : 'mail.send', 'email', c.id, null, { name: c.name, recipients: a.list.length, when: when ? when.toISOString() : 'now' });
    if (when) { await db.update('email_campaigns', 'id=eq.' + c.id, { status: 'scheduled', scheduled_at: when.toISOString(), updated_by: w.email, updated_at: new Date().toISOString() }); return res.json({ ok: true, scheduled: when.toISOString(), recipients: a.list.length }); }
    const n = await E.queue(c), r = await E.processCampaign(Object.assign({}, c, { status: 'sending' }), 40000, base(req));
    return res.json(Object.assign({ ok: true, recipients: n }, r));
  };
  A['mail-cancel'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const c = await getC(readBody(req).id); if (!c) return res.status(404).json({ error: 'not found' });
    if (c.status === 'scheduled') { await db.update('email_campaigns', 'id=eq.' + c.id, { status: 'draft', scheduled_at: null }); }
    else if (c.status === 'sending') { await db.update('email_campaigns', 'id=eq.' + c.id, { status: 'cancelled' }); await db.update('email_sends', 'campaign_id=eq.' + c.id + '&status=eq.queued', { status: 'held', error: 'Cancelled' }); }
    else return res.status(409).json({ error: 'Nothing to cancel.' });
    await audit(w.email, 'mail.cancel', 'email', c.id, null, { name: c.name });
    return res.json({ ok: true });
  };
  // keeps a sending going from the screen (the cron does the same every 5 minutes in production)
  A['mail-continue'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    if (w.role !== 'superadmin') return res.status(403).json({ error: 'Only a superadmin can send.' });
    const c = await getC(readBody(req).id); if (!c || c.status !== 'sending') return res.json({ ok: true, done: true });
    return res.json(Object.assign({ ok: true }, await E.processCampaign(c, 40000, base(req))));
  };
  // wording of the portal e-mails: subject, title, a note on top and the button text; an empty save goes back to the built-in text
  A['mail-tx-save'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const ML = require('./mail'), b = readBody(req), key = clean(b.key, 40), t = ML.TEMPLATES.find((x) => x[0] === key); if (!t) return res.status(404).json({ error: 'not found' });
    const row = { subject: clean(b.subject, 200) || null, title: clean(b.title, 120) || null, note: String(b.note || '').replace(/\r/g, '').trim().slice(0, 1200) || null, cta_label: clean(b.cta_label, 60) || null };
    if (b.reset || (!row.subject && !row.title && !row.note && !row.cta_label)) await db.remove('email_templates', 'key=eq.' + key);
    else await db.insert('email_templates', [Object.assign({ key, updated_by: w.email, updated_at: new Date().toISOString() }, row)], { onConflict: 'key' });
    ML.resetTemplates(); await audit(w.email, 'mail.template', 'email', key, null, b.reset ? { reset: true } : row);
    return res.json({ ok: true });
  };
  A['mail-tx-preview'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const ML = require('./mail'), b = readBody(req), t = ML.TEMPLATES.find((x) => x[0] === clean(b.key, 40)); if (!t) return res.status(404).json({ error: 'not found' });
    const v = { number: 'SO-00008579', label: 'Quote', label_lower: 'quote' }, fill = (s) => String(s || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => v[k.toLowerCase()] || '');
    const note = String(b.note || '').trim(), body = (note ? '<p style="margin:0 0 14px">' + ML.esc(fill(note)).replace(/\n/g, '<br>') + '</p>' : '') + '<p style="margin:0;padding:18px;border:1px dashed #c9ced3;border-radius:12px;color:#8a9097;text-align:center">The details of this e-mail (order lines, links, amounts) appear here and are written by the system.</p>';
    return res.json({ subject: fill(clean(b.subject, 200) || t[2]), html: ML.layout(fill(clean(b.title, 120) || t[3]), body, { url: base(req) + '/portal', label: clean(b.cta_label, 60) || 'Open the portal' }, { name: 'Alex Sample', greet: true }) });
  };
  // every campaign of a period side by side, plus who engages, what gets clicked and when: the base for the next e-mail
  A['mail-insights'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const days = [30, 90, 180, 365].includes(+req.query.days) ? +req.query.days : 90, since = new Date(Date.now() - days * 864e5).toISOString();
    const camps = (await db.select('email_campaigns', 'select=id,name,subject,status,started_at,sent_at&is_template=eq.false&status=in.(sent,sending,cancelled)&order=sent_at.desc.nullslast&limit=200')).filter((c) => (c.started_at || c.sent_at || '') >= since).slice(0, 80);
    const empty = { days, campaigns: [], totals: E.statsOf([]), parts: [], links: [], people: [], cold: [], coldCount: 0, tiers: [], hours: [], weekdays: [], groups: { hot: 0, warm: 0, cold: 0, fresh: 0 } };
    if (!camps.length) return res.json(empty);
    const ids = camps.map((c) => c.id).join(',');
    const [sends, clicks, N] = await Promise.all([db.selectAll('email_sends', 'select=id,campaign_id,customer_code,email,company,name,tier,status,sent_at,delivered_at,opened_at,open_count,clicked_at,click_count,unsubscribed_at&campaign_id=in.(' + ids + ')', 120000),
      db.selectAll('email_clicks', 'select=campaign_id,send_id,url,code,at&campaign_id=in.(' + ids + ')', 120000), names ? names().catch(() => ({})) : {}]);
    const reached = (x) => ['sent', 'bounced', 'complained'].includes(x.status), byC = {}, sid = {};
    sends.forEach((x) => { (byC[x.campaign_id] = byC[x.campaign_id] || []).push(x); sid[x.id] = x; });
    const campaigns = camps.map((c) => { const st = E.statsOf(byC[c.id] || []); return { id: c.id, name: c.name, subject: c.subject, status: c.status, at: c.started_at || c.sent_at, reached: st.reached, delivered: st.delivered, opened: st.opened, clicked: st.clicked, unsubscribed: st.unsubscribed, bounced: st.bounced, complained: st.complained }; });
    // parts and links
    const pm = {}, lm = {};
    clicks.forEach((k) => { const s = sid[k.send_id], who = s ? (s.customer_code || s.email) : k.send_id;
      if (k.code) { const x = pm[k.code] || (pm[k.code] = { code: k.code, t: (N[k.code] && N[k.code].t) || '', clicks: 0, people: new Set(), camps: new Set() }); x.clicks++; x.people.add(who); x.camps.add(k.campaign_id); }
      else { const key = String(k.url || '').replace(/[?&]utm_[a-z]+=[^&#]*/g, '').replace(/\?$/, '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 90); const x = lm[key] || (lm[key] = { key, clicks: 0, people: new Set() }); x.clicks++; x.people.add(who); } });
    // people: one line per customer (or per address when it is not a customer yet)
    const pp = {}, now = Date.now();
    sends.filter(reached).forEach((x) => { const key = x.customer_code || x.email, p = pp[key] || (pp[key] = { code: x.customer_code || null, company: x.company || '', email: x.email, tier: x.tier || '', received: 0, opened: 0, clicked: 0, clicks: 0, lastOpen: null, lastClick: null, lastSent: null, unsub: false });
      p.received++; if (x.opened_at) { p.opened++; if (!p.lastOpen || x.opened_at > p.lastOpen) p.lastOpen = x.opened_at; } if (x.clicked_at) { p.clicked++; p.clicks += x.click_count || 1; if (!p.lastClick || x.clicked_at > p.lastClick) p.lastClick = x.clicked_at; }
      if (x.sent_at && (!p.lastSent || x.sent_at > p.lastSent)) p.lastSent = x.sent_at; if (x.unsubscribed_at) p.unsub = true; if (!p.company && x.company) p.company = x.company; });
    const P = Object.values(pp), groups = { hot: 0, warm: 0, cold: 0, fresh: 0 };
    P.forEach((p) => { p.group = p.clicked ? 'hot' : p.opened ? 'warm' : p.received >= 3 ? 'cold' : 'fresh'; groups[p.group]++; });
    const people = P.filter((p) => p.clicked).sort((a, z) => z.clicked - a.clicked || z.clicks - a.clicks || (String(z.lastClick) > String(a.lastClick) ? 1 : -1)).slice(0, 60);
    const coldAll = P.filter((p) => p.group === 'cold' && !p.unsub).sort((a, z) => z.received - a.received);
    // by price tier
    const tm = {}; sends.filter(reached).forEach((x) => { const t = tm[x.tier || 'No tier'] || (tm[x.tier || 'No tier'] = { tier: x.tier || 'No tier', reached: 0, opened: 0, clicked: 0 }); t.reached++; if (x.opened_at) t.opened++; if (x.clicked_at) t.clicked++; });
    // when people click (Eastern time)
    const hours = Array.from({ length: 24 }, () => 0), wd = Array.from({ length: 7 }, () => 0), fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }), WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    clicks.forEach((k) => { try { const o = {}; fmt.formatToParts(new Date(k.at)).forEach((x) => { o[x.type] = x.value; }); hours[(+o.hour) % 24]++; wd[WD[o.weekday]]++; } catch (e) { /* bad date */ } });
    const all = sends.filter(reached);
    return res.json({ days, campaigns, totals: E.statsOf(sends), unique: { people: P.length, opened: P.filter((p) => p.opened).length, clicked: P.filter((p) => p.clicked).length }, groups,
      parts: Object.values(pm).map((x) => ({ code: x.code, t: x.t, clicks: x.clicks, people: x.people.size, camps: x.camps.size })).sort((a, z) => z.people - a.people || z.clicks - a.clicks).slice(0, 40),
      links: Object.values(lm).map((x) => ({ key: x.key, clicks: x.clicks, people: x.people.size })).sort((a, z) => z.people - a.people).slice(0, 25),
      people, cold: coldAll.slice(0, 60), coldCount: coldAll.length, tiers: Object.values(tm).sort((a, z) => z.reached - a.reached), hours, weekdays: wd, clicksTotal: clicks.length, sentTotal: all.length });
  };
  A['mail-report'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const c = await getC(req.query.id); if (!c) return res.status(404).json({ error: 'not found' });
    if (req.query.sync) await E.syncDelivery(c.id, 30).catch((e) => console.error('delivery sync', e.message));
    const [sends, clicks] = await Promise.all([db.selectAll('email_sends', 'select=id,customer_code,email,name,company,status,error,sent_at,delivered_at,opened_at,open_count,clicked_at,click_count,unsubscribed_at&campaign_id=eq.' + c.id + '&order=clicked_at.desc.nullslast,opened_at.desc.nullslast', 20000), db.selectAll('email_clicks', 'select=url,code,send_id&campaign_id=eq.' + c.id, 50000)]);
    const by = {}; clicks.forEach((k) => { const key = k.code || k.url.replace(/[?&]utm_[a-z]+=[^&#]*/g, '').replace(/\?$/, ''); const x = by[key] || (by[key] = { key, code: k.code || null, n: 0, people: new Set() }); x.n++; x.people.add(k.send_id); });
    // what the customers who received it ordered afterwards (invoiced orders in Unleashed): a hint of the effect, not proof
    let sales = null; const t0 = c.started_at || c.sent_at;
    if (t0) { try { const day = String(t0).slice(0, 10), codes = [...new Set(sends.filter((s) => s.customer_code && ['sent', 'bounced', 'complained'].includes(s.status)).map((s) => s.customer_code))], clk = new Set(sends.filter((s) => s.clicked_at && s.customer_code).map((s) => s.customer_code)), ord = [];
      for (let i = 0; i < codes.length; i += 120) ord.push(...(await db.select('sales_orders', 'select=customer_code,order_date,subtotal&is_return=eq.false&order_date=gte.' + day + '&customer_code=in.(' + codes.slice(i, i + 120).map((x) => encodeURIComponent('"' + String(x).replace(/["\\]/g, '') + '"')).join(',') + ')&limit=5000')));
      const within = (o, d) => (Date.parse(o.order_date) - Date.parse(day)) / 864e5 <= d, sum = (l) => ({ orders: l.length, revenue: Math.round(l.reduce((t, o) => t + (Number(o.subtotal) || 0), 0)), customers: new Set(l.map((o) => o.customer_code)).size });
      sales = { since: day, customers: codes.length, clickers: clk.size, all7: sum(ord.filter((o) => within(o, 7))), all30: sum(ord.filter((o) => within(o, 30))), click7: sum(ord.filter((o) => clk.has(o.customer_code) && within(o, 7))), click30: sum(ord.filter((o) => clk.has(o.customer_code) && within(o, 30))) }; } catch (e) { console.error('mail sales', e.message); } }
    sends.forEach((s) => { delete s.id; delete s.customer_code; });
    return res.json({ sales, campaign: { id: c.id, name: c.name, subject: c.subject, status: c.status, scheduled_at: c.scheduled_at, started_at: c.started_at, sent_at: c.sent_at }, stats: E.statsOf(sends),
      links: Object.values(by).map((x) => ({ key: x.key, code: x.code, clicks: x.n, people: x.people.size })).sort((a, z) => z.people - a.people).slice(0, 60), sends: sends.slice(0, 1500), hook: !!process.env.RESEND_WEBHOOK_SECRET });
  };
};
