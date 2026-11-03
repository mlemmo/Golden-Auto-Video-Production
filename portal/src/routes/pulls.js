// Website pulls (lib/pulls.js): owners, admins and approvers start one and keep it going batch by batch from their
// browser; viewers see the latest one. eShield staff import a browser snapshot for sites that block automatic reading.
import { Router } from 'express';
import { audit } from '../lib/audit.js';
import { accessChecks } from '../lib/access.js';
import { HttpError } from '../lib/errors.js';
import { continuePull, latestPull, pullView, snapshotCars, startPull } from '../lib/pulls.js';
import { syncInventory } from '../lib/inventory.js';

export function pullRoutes({ pool, siteFetch }) {
  const r = Router();
  const { dealerAccess } = accessChecks(pool);

  r.get('/:dealerId/pulls/latest', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ pull: pullView(await latestPull(pool, dealer.id)) });
  });

  r.post('/:dealerId/pulls', async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'approver');
    const pull = await startPull(pool, dealer, user, siteFetch);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'website_pull', targetType: 'pull', targetId: pull.id, details: { status: pull.status }, ip: req.ip });
    res.status(201).json({ pull: pullView(pull) });
  });

  r.post('/:dealerId/pulls/:pullId/continue', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'approver');
    res.json({ pull: pullView(await continuePull(pool, dealer.id, req.params.pullId, siteFetch)) });
  });

  return r;
}

/** /api/staff/dealers/:dealerId/snapshot: a browser snapshot (tools/inventory-snapshot.js) for a site that blocks us. */
export function snapshotRoutes({ pool }) {
  const r = Router();
  const { staffOnly } = accessChecks(pool);
  r.post('/dealers/:dealerId/snapshot', async (req, res) => {
    const user = staffOnly(req);
    const dealerId = Number(req.params.dealerId);
    const [rows] = Number.isSafeInteger(dealerId) ? await pool.query('SELECT id FROM dealers WHERE id = ?', [dealerId]) : [[]];
    if (!rows.length) throw new HttpError(404, 'Dealer not found.');
    const { cars, skipped } = snapshotCars(req.body?.snapshot);
    const result = await syncInventory(pool, dealerId, cars, { complete: req.body?.complete !== false });
    await audit(pool, { dealerId, userId: user.id, action: 'snapshot_import', targetType: 'dealer', targetId: dealerId, details: { ...result, skipped: skipped.length }, ip: req.ip });
    res.json({ ...result, skipped });
  });
  return r;
}
