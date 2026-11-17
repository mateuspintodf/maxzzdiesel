// Daily briefing for the managers: a morning "what to look at today" and an evening "how the day went".
// Built from the same tables the admin reads (sales_orders, crm_deals, crm_activities, sales_goals). Cost never appears here.
// The AI paragraph is optional (DASH_AI=1 and a gateway key); without it the briefing is numbers and fixed rules only.
const db = require('./db');
const { esc } = require('./mail');

const TZ = 'America/New_York';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hourNY = (d) => +new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d) % 24;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const k = (n) => { n = Number(n) || 0; return Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e4 ? '$' + Math.round(n / 1e3) + 'k' : money(n); };
const daysIn = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const net = (rows) => rows.reduce((a, r) => a + (r.is_return ? -Math.abs(Number(r.subtotal) || 0) : Number(r.subtotal) || 0), 0);
const agoDays = (iso, today) => Math.max(0, Math.round((new Date(today + 'T12:00:00Z') - new Date(String(iso).slice(0, 10) + 'T12:00:00Z')) / 864e5));

async function collect(kind, now) {
  const today = ymd(now), ym = today.slice(0, 7), day = +today.slice(8, 10), dim = daysIn(ym);
  const y = addDays(today, -1), tomorrow = addDays(today, 1), from = ym + '-01';
  const [mtd, goalRows, deals, acts, stages] = await Promise.all([
    db.select('sales_orders', 'select=order_date,subtotal,is_return,salesperson,customer_name,number&order_date=gte.' + from + '&limit=20000').catch(() => []),
    db.select('sales_goals', 'select=salesperson,target&salesperson=eq.*&ym=eq.' + ym).catch(() => []),
    db.select('crm_deals', 'select=id,title,stage,owner,customer_name,value,created_at,updated_at,stage_at,closed_at&order=updated_at.desc&limit=800').catch(() => []),
    db.select('crm_activities', 'select=deal_id,kind,body,due,done_at,created_by,created_at&order=created_at.desc&limit=1500').catch(() => []),
    db.select('crm_stages', 'select=key,label,kind').catch(() => []),
  ]);
  const SK = {}; stages.forEach((s) => { SK[s.key] = s; });
  const open = deals.filter((d) => !d.closed_at && (SK[d.stage] || { kind: 'open' }).kind === 'open');
  const dn = {}; deals.forEach((d) => { dn[d.id] = d; });
  const dealName = (id) => (dn[id] && (dn[id].customer_name || dn[id].title)) || 'a deal';
  const dayRows = (d) => mtd.filter((r) => String(r.order_date).slice(0, 10) === d);
  const goal = goalRows[0] ? Number(goalRows[0].target) || 0 : 0;
  const mtdNet = net(mtd);
  const elapsed = kind === 'am' ? Math.max(1, day - 1) : day;               // full days behind us
  const projection = elapsed > 0 ? mtdNet / elapsed * dim : 0;
  const tasks = acts.filter((a) => a.kind === 'task' && !a.done_at && a.due);
  const od = tasks.filter((a) => String(a.due) < today), due = tasks.filter((a) => String(a.due) === today), tmr = tasks.filter((a) => String(a.due) === tomorrow);
  const stale = open.filter((d) => agoDays(d.updated_at, today) >= 5).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).slice(0, 5);
  const quotes = open.filter((d) => d.stage === 'quote' && agoDays(d.stage_at || d.updated_at, today) >= 3).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).slice(0, 5);
  const target = kind === 'am' ? y : today, tRows = dayRows(target);
  const bySp = {}; tRows.forEach((r) => { const s = r.salesperson || 'Unassigned'; bySp[s] = (bySp[s] || 0) + (r.is_return ? -Math.abs(Number(r.subtotal) || 0) : Number(r.subtotal) || 0); });
  const top = tRows.filter((r) => !r.is_return).sort((a, b) => (Number(b.subtotal) || 0) - (Number(a.subtotal) || 0)).slice(0, 3);
  const closedToday = deals.filter((d) => d.closed_at && String(d.closed_at).slice(0, 10) === today);
  const doneActs = acts.filter((a) => String(a.created_at).slice(0, 10) === today);
  const byWho = {}; doneActs.forEach((a) => { const w = String(a.created_by || 'system').split('@')[0]; if (w !== 'system') byWho[w] = (byWho[w] || 0) + 1; });
  const newLeads = deals.filter((d) => String(d.created_at).slice(0, 10) === (kind === 'am' ? y : today));
  const pipeVal = open.reduce((a, d) => a + (Number(d.value) || 0), 0);
  return {
    kind, today, ym, day, dim, goal, mtd: mtdNet, projection, pace: day / dim,
    target, dayNet: net(tRows), dayOrders: tRows.filter((r) => !r.is_return).length, bySp, top: top.map((r) => ({ name: r.customer_name, number: r.number, v: Number(r.subtotal) || 0 })),
    open: open.length, pipeVal, stale: stale.map((d) => ({ name: dealName(d.id), v: Number(d.value) || 0, days: agoDays(d.updated_at, today), owner: d.owner })),
    quotes: quotes.map((d) => ({ name: dealName(d.id), v: Number(d.value) || 0, days: agoDays(d.stage_at || d.updated_at, today), owner: d.owner })),
    overdue: od.length, dueToday: due.length, dueTomorrow: tmr.length,
    overdueList: od.slice(0, 5).map((a) => ({ deal: dealName(a.deal_id), body: String(a.body || '').slice(0, 80), due: String(a.due) })),
    dueList: (kind === 'am' ? due : tmr).slice(0, 6).map((a) => ({ deal: dealName(a.deal_id), body: String(a.body || '').slice(0, 80) })),
    won: closedToday.filter((d) => (SK[d.stage] || {}).kind === 'won').map((d) => ({ name: d.customer_name || d.title, v: Number(d.value) || 0 })),
    lost: closedToday.filter((d) => (SK[d.stage] || {}).kind === 'lost').map((d) => ({ name: d.customer_name || d.title, v: Number(d.value) || 0 })),
    activity: byWho, newLeads: newLeads.length,
  };
}

