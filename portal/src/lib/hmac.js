// Worker request signing (docs/lotspotlight-architecture.md §5): X-Signature = hex HMAC-SHA256 over
// timestamp \n METHOD \n path \n sha256(body), keyed with the worker's secret. The worker side is node/src/lib/portal-client.js.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SKEW_SECONDS = 300;
export const MIN_SECRET_LENGTH = 32;

export const bodyHash = (body) => createHash('sha256').update(body ?? '').digest('hex');

export function signature(secret, timestamp, method, path, body) {
  return createHmac('sha256', secret).update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash(body)}`).digest('hex');
}

/** "workerA:secret,workerB:secret" → Map(id → secret). Short secrets are refused so a weak one never goes live. */
export function parseWorkerSecrets(text) {
  const out = new Map();
  for (const part of String(text).split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const id = part.slice(0, i).trim(), secret = part.slice(i + 1).trim();
    if (i < 1 || !/^[\w.-]{1,64}$/.test(id)) throw new Error('WORKER_SHARED_SECRETS: each entry must be workerId:secret');
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`WORKER_SHARED_SECRETS: the secret for ${id} is shorter than ${MIN_SECRET_LENGTH} characters`);
    out.set(id, secret);
  }
  return out;
}

/** Checks a worker request. Returns { ok: true, workerId } or { ok: false, reason } (the reason is for logs, not the reply). */
export function verifyWorkerRequest({ secrets, headers, method, path, body, now = Date.now() / 1000 }) {
  const workerId = String(headers['x-worker-id'] ?? '');
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '');
  const secret = secrets.get(workerId);
  if (!secret) return { ok: false, reason: 'unknown worker' };
  if (!/^\d{1,12}$/.test(ts) || Math.abs(now - Number(ts)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'timestamp outside 300 s' };
  if (!/^[a-f0-9]{64}$/.test(sig)) return { ok: false, reason: 'malformed signature' };
  const expected = Buffer.from(signature(secret, ts, method, path, body), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return { ok: false, reason: 'bad signature' };
  return { ok: true, workerId };
}
