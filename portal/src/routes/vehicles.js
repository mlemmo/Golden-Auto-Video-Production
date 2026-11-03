// /api/dealers/:dealerId/…: the dealer's cars. website-cars reads their website live (lib/listing.js, nothing is
// saved); vehicles are their cars with videos (stored when ordered); uploads are photos for an order being filled in.
// Everyone at the dealer reads; owners and admins (who order) upload photos.
import express, { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { accessChecks } from '../lib/access.js';
import { getVehicle, listVehicles, vehicleView } from '../lib/vehicles.js';
import { addUpload, deleteUpload, getUpload, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, photoPath, setThumb } from '../lib/photos.js';
import { decodeVin } from '../lib/vin.js';
import { websiteListing } from '../lib/listing.js';

export function vehicleRoutes({ pool, config, fetchFn, siteFetch }) {
  const r = Router();
  const { dealerAccess } = accessChecks(pool);
  const listing = websiteListing(siteFetch);
  const jpeg = (limit) => express.raw({ type: 'image/jpeg', limit });

  // The cars on the dealer's website now (held 15 minutes in memory; ?fresh=1 reads again), each marked when it
  // already has an order.
  r.get('/:dealerId/website-cars', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    const read = await listing.forDealer(dealer, { fresh: req.query.fresh === '1' });
    const ordered = new Map((await listVehicles(pool, dealer.id)).map((v) => [v.vin, v]));
    res.json({ ...read, cars: read.cars.map((c) => ({ ...c, vehicle_id: ordered.get(c.vin)?.id ?? null, order_status: ordered.get(c.vin)?.order_status ?? null })) });
  });

  r.get('/:dealerId/vehicles', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ vehicles: await listVehicles(pool, dealer.id) });
  });

  r.get('/:dealerId/vehicles/:vehicleId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ vehicle: vehicleView(await getVehicle(pool, dealer.id, req.params.vehicleId)) });
  });

  r.get('/:dealerId/vin/:vin', async (req, res) => {
    await dealerAccess(req, 'admin');
    res.json({ vehicle: await decodeVin(req.params.vin, fetchFn) });
  });

  r.post('/:dealerId/uploads', jpeg(MAX_PHOTO_BYTES), async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'admin');
    res.status(201).json({ photo_id: await addUpload(pool, config.uploadDir, dealer.id, user.id, req.body) });
  });

  r.post('/:dealerId/uploads/:photoId/thumb', jpeg(MAX_THUMB_BYTES), async (req, res) => {
    const { dealer } = await dealerAccess(req, 'admin');
    await setThumb(pool, config.uploadDir, await getUpload(pool, dealer.id, req.params.photoId), req.body);
    res.json({ ok: true });
  });

  r.delete('/:dealerId/uploads/:photoId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'admin');
    await deleteUpload(pool, config.uploadDir, await getUpload(pool, dealer.id, req.params.photoId));
    res.json({ ok: true });
  });

  // An uploaded photo (?size=thumb for the thumbnail; once our server has copied the full photo, the thumbnail).
  r.get('/:dealerId/photos/:photoId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    const photo = await getUpload(pool, dealer.id, req.params.photoId);
    const wantThumb = req.query.size === 'thumb';
    const path = (wantThumb && photoPath(config.uploadDir, photo.thumb_name)) || photoPath(config.uploadDir, photo.file_name) || photoPath(config.uploadDir, photo.thumb_name);
    if (!path) throw new HttpError(404, 'Photo not found.');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('image/jpeg').sendFile(path);
  });

  return r;
}
