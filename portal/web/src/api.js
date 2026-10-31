// Calls the portal's JSON API with the session cookie; every change carries the CSRF token from sign-in or /me.
let csrf = '';

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (data.csrf) csrf = data.csrf;
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
