// Dashboard actions: POST /api/node/<action> with this session's CSRF token (put in the page by the server).
export const boot = window.GA ?? { csrf: '', env: '', banner: '' };

async function responseJson(r) {
  const raw = await r.text();
  let d;
  try { d = JSON.parse(raw); } catch { throw Error('Server returned HTTP ' + r.status + ' without valid JSON. Check the Node service log.'); }
  if (r.status === 401) { location.reload(); throw Error(d.error || 'Sign in again.'); }
  if (!r.ok) throw Error(d.error || 'Request failed (HTTP ' + r.status + ')');
  return d;
}
export async function api(action, data = {}) {
  const r = await fetch('/api/node/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': boot.csrf }, body: JSON.stringify(data) });
  return responseJson(r);
}
/** Multipart actions (file uploads): import, spokesperson_upload, footage_build. */
export async function upload(action, form) {
  const r = await fetch('/api/node/' + action, { method: 'POST', headers: { 'X-CSRF-Token': boot.csrf }, body: form });
  return responseJson(r);
}
