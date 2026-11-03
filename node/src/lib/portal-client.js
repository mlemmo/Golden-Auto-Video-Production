// Worker side of the LotSpotlight portal job API (docs/lotspotlight-architecture.md §5). The worker always starts the
// connection: it signs each request with its secret (same scheme as portal/src/lib/hmac.js), leases a job, runs the
// handler for its type with a heartbeat every 2 minutes, then reports complete or fail. Free: no paid APIs here.
import { createHash, createHmac } from 'node:crypto';

export const HEARTBEAT_MS = 2 * 60_000;

export function signHeaders(workerId, secret, method, path, body, now = Date.now()) {
  const ts = String(Math.floor(now / 1000));
  const bodyHash = createHash('sha256').update(body ?? '').digest('hex');
  const sig = createHmac('sha256', secret).update(`${ts}\n${method.toUpperCase()}\n${path}\n${bodyHash}`).digest('hex');
  return { 'X-Worker-Id': workerId, 'X-Timestamp': ts, 'X-Signature': sig };
}

/** api = https://app.lotspotlight.com/api/worker; https is required except for a local test portal. */
export function portalClient({ api, workerId, secret, fetchFn = fetch }) {
  const base = new URL(String(api).replace(/\/+$/, '') + '/');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('PORTAL_API must use https');
  if (!workerId || String(secret ?? '').length < 32) throw new Error('WORKER_ID and a WORKER_SECRET of at least 32 characters are required');

  async function send(method, path, payload) {
    const url = new URL(path.replace(/^\//, ''), base);
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const res = await fetchFn(url, {
      method,
      headers: { ...signHeaders(workerId, secret, method, url.pathname + url.search, body), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body || undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`portal ${method} ${url.pathname}: ${res.status} ${data.error ?? ''}`.trim()), { status: res.status });
    }
    return res;
  }
  async function call(method, path, payload) {
    const res = await send(method, path, payload);
    return res.status === 204 ? null : res.json().catch(() => ({}));
  }

  return {
    lease: async (types, max = 1) => (await call('POST', '/jobs/lease', { types, max }))?.jobs ?? [],
    heartbeat: (id) => call('POST', `/jobs/${id}/heartbeat`, {}),
    complete: (id, result) => call('POST', `/jobs/${id}/complete`, { result }),
    fail: (id, error, retryable = true) => call('POST', `/jobs/${id}/fail`, { error, retryable }),
    dealerConfig: (dealerId) => call('GET', `/dealers/${dealerId}/config`),
    // Customer orders (Milestone 2): paid and in-progress orders, one order with its photos, an uploaded photo's
    // bytes, opening it in the studio (claim), and telling the portal which uploads we now have.
    orders: async (statuses = ['paid', 'in_progress']) => (await call('GET', `/orders?status=${statuses.join(',')}`)).orders,
    order: (id) => call('GET', `/orders/${id}`),
    orderPhoto: async (id, photoId) => Buffer.from(await (await send('GET', `/orders/${id}/photos/${photoId}`)).arrayBuffer()),
    claimOrder: async (id, studioRef) => (await call('POST', `/orders/${id}/claim`, { studio_ref: studioRef })).order,
    photosCopied: (id, photoIds) => call('POST', `/orders/${id}/photos-copied`, { photo_ids: photoIds }),
  };
}

/** Job handlers by type: async (job, client) → result object. A thrown error with `retryable: false` is not retried. */
export const HANDLERS = {
  // Milestone 1 round-trip check: answers straight away.
  ping: async (job) => ({ pong: true, received: job.payload ?? null, at: new Date().toISOString() }),
};

/** Leases and runs one job. Returns { id, type, outcome: 'done' | 'failed' } or null when the queue is empty. */
export async function runOnce(client, handlers = HANDLERS, { heartbeatMs = HEARTBEAT_MS, log = () => {} } = {}) {
  const [job] = await client.lease(Object.keys(handlers), 1);
  if (!job) return null;
  log(`job ${job.id} (${job.type}) leased, attempt ${job.attempts}`);
  const timer = setInterval(() => client.heartbeat(job.id).catch((e) => log(`job ${job.id} heartbeat failed: ${e.message}`)), heartbeatMs);
  try {
    const result = await handlers[job.type](job, client);
    await client.complete(job.id, result);
    log(`job ${job.id} done`);
    return { id: job.id, type: job.type, outcome: 'done' };
  } catch (err) {
    // A 409 means the lease was lost while working; another try will happen elsewhere, nothing to report.
    if (err.status === 409) { log(`job ${job.id}: lease lost`); return { id: job.id, type: job.type, outcome: 'lost' }; }
    await client.fail(job.id, err.message, err.retryable !== false);
    log(`job ${job.id} failed: ${err.message}`);
    return { id: job.id, type: job.type, outcome: 'failed' };
  } finally {
    clearInterval(timer);
  }
}
