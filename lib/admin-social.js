// Admin handlers of Marketing > Social media: the pieces of the publishing agenda, to approve, ask for changes and edit.
// The pieces live in agenda/index.html (the same list the /agenda page shows) and the decisions in the same private
// storage that page uses, so both places always agree.
const fs = require('fs');
const path = require('path');
const AG = require('../api/agenda');

let POSTS = null;
function posts() {
  if (POSTS) return POSTS;
  try { const s = fs.readFileSync(path.join(process.cwd(), 'agenda', 'index.html'), 'utf8'), m = s.match(/<script type="application\/json" id="posts-data">([\s\S]*?)<\/script>/); POSTS = m ? JSON.parse(m[1]) : []; }
  catch (e) { console.error('social posts', e.message); POSTS = []; }
  return POSTS;
}
const NETS = ['ig', 'fb', 'li'];

module.exports = function mount(A, H) {
  const { who, can, originOk, readBody, clean, audit } = H;
  const role = async (req, res, post) => {
    if (post && (req.method !== 'POST' || !originOk(req))) { res.status(405).json({ error: 'method' }); return null; }
    const w = await who(req, res); if (!w) return null;
    if (!can(w, 'marketing')) { res.status(403).json({ error: 'role' }); return null; }
    return w;
  };
  A['social-list'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const [ap, ed, fila] = await Promise.all(['aprovacoes', 'edicoes', 'fila'].map((c) => AG.readCol(c).then((r) => r.docs).catch((e) => { console.error('social read', c, e.message); return null; })));
    return res.json({ storage: !!ap, pieces: posts().map((p) => ({ id: p.id, date: p.date, time: p.time, pilar: p.pilar, kind: p.kind, title: p.title, cap: p.cap, note: p.note || '',
      imgs: (p.imgs || []).map((x) => String(x).replace(/^m\//, '').replace(/\?.*$/, '')), ap: (ap && ap[p.id]) || null, ed: (ed && ed[p.id]) || null, queued: !!(fila && fila[p.id]) })) });
  };
  A['social-save'] = async (req, res) => {
    const w = await role(req, res, true); if (!w) return;
    const b = readBody(req), id = clean(b.id, 20), p = posts().find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: 'This piece is not on the agenda.' });
    const por = 'n:' + String(w.email).split('@')[0], em = new Date().toISOString();
    try {
      if (b.op === 'approve') await AG.mutate('aprovacoes', id, 'set', { status: 'aprovado', nota: '', por, em });
      else if (b.op === 'adjust') { const nota = String(b.note || '').trim().slice(0, 2000); if (!nota) return res.status(400).json({ error: 'Write what should change.' }); await AG.mutate('aprovacoes', id, 'set', { status: 'ajuste', nota, por, em }); }
      else if (b.op === 'reset') await AG.mutate('aprovacoes', id, 'set', { status: 'aguardando', nota: '', por, em });
      else if (b.op === 'edit') {
        const e = b.edit || {}, o = { por, em, cap: {} };
        if (/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) o.date = e.date;
        const tm = String(e.time || '').match(/^(\d{1,2})[:h](\d{2})$/); if (tm && +tm[1] < 24 && +tm[2] < 60) o.time = String(tm[1]).padStart(2, '0') + 'h' + tm[2];
        if (typeof e.title === 'string' && e.title.trim()) o.title = e.title.trim().slice(0, 140);
        NETS.forEach((n) => { if (e.cap && typeof e.cap[n] === 'string') o.cap[n] = e.cap[n].slice(0, n === 'li' ? 3000 : 2200); });
        await AG.mutate('edicoes', id, 'set', o);
        // an edited piece goes back to waiting: what was approved is no longer what is on the page
        await AG.mutate('aprovacoes', id, 'set', { status: 'aguardando', nota: '', por, em });
      } else return res.status(400).json({ error: 'op' });
    } catch (e) { console.error('social save', e && e.message); return res.status(503).json({ error: 'Could not save. Try again in a moment.' }); }
    await audit(w.email, 'social.' + b.op, 'social', id, null, b.op === 'adjust' ? { note: String(b.note || '').slice(0, 300) } : null);
    return res.json({ ok: true });
  };
  // the pictures of the pieces sit behind the agenda password; here they are served to a signed-in admin
  A['social-img'] = async (req, res) => {
    const w = await role(req, res); if (!w) return;
    const f = String(req.query.f || ''); if (!/^m\d{2}_\d{2}\.jpg$/.test(f)) return res.status(400).end();
    try { const buf = fs.readFileSync(path.join(process.cwd(), 'agenda', 'm', f)); res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, max-age=86400'); return res.status(200).send(buf); }
    catch (e) { return res.status(404).end(); }
  };
};
