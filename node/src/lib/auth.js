// Sign-in for Node routes while the PHP dashboard still owns login: every /api/node/ request (except health) is
// checked by public/node_auth.php with the browser's own cookie and CSRF header. The answer (signed in, selected
// client) is cached for a few seconds per cookie + token + method, so a page load does not ask PHP many times.
import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const cache = new Map();
const TTL_MS = 10_000;

/** Ask PHP who this request belongs to. Returns { client }; throws HttpError(401/403). */
export async function checkAuth(req, authUrl, fetchImpl = fetch) {
  const cookie = String(req.headers.cookie ?? '');
  if (!cookie) throw new HttpError(401, 'Sign in again.');
  const csrf = String(req.headers['x-csrf-token'] ?? '');
  const key = createHash('sha256').update(cookie + '\n' + csrf + '\n' + req.method).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const res = await fetchImpl(authUrl, { headers: { cookie, 'x-csrf-token': csrf, 'x-node-method': req.method }, redirect: 'manual' });
  if (res.status === 401 || res.status === 403) throw new HttpError(res.status, res.status === 401 ? 'Sign in again.' : 'Invalid request.');
  if (res.status !== 200) throw new HttpError(502, 'Sign-in check failed (HTTP ' + res.status + ').');
  const value = await res.json();
  if (typeof value.client !== 'string' || value.client === '') throw new HttpError(502, 'Sign-in check gave no client.');
  for (const [k, v] of cache) if (v.until <= Date.now()) cache.delete(k);
  cache.set(key, { until: Date.now() + TTL_MS, value });
  return value;
}
export function clearAuthCache() { cache.clear(); }
