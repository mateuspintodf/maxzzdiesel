// Minimal Unleashed API client (HMAC-SHA256 signature of the query string). Keys come from the environment only.
const crypto = require('crypto');
const API = 'https://api.unleashedsoftware.com';

function configured() { return !!(process.env.UNLEASHED_API_ID && process.env.UNLEASHED_API_KEY); }

async function ul(path, query = '', { timeoutMs = 25000, method = 'GET', body } = {}) {
  const id = process.env.UNLEASHED_API_ID, key = process.env.UNLEASHED_API_KEY;
  if (!id || !key) throw new Error('Unleashed not configured');
  const sig = crypto.createHmac('sha256', key).update(query).digest('base64');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}/${path}${query ? '?' + query : ''}`, {
      signal: ctl.signal, method, body: body ? JSON.stringify(body) : undefined,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'api-auth-id': id, 'api-auth-signature': sig, 'client-type': 'maxzzdiesel/website' }
    });
    if (!r.ok) throw new Error('Unleashed ' + r.status + ' on ' + path.split('/')[0]);
    return r.json();
  } finally { clearTimeout(t); }
}

module.exports = { ul, configured };
