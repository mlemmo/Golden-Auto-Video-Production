// /api/worker: the job API the worker calls (docs/lotspotlight-architecture.md §5). Every request must carry a valid
// HMAC signature (lib/hmac.js); the body is read raw so the signature covers the exact bytes sent.
import express, { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { verifyWorkerRequest } from '../lib/hmac.js';
import { leaseJobs, heartbeat, completeJob, failJob } from '../lib/jobs.js';
import { syncInventory } from '../lib/inventory.js';
import { getOrder, listOrders, moveOrder, orderView, statusFilter } from '../lib/orders.js';
import { photoPath, photosCopied } from '../lib/photos.js';

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

  // ---- Orders, for the "Customer orders" section of the video app (Milestone 2) ----

  const orderId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'Order not found.');
    return id;
  };

  r.get('/orders', async (req, res) => {
    res.json({ orders: (await listOrders(pool, { statuses: statusFilter(req.query.status) ?? ['paid', 'in_progress'] })).map(orderView) });
  });

  /** The order with each photo as the worker gets it: a website link, or a portal path while the upload is here. */
  const orderPhotos = async (order) => {
    const ids = (orderView(order).vehicle.photos ?? []).map((p) => p.id);
    const [rows] = ids.length ? await pool.query('SELECT * FROM vehicle_photos WHERE id IN (?)', [ids]) : [[]];
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  };

  r.get('/orders/:id', async (req, res) => {
    const order = await getOrder(pool, orderId(req));
    const photos = (await orderPhotos(order)).map((p) => (p.url ? { id: p.id, url: p.url }
      : { id: p.id, path: p.file_name ? `/api/worker/orders/${order.id}/photos/${p.id}` : null, copied_at: p.copied_at }));
    res.json({ order: orderView(order), photos });
  });

  r.get('/orders/:id/photos/:photoId', async (req, res) => {
    const order = await getOrder(pool, orderId(req));
    const photo = (await orderPhotos(order)).find((p) => p.id === Number(req.params.photoId));
    const path = photo && !photo.url ? photoPath(config.uploadDir, photo.file_name) : null;
    if (!path) throw new HttpError(404, 'That photo is not on the portal.');
    res.type('image/jpeg').sendFile(path);
  });

  // The worker opened the order in the video app: in progress, and where (studio_ref). Opening it again is fine.
  r.post('/orders/:id/claim', async (req, res) => {
    const order = await getOrder(pool, orderId(req));
    const ref = String(req.body?.studio_ref ?? '').slice(0, 190) || null;
    if (order.status === 'in_progress' && order.claimed_by === req.workerId) return res.json({ order: orderView(order) });
    await moveOrder(pool, order.id, ['paid'], 'in_progress', { claimed_by: req.workerId, claimed_at: new Date(), studio_ref: ref }, 'Only paid orders can be opened in the studio.');
    res.json({ order: orderView(await getOrder(pool, order.id)) });
  });

  // The worker has these uploaded photos now: the full files are deleted from the portal (thumbnails stay).
  r.post('/orders/:id/photos-copied', async (req, res) => {
    const order = await getOrder(pool, orderId(req));
    const want = new Set((Array.isArray(req.body?.photo_ids) ? req.body.photo_ids : []).map(Number));
    await photosCopied(pool, config.uploadDir, (await orderPhotos(order)).filter((p) => want.has(p.id)));
    res.json({ ok: true });
  });

  r.get('/dealers/:id/config', async (req, res) => {
    const [rows] = await pool.query('SELECT id, name, slug, website, timezone, status, spokesperson_id, voice_id, brand_json AS brand FROM dealers WHERE id = ?', [Number(req.params.id) || 0]);
    if (!rows.length) throw new HttpError(404, 'Dealer not found.');
    res.json({ dealer: rows[0], disclaimer: 'Plus tax, title and fees. See dealer for details.' });
  });

  return r;
}