const h3 = (t) => '<h3 style="margin:22px 0 8px;font-size:15px;color:#1d2126">' + esc(t) + '</h3>';
const ul = (items) => items.length ? '<ul style="margin:0;padding-left:18px">' + items.map((i) => '<li style="margin:3px 0">' + i + '</li>').join('') + '</ul>' : '';
const stat = (label, value, sub) => '<td style="padding:10px 14px;background:#f7f8f9;border-radius:12px;vertical-align:top"><div style="font-size:12px;color:#5f6670">' + esc(label) + '</div><div style="font-size:20px;font-weight:700;color:#1d2126">' + esc(value) + '</div>' + (sub ? '<div style="font-size:12px;color:#5f6670">' + esc(sub) + '</div>' : '') + '</td>';

function render(d, ai) {
  const am = d.kind === 'am', pct = d.goal ? Math.round(d.mtd / d.goal * 100) : null, pace = Math.round(d.pace * 100);
  const proj = d.goal ? k(d.projection) + (d.projection >= d.goal ? ' (above the goal)' : ' (' + Math.round(d.projection / d.goal * 100) + '% of the goal)') : k(d.projection);
  let h = '';
  if (ai) h += '<p style="margin:0 0 6px;padding:14px 16px;background:#fff7ec;border-radius:12px;border-left:4px solid #f08a24">' + esc(ai.summary).replace(/\n/g, '<br>') + '</p>' + (ai.priorities && ai.priorities.length ? h3(am ? 'Start with' : 'Tomorrow, start with') + ul(ai.priorities.map(esc)) : '');
  h += '<table role="presentation" cellpadding="0" cellspacing="6" style="margin:14px -6px 0;width:100%"><tr>' +
    stat(am ? 'Yesterday' : 'Today', k(d.dayNet), d.dayOrders + ' order' + (d.dayOrders === 1 ? '' : 's')) +
    stat('Month so far', k(d.mtd), d.goal ? pct + '% of ' + k(d.goal) + ' · month is ' + pace + '% done' : 'no monthly goal set') +
    stat('Month forecast', k(d.projection), d.goal ? (d.projection >= d.goal ? 'on track' : 'behind the goal') : 'at the current pace') + '</tr></table>';
  h += '<p style="margin:8px 0 0;font-size:13px;color:#5f6670">At the current daily pace the month closes near ' + proj + '.</p>';
  const sp = Object.keys(d.bySp).sort((a, b) => d.bySp[b] - d.bySp[a]);
  if (sp.length) h += h3(am ? 'Yesterday by salesperson' : 'Today by salesperson') + ul(sp.map((s) => '<b>' + esc(s) + '</b> ' + k(d.bySp[s])));
  if (d.top.length) h += h3('Biggest orders') + ul(d.top.map((t) => esc(t.name || 'Customer') + ' · ' + k(t.v) + (t.number ? ' (' + esc(t.number) + ')' : '')));
  if (!am) {
    if (d.won.length || d.lost.length) h += h3('Deals closed today') + ul(d.won.map((w) => 'Won: ' + esc(w.name) + ' · ' + k(w.v)).concat(d.lost.map((l) => 'Lost: ' + esc(l.name) + ' · ' + k(l.v))));
    const who = Object.keys(d.activity); if (who.length) h += h3('Team activity logged today') + ul(who.map((w) => '<b>' + esc(w) + '</b> ' + d.activity[w] + ' entr' + (d.activity[w] === 1 ? 'y' : 'ies')));
  }
  h += h3('Pipeline') + '<p style="margin:0">' + d.open + ' open deal' + (d.open === 1 ? '' : 's') + ' worth ' + k(d.pipeVal) + (d.newLeads ? ' · ' + d.newLeads + ' new ' + (am ? 'since yesterday' : 'today') : '') + '.</p>';
  if (d.quotes.length) h += h3('Quotes waiting 3+ days') + ul(d.quotes.map((q) => esc(q.name) + ' · ' + k(q.v) + ' · ' + q.days + ' days' + (q.owner ? ' · ' + esc(q.owner) : '')));
  if (d.stale.length) h += h3('Open deals gone quiet (5+ days)') + ul(d.stale.map((q) => esc(q.name) + ' · ' + k(q.v) + ' · ' + q.days + ' days' + (q.owner ? ' · ' + esc(q.owner) : '')));
  h += h3(am ? 'Follow-ups for today' : 'Follow-ups for tomorrow') + '<p style="margin:0 0 6px">' + (d.overdue ? '<b style="color:#d32a37">' + d.overdue + ' overdue</b> · ' : '') + (am ? d.dueToday : d.dueTomorrow) + ' due' + (am ? ' today' : ' tomorrow') + '.</p>' + ul(d.overdueList.map((o) => 'Overdue: ' + esc(o.deal) + ' · ' + esc(o.body) + ' (' + esc(o.due) + ')').concat(d.dueList.map((o) => esc(o.deal) + ' · ' + esc(o.body))));
  return h;
}

