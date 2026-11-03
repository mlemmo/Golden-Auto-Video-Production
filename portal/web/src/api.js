// Calls the portal API with the session cookie; every change carries the CSRF token from sign-in or /me.
// VITE_API_BASE (set when building the static site for SiteGround, e.g. https://api.lotspotlight.com) points the pages
// at the API on our server; without it the pages and the API share one address (local runs, `npm run dev`).
const BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const CREDENTIALS = BASE ? 'include' : 'same-origin';
let csrf = '';

/** The full address of an API path, for images the API serves (uploaded car photos). */
export const apiUrl = (path) => (String(path).startsWith('/api/') ? BASE + path : path);

async function answer(res) {
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (data.csrf) csrf = data.csrf;
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: CREDENTIALS,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('The LotSpotlight server is not answering right now. Try again in a few minutes.');
  }
  return answer(res);
}

/** Sends a JPEG (a car photo or its thumbnail). */
export async function upload(path, blob) {
  const res = await fetch(BASE + path, { method: 'POST', credentials: CREDENTIALS, headers: { 'Content-Type': 'image/jpeg', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: blob });
  return answer(res);
}
