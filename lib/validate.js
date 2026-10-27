const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200); }
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
module.exports = { EMAIL, clean, readBody };
