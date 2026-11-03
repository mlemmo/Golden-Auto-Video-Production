// Car photos customers upload. The browser shrinks each photo (longest side 2400 px) and re-saves it as JPEG before
// sending, so the portal stores only JPEG files: a full photo of at most 10 MB and a thumbnail of at most 300 KB, under
// random names in UPLOAD_DIR. Once our server has copied the full photo it is deleted here; the thumbnail stays.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './errors.js';
import { MAX_PHOTOS, markPhotosEdited } from './vehicles.js';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_THUMB_BYTES = 300 * 1024;
const NAME = /^[a-f0-9]{40}\.jpg$/;

const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

function store(uploadDir, buf, max, limit) {
  if (!isJpeg(buf)) throw new HttpError(415, 'Photos must be sent as JPEG.');
  if (buf.length > max) throw new HttpError(413, `That photo is too large (up to ${limit}).`);
  mkdirSync(uploadDir, { recursive: true, mode: 0o750 });
  const name = randomBytes(20).toString('hex') + '.jpg';
  writeFileSync(join(uploadDir, name), buf, { mode: 0o640 });
  return name;
}

/** Path of a stored file, or null for a missing or malformed name. */
export function photoPath(uploadDir, name) {
  if (!NAME.test(String(name ?? ''))) return null;
  const path = join(uploadDir, name);
  return existsSync(path) ? path : null;
}

function remove(uploadDir, name) {
  const path = photoPath(uploadDir, name);
  if (path) unlinkSync(path);
}

/** Adds an uploaded photo as the car's last photo. */
export async function addPhoto(db, uploadDir, vehicle, buf) {
  if (vehicle.photos.length >= MAX_PHOTOS) throw new HttpError(409, `A car can have up to ${MAX_PHOTOS} photos. Delete one first.`);
  const name = store(uploadDir, buf, MAX_PHOTO_BYTES, '10 MB');
  const position = vehicle.photos.length ? Math.max(...vehicle.photos.map((p) => p.position)) + 1 : 0;
  try {
    const [r] = await db.query('INSERT INTO vehicle_photos (vehicle_id, position, file_name, bytes) VALUES (?,?,?,?)', [vehicle.id, position, name, buf.length]);
    return r.insertId;
  } catch (err) {
    remove(uploadDir, name);
    throw err;
  }
}

export async function setThumb(db, uploadDir, photo, buf) {
  if (photo.url) throw new HttpError(400, 'Only uploaded photos have a thumbnail.');
  const name = store(uploadDir, buf, MAX_THUMB_BYTES, '300 KB');
  await db.query('UPDATE vehicle_photos SET thumb_name = ? WHERE id = ?', [name, photo.id]);
  if (photo.thumb_name) remove(uploadDir, photo.thumb_name);
}

export async function deletePhoto(db, uploadDir, vehicle, photo) {
  await db.query('DELETE FROM vehicle_photos WHERE id = ?', [photo.id]);
  remove(uploadDir, photo.file_name);
  remove(uploadDir, photo.thumb_name);
  await markPhotosEdited(db, vehicle);
}

/** Our server has these uploads: delete the full files, keep the thumbnails (a photo without one keeps its full file). */
export async function photosCopied(db, uploadDir, photos) {
  for (const p of photos) {
    if (p.url || p.copied_at || !p.thumb_name) continue;
    await db.query('UPDATE vehicle_photos SET copied_at = NOW(3), file_name = NULL WHERE id = ?', [p.id]);
    remove(uploadDir, p.file_name);
  }
}
