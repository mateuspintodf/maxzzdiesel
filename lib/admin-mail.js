// Admin handlers of the e-mail campaigns (Marketing > E-mails). Mounted into api/admin.js with the same helpers the
// other handlers use: who (session), can (role), originOk, readBody, clean, audit.
const db = require('./db');
const E = require('./email-engine');
const { EMAIL } = require('./validate');

const TYPES = ['heading', 'text', 'button', 'image', 'banner', 'products', 'divider', 'spacer'];
const uuid = (x) => /^[0-9a-f-]{36}$/i.test(String(x || ''));

module.exports = function mount(A, H) {
  const { who, can, originOk, readBody, clean, audit, base } = H;
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
    if (b.type === 'products') { o.codes = [...new Set((Array.isArray(b.codes) ? b.codes : String(b.codes || '').split(/[\s,;]+/)).map((c) => clean(c, 60)).filter(Boolean))].slice(0, 24); o.layout = ['list', 'grid2', 'grid3'].includes(b.layout) ? b.layout : 'list'; o.price = b.price === 'tier' ? 'tier' : 'none'; o.cta = clean(b.cta, 40) || 'View part'; }
    if (b.type === 'spacer') o.h = Math.max(4, Math.min(80, parseInt(b.h, 10) || 20));
    return o;
  }).filter(Boolean);
  const cleanAudience = (a) => { a = a || {}; return { segments: (Array.isArray(a.segments) ? a.segments : []).filter(uuid).slice(0, 40), exclude: (Array.isArray(a.exclude) ? a.exclude : []).filter(uuid).slice(0, 40), customers: !!a.customers,
    tiers: (Array.isArray(a.tiers) ? a.tiers : []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 20), salespeople: (Array.isArray(a.salespeople) ? a.salespeople : []).map((t) => clean(t, 80)).filter(Boolean).slice(0, 40), consent: a.consent === 'customers' ? 'customers' : 'optin' }; };
  const draftOf = (b) => ({ name: clean(b.name, 120) || 'Untitled e-mail', subject: clean(b.subject, 200), preheader: clean(b.preheader, 200), lang: ['en', 'es', 'pt'].includes(b.lang) ? b.lang : 'en', content: { blocks: cleanBlocks(b.content && b.content.blocks) }, audience: cleanAudience(b.audience) });
  const getC = async (id) => (uuid(id) ? (await db.select('email_campaigns', 'select=*&id=eq.' + id + '&limit=1'))[0] : null);

  A['mail-list'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const rows = await db.select('email_campaigns', 'select=id,name,subject,status,is_template,scheduled_at,started_at,sent_at,created_by,updated_at,audience&status=neq.archived&order=updated_at.desc&limit=300');
    const live = rows.filter((c) => ['sending', 'sent', 'cancelled'].includes(c.status)).slice(0, 40), st = {};
    if (live.length) { const all = await db.selectAll('email_sends', 'select=campaign_id,status,delivered_at,opened_at,clicked_at,unsubscribed_at&campaign_id=in.(' + live.map((c) => c.id).join(',') + ')', 60000); const by = {}; all.forEach((s) => { (by[s.campaign_id] = by[s.campaign_id] || []).push(s); }); live.forEach((c) => { st[c.id] = E.statsOf(by[c.id] || []); }); }
    return res.json({ campaigns: rows.map((c) => Object.assign({}, c, { stats: st[c.id] || null })), from: E.FROM(), mailOn: E.allowed('someone@example.org'), key: !!process.env.RESEND_API_KEY });
  };
  A['mail-get'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const c = await getC(req.query.id); if (req.query.id && !c) return res.status(404).json({ error: 'not found' });
    const [segs, links, f] = await Promise.all([db.select('segments', 'select=id,name&order=name'), db.selectAll('company_segments', 'select=segment_id'), E.facets()]);
    const n = {}; links.forEach((l) => { n[l.segment_id] = (n[l.segment_id] || 0) + 1; });
    return res.json({ campaign: c || null, segments: segs.map((s) => ({ id: s.id, name: s.name, n: n[s.id] || 0 })), facets: f, from: E.FROM(), me: w.email });
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
    const d = draftOf(readBody(req)), C = await E.loadCatalog();
    let r = { email: w.email, name: 'Alex Sample', company: 'Sample Diesel Service', tier: null, sp: 'Michael', priced: true };
    const missing = []; d.content.blocks.forEach((b) => { if (b.type === 'products') b.codes.forEach((c) => { if (!C.map[c]) missing.push(c); }); });
    const m = E.render(d, r, C, { base: base(req) });
    return res.json({ html: m.html, subject: m.subject, missing: [...new Set(missing)].slice(0, 20) });
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
    const b = readBody(req), c = await getC(b.id); if (!c) return res.status(404).json({ error: 'not found' });
    if (c.status !== 'draft') return res.status(409).json({ error: 'This e-mail is already ' + c.status + '.' });
    if (c.is_template) return res.status(400).json({ error: 'This is a template. Create an e-mail from it first.' });
    if (!c.subject) return res.status(400).json({ error: 'Write the subject first.' });
    if (!((c.content && c.content.blocks) || []).length) return res.status(400).json({ error: 'The e-mail is empty.' });
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
    const c = await getC(readBody(req).id); if (!c || c.status !== 'sending') return res.json({ ok: true, done: true });
    return res.json(Object.assign({ ok: true }, await E.processCampaign(c, 40000, base(req))));
  };
  A['mail-report'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const c = await getC(req.query.id); if (!c) return res.status(404).json({ error: 'not found' });
    const [sends, clicks] = await Promise.all([db.selectAll('email_sends', 'select=email,name,company,status,error,sent_at,delivered_at,opened_at,open_count,clicked_at,click_count,unsubscribed_at&campaign_id=eq.' + c.id + '&order=clicked_at.desc.nullslast,opened_at.desc.nullslast', 20000), db.selectAll('email_clicks', 'select=url,code,send_id&campaign_id=eq.' + c.id, 50000)]);
    const by = {}; clicks.forEach((k) => { const key = k.code || k.url.replace(/[?&]utm_[a-z]+=[^&#]*/g, '').replace(/\?$/, ''); const x = by[key] || (by[key] = { key, code: k.code || null, n: 0, people: new Set() }); x.n++; x.people.add(k.send_id); });
    return res.json({ campaign: { id: c.id, name: c.name, subject: c.subject, status: c.status, scheduled_at: c.scheduled_at, started_at: c.started_at, sent_at: c.sent_at }, stats: E.statsOf(sends),
      links: Object.values(by).map((x) => ({ key: x.key, code: x.code, clicks: x.n, people: x.people.size })).sort((a, z) => z.people - a.people).slice(0, 60), sends: sends.slice(0, 1500), hook: !!process.env.RESEND_WEBHOOK_SECRET });
  };
};