// plain-rule priorities used when the AI is off, so the briefing is never empty
function rules(d) {
  const p = [];
  if (d.overdue) p.push('Clear ' + d.overdue + ' overdue follow-up' + (d.overdue === 1 ? '' : 's') + (d.overdueList[0] ? ', starting with ' + d.overdueList[0].deal : '') + '.');
  if (d.quotes[0]) p.push('Call ' + d.quotes[0].name + ': a ' + k(d.quotes[0].v) + ' quote has been waiting ' + d.quotes[0].days + ' days.');
  if (d.stale[0]) p.push('Re-engage ' + d.stale[0].name + ' (' + k(d.stale[0].v) + ', quiet for ' + d.stale[0].days + ' days).');
  if (d.goal && d.projection < d.goal) p.push('The month is forecast ' + k(d.goal - d.projection) + ' short of the goal: look at the biggest open deals.');
  return p.slice(0, 4);
}

const AI_KEY = () => process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
async function narrate(d) {
  if (process.env.DASH_AI !== '1' || !AI_KEY()) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const prompt = 'You write the ' + (d.kind === 'am' ? 'morning briefing for today' : 'evening report for the day') + ' for the manager of a B2B diesel parts wholesaler. Use only these numbers, never invent any. Plain English, direct, no filler. Return JSON only: {"summary": "3 to 5 sentences: what matters and why, include the month forecast against the goal", "priorities": ["up to 4 concrete actions, each naming a customer or a number"]}.\nDATA: ' + JSON.stringify(d);
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + AI_KEY(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.DASH_AI_MODEL || 'anthropic/claude-sonnet-5.5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) return null;
    const j = await r.json(), txt = String(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || ''), m = txt.match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : null;
    return o && o.summary ? { summary: String(o.summary).slice(0, 900), priorities: Array.isArray(o.priorities) ? o.priorities.slice(0, 4).map((x) => String(x).slice(0, 220)) : [] } : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function build(kind, now) {
  const d = await collect(kind, now || new Date());
  const ai = await narrate(d);
  const body = render(d, ai || (rules(d).length ? { summary: d.kind === 'am' ? 'Here is what is on the table today.' : 'Here is how the day went.', priorities: rules(d) } : null));
  const title = (kind === 'am' ? 'Morning briefing' : 'Evening report') + ' · ' + new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(now || new Date());
  return { kind, title, subject: title + ' · ' + k(d.dayNet) + (kind === 'am' ? ' yesterday' : ' today'), html: body, data: d, ai: !!ai };
}

module.exports = { build, hourNY, ymd };
