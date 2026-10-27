// Small HubSpot CRM helper (private app token in HUBSPOT_TOKEN).
const BASE = 'https://api.hubapi.com';
async function hs(pathname, method, body) {
  const r = await fetch(BASE + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.HUBSPOT_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`HubSpot ${method} ${pathname} ${r.status}: ${text.slice(0, 300)}`);
  return data;
}
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { firstname: parts.shift() || '', lastname: parts.join(' ') };
}
async function upsertContact(c) {
  const props = Object.assign({ email: c.email, phone: c.phone || '' }, c.company ? { company: c.company } : {}, splitName(c.name));
  const found = await hs('/crm/v3/objects/contacts/search', 'POST', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: c.email }] }], limit: 1
  });
  if (found.results && found.results[0]) {
    const id = found.results[0].id;
    await hs(`/crm/v3/objects/contacts/${id}`, 'PATCH', { properties: props });
    return id;
  }
  const created = await hs('/crm/v3/objects/contacts', 'POST', { properties: props });
  return created.id;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
async function addNote(html, assoc) {
  return hs('/crm/v3/objects/notes', 'POST', {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: html },
    associations: assoc.map((a) => ({ to: { id: a.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: a.type }] }))
  });
}
module.exports = { hs, upsertContact, addNote, esc };
