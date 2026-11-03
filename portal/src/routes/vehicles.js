// /api/dealers/:dealerId/vehicles: the dealer's cars and their photos. Viewers read; owners, admins and approvers add,
// edit and remove cars and photos. Photo uploads are JPEG bodies (lib/photos.js); everything else is JSON.
import express, { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { accessChecks } from '../lib/access.js';
import { createVehicle, getVehicle, listVehicles, orderPhotos, removeVehicle, updateVehicle, vehicleView } from '../lib/vehicles.js';
import { addPhoto, deletePhoto, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, photoPath, setThumb } from '../lib/photos.js';
import { decodeVin } from '../lib/vin.js';

export function vehicleRoutes({ pool, config, fetchFn }) {
  const r = Router();
  const { dealerAccess } = accessChecks(pool);
  const jpeg = (limit) => express.raw({ type: 'image/jpeg', limit });
  const photoOf = (vehicle, id) => {
    const p = vehicle.photos.find((x) => x.id === Number(id));
    if (!p) throw new HttpError(404, 'Photo not found.');
    return p;
  };

  r.get('/:dealerId/vehicles', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ vehicles: await listVehicles(pool, dealer.id) });
  });

  r.post('/:dealerId/vehicles', async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'approver');
    const id = await createVehicle(pool, dealer.id, req.body);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'vehicle_add', targetType: 'vehicle', targetId: id, details: { vin: String(req.body?.vin ?? '').toUpperCase() }, ip: req.ip });
    res.status(201).json({ vehicle: vehicleView(await getVehicle(pool, dealer.id, id)) });
  });

  r.get('/:dealerId/vin/:vin', async (req, res) => {
    await dealerAccess(req, 'approver');
    res.json({ vehicle: await decodeVin(req.params.vin, fetchFn) });
  });

  r.get('/:dealerId/vehicles/:vehicleId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ vehicle: vehicleView(await getVehicle(pool, dealer.id, req.params.vehicleId)) });
  });

  r.patch('/:dealerId/vehicles/:vehicleId', async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'approver');
    const vehicle = await getVehicle(pool, dealer.id, req.params.vehicleId);
    const changed = await updateVehicle(pool, vehicle, req.body);
    if (changed.length) await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'vehicle_edit', targetType: 'vehicle', targetId: vehicle.id, details: { fields: changed }, ip: req.ip });
    res.json({ vehicle: vehicleView(await getVehicle(pool, dealer.id, vehicle.id)) });
  });

  r.delete('/:dealerId/vehicles/:vehicleId', async (req, res) => {
    const { user, dealer } = await dealerAccess(req, 'approver');
    const vehicle = await getVehicle(pool, dealer.id, req.params.vehicleId);
    await removeVehicle(pool, vehicle);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'vehicle_remove', targetType: 'vehicle', targetId: vehicle.id, details: { vin: vehicle.vin }, ip: req.ip });
    res.json({ ok: true });
  });

  r.post('/:dealerId/vehicles/:vehicleId/photos', jpeg(MAX_PHOTO_BYTES), async (req, res) => {
    const { dealer } = await dealerAccess(req, 'approver');
    const vehicle = await getVehicle(pool, dealer.id, req.params.vehicleId);
    const id = await addPhoto(pool, config.uploadDir, vehicle, req.body);
    res.status(201).json({ photo_id: id });
  });

  r.post('/:dealerId/vehicles/:vehicleId/photos/:photoId/thumb', jpeg(MAX_THUMB_BYTES), async (req, res) => {
    const { dealer } = await dealerAccess(req, 'approver');
    const vehicle = await getVehicle(pool, dealer.id, req.params.vehicleId);
    await setThumb(pool, config.uploadDir, photoOf(vehicle, req.params.photoId), req.body);
    res.json({ ok: true });
  });

  r.put('/:dealerId/vehicles/:vehicleId/photos/order', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'approver');
    await orderPhotos(pool, await getVehicle(pool, dealer.id, req.params.vehicleId), req.body?.ids);
    res.json({ vehicle: vehicleView(await getVehicle(pool, dealer.id, req.params.vehicleId)) });
  });

  r.delete('/:dealerId/vehicles/:vehicleId/photos/:photoId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'approver');
    const vehicle = await getVehicle(pool, dealer.id, req.params.vehicleId);
    await deletePhoto(pool, config.uploadDir, vehicle, photoOf(vehicle, req.params.photoId));
    res.json({ ok: true });
  });

  // An uploaded photo (?size=thumb for the thumbnail; the full photo once copied to our server is the thumbnail too).
  r.get('/:dealerId/vehicles/:vehicleId/photos/:photoId', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    const photo = photoOf(await getVehicle(pool, dealer.id, req.params.vehicleId), req.params.photoId);
    if (photo.url) return res.redirect(photo.url);
    const wantThumb = req.query.size === 'thumb';
    const path = (wantThumb && photoPath(config.uploadDir, photo.thumb_name)) || photoPath(config.uploadDir, photo.file_name) || photoPath(config.uploadDir, photo.thumb_name);
    if (!path) throw new HttpError(404, 'Photo not found.');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('image/jpeg').sendFile(path);
  });

  return r;
}
