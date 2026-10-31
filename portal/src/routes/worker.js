// /api/worker: the job API the worker calls (docs/lotspotlight-architecture.md §5). Every request must carry a valid
// HMAC signature (lib/hmac.js); the body is read raw so the signature covers the exact bytes sent.
import express, { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { verifyWorkerRequest } from '../lib/hmac.js';
import { leaseJobs, heartbeat, completeJob, failJob } from '../lib/jobs.js';
import { syncInventory } from '../lib/inventory.js';

export function workerRoutes({ pool, config }) {
  const r = Router();
  r.use(express.raw({ type: () => true, limit: '5mb' }));

  r.use((req, res, next) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = verifyWorkerRequest({ secrets: config.workerSecrets, headers: req.headers, method: req.method, path: req.originalUrl, body: raw });
    if (!check.ok) {
      console.warn(`worker request refused (${check.reason}) from ${req.ip}: ${req.method} ${req.originalUrl}`);
      throw new HttpError(401, 'Unauthorized worker request.');
    }
    req.workerId = check.workerId;
    try {
      req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      throw new HttpError(400, 'Body must be JSON.');
    }
    next();
  });

  const jobId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'No such job.');
    return id;
  };
  const leaseLost = () => new HttpError(409, 'This worker no longer holds the lease for that job.');

  r.post('/jobs/lease', async (req, res) => {
    const jobs = await leaseJobs(pool, req.workerId, req.body?.types, req.body?.max ?? 1);
    if (!jobs.length) return res.status(204).end();
    res.json({ jobs });
  });

  r.post('/jobs/:id/heartbeat', async (req, res) => {
    if (!await heartbeat(pool, jobId(req), req.workerId)) throw leaseLost();
    res.json({ ok: true });
  });

  r.post('/jobs/:id/complete', async (req, res) => {
    if (!await completeJob(pool, jobId(req), req.workerId, req.body?.result)) throw leaseLost();
    res.json({ ok: true });
  });

  r.post('/jobs/:id/fail', async (req, res) => {
    if (!await failJob(pool, jobId(req), req.workerId, req.body?.error, req.body?.retryable !== false)) throw leaseLost();
    res.json({ ok: true });
  });

  r.post('/inventory/sync', async (req, res) => {
    const dealerId = Number(req.body?.dealer_id);
    const [rows] = Number.isSafeInteger(dealerId) ? await pool.query('SELECT id FROM dealers WHERE id = ?', [dealerId]) : [[]];
    if (!rows.length) throw new HttpError(404, 'Dealer not found.');
    res.json(await syncInventory(pool, dealerId, req.body?.vehicles, { complete: req.body?.complete === true }));
  });

  r.get('/dealers/:id/config', async (req, res) => {
    const [rows] = await pool.query('SELECT id, name, slug, website, timezone, status, spokesperson_id, voice_id, brand_json AS brand FROM dealers WHERE id = ?', [Number(req.params.id) || 0]);
    if (!rows.length) throw new HttpError(404, 'Dealer not found.');
    res.json({ dealer: rows[0], disclaimer: 'Plus tax, title and fees. See dealer for details.' });
  });

  return r;
}
