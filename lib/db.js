// Supabase (Postgres) access for the portal, over PostgREST with the server-side secret key. No extra packages.
// The secret key bypasses RLS, so it must only ever run in these functions, never in the browser.
const URL_ = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_KEY || '';
const configured = () => !!(URL_() && KEY());

async function call(method, path, { body, headers, timeoutMs } = {}) {
  if (!configured()) throw new Error('database not configured');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(URL_() + '/rest/v1/' + path, {
      method, signal: ctl.signal,
      headers: Object.assign({ apikey: KEY(), Authorization: 'Bearer ' + KEY(), 'Content-Type': 'application/json' }, headers || {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) { const e = new Error('db ' + r.status + ' ' + (data && data.message ? data.message : String(text).slice(0, 200))); e.status = r.status; e.code = data && data.code; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

// select: table + PostgREST query string, e.g. select('users', 'email=eq.a@b.com&select=*')
const select = (table, qs) => call('GET', table + (qs ? '?' + qs : ''));
const insert = (table, rows, opts) => call('POST', table + (opts && opts.onConflict ? '?on_conflict=' + opts.onConflict : ''), { body: rows,
  headers: { Prefer: 'return=representation' + (opts && opts.ignoreDuplicates ? ',resolution=ignore-duplicates' : opts && opts.onConflict ? ',resolution=merge-duplicates' : '') } });
const update = (table, qs, patch) => call('PATCH', table + '?' + qs, { body: patch, headers: { Prefer: 'return=representation' } });
const remove = (table, qs) => call('DELETE', table + '?' + qs, { headers: { Prefer: 'return=minimal' } });
const rpc = (fn, args) => call('POST', 'rpc/' + fn, { body: args || {} });

// every row, 1000 at a time (PostgREST caps a single response at 1000 rows)
async function selectAll(table, qs, max) {
  const out = []; max = max || 50000;
  for (let off = 0; off < max; off += 1000) {
    const rows = await select(table, (qs ? qs + '&' : '') + 'limit=1000&offset=' + off);
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

module.exports = { configured, select, selectAll, insert, update, remove, rpc };
