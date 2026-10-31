// Job queue in MySQL (docs/lotspotlight-architecture.md §5). A worker leases the oldest queued job for 15 minutes,
// extends the lease with heartbeats, then completes or fails it. Expired leases go back to the queue on the next
// lease call (no cron on SiteGround). A job is tried at most 3 times; retries wait 30 s, 60 s, ….
import { tx, json } from './db.js';

export const JOB_TYPES = ['render_video', 'verify_video', 'sync_inventory', 'rerender_price_drop', 'ping'];
export const LEASE_MINUTES = 15;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_SECONDS = 30;
export const MAX_LEASE_BATCH = 5;

export async function enqueueJob(db, { dealerId, type, payload = null }) {
  if (!JOB_TYPES.includes(type)) throw new Error(`unknown job type ${type}`);
  const [r] = await db.query('INSERT INTO jobs (dealer_id, type, payload_json) VALUES (?,?,?)', [dealerId, type, json(payload)]);
  return r.insertId;
}

export async function getJob(db, id) {
  const [rows] = await db.query('SELECT * FROM jobs WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listJobs(db, dealerId, limit = 50) {
  const [rows] = await db.query(
    'SELECT id, type, status, attempts, leased_by, error, created_at, updated_at FROM jobs WHERE dealer_id = ? ORDER BY id DESC LIMIT ?',
    [dealerId, limit],
  );
  return rows;
}

/** Puts jobs whose lease ran out back in the queue, or fails them once they have used every attempt. */
export async function releaseExpired(db) {
  await db.query(
    `UPDATE jobs SET status = 'failed', error = 'Lease expired on the last attempt.', leased_by = NULL, lease_expires_at = NULL
      WHERE status = 'leased' AND lease_expires_at < NOW(3) AND attempts >= ?`, [MAX_ATTEMPTS]);
  await db.query(
    `UPDATE jobs SET status = 'queued', leased_by = NULL, lease_expires_at = NULL, available_at = NOW(3)
      WHERE status = 'leased' AND lease_expires_at < NOW(3)`);
}

/** Leases up to `max` of the oldest ready jobs of these types to workerId. Returns [] when none are waiting. */
export async function leaseJobs(pool, workerId, types, max = 1) {
  const wanted = (Array.isArray(types) ? types : []).filter((t) => JOB_TYPES.includes(t));
  if (!wanted.length) return [];
  const n = Math.min(Math.max(1, Number(max) || 1), MAX_LEASE_BATCH);
  await releaseExpired(pool);
  return tx(pool, async (conn) => {
    // SKIP LOCKED: two workers asking at once get different jobs instead of waiting on each other.
    const [rows] = await conn.query(
      `SELECT id FROM jobs WHERE status = 'queued' AND type IN (?) AND available_at <= NOW(3)
        ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`, [wanted, n]);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await conn.query(
      `UPDATE jobs SET status = 'leased', leased_by = ?, lease_expires_at = NOW(3) + INTERVAL ${LEASE_MINUTES} MINUTE, attempts = attempts + 1
        WHERE id IN (?)`, [workerId, ids]);
    const [jobs] = await conn.query('SELECT id, dealer_id, type, payload_json AS payload, attempts, lease_expires_at FROM jobs WHERE id IN (?) ORDER BY id', [ids]);
    return jobs;
  });
}

// Each change below only applies while this worker still holds the lease; false means the lease was lost
// (expired and handed to someone else, or the job already finished).
const HELD = "status = 'leased' AND leased_by = ? AND lease_expires_at >= NOW(3)";

export async function heartbeat(db, id, workerId) {
  const [r] = await db.query(`UPDATE jobs SET lease_expires_at = NOW(3) + INTERVAL ${LEASE_MINUTES} MINUTE WHERE id = ? AND ${HELD}`, [id, workerId]);
  return r.affectedRows === 1;
}

export async function completeJob(pool, id, workerId, result) {
  return tx(pool, async (conn) => {
    const [r] = await conn.query(`UPDATE jobs SET status = 'done', result_json = ?, error = NULL, lease_expires_at = NULL WHERE id = ? AND ${HELD}`, [json(result ?? {}), id, workerId]);
    if (r.affectedRows !== 1) return false;
    // Milestone 2 adds per-type follow-ups here (render_video → videos row, verify_video → verifications row).
    return true;
  });
}

/** Retryable failures go back to the queue with backoff until MAX_ATTEMPTS; others (and the last try) fail for good. */
export async function failJob(db, id, workerId, error, retryable) {
  const message = String(error ?? 'Unknown error').slice(0, 4000);
  const [r] = await db.query(
    `UPDATE jobs SET
        status = IF(? AND attempts < ?, 'queued', 'failed'),
        available_at = IF(? AND attempts < ?, NOW(3) + INTERVAL (? * POW(2, attempts - 1)) SECOND, available_at),
        leased_by = IF(? AND attempts < ?, NULL, leased_by),
        lease_expires_at = NULL, error = ?
      WHERE id = ? AND ${HELD}`,
    [!!retryable, MAX_ATTEMPTS, !!retryable, MAX_ATTEMPTS, RETRY_BASE_SECONDS, !!retryable, MAX_ATTEMPTS, message, id, workerId]);
  return r.affectedRows === 1;
}
