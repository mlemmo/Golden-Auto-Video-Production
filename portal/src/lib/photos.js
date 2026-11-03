// Car photos customers upload while filling in an order. The browser shrinks each photo (longest side 2400 px) and
// re-saves it as JPEG before sending, so the portal stores only JPEG files: a full photo of at most 10 MB and a
// thumbnail of at most 300 KB, under random names in UPLOAD_DIR. An upload belongs to the dealer until an order uses it
// (then to the ordered car); unused uploads are deleted after a day. Once our server has copied an order's photos the
// full files are deleted here; the thumbnails stay.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './errors.js';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_THUMB_BYTES = 300 * 1024;
const MAX_WAITING = 60;   // unused uploads per dealer at a time
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

export function removeFiles(uploadDir, photos) {
  for (const p of photos) for (const name of [p.file_name, p.thumb_name]) {
    const path = photoPath(uploadDir, name);
    if (path) unlinkSync(path);
  }
}

/** Deletes this dealer's uploads that no order used within a day. */
async function clearOld(db, uploadDir, dealerId) {
  const [old] = await db.query('SELECT id, file_name, thumb_name FROM vehicle_photos WHERE dealer_id = ? AND vehicle_id IS NULL AND created_at < NOW(3) - INTERVAL 1 DAY', [dealerId]);
  if (!old.length) return;
  await db.query('DELETE FROM vehicle_photos WHERE id IN (?)', [old.map((p) => p.id)]);
  removeFiles(uploadDir, old);
}

/** Stores a photo for an order being filled in; returns its id (sent with the order as upload_id). */
export async function addUpload(db, uploadDir, dealerId, userId, buf) {
  await clearOld(db, uploadDir, dealerId);
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM vehicle_photos WHERE dealer_id = ? AND vehicle_id IS NULL', [dealerId]);
  if (Number(n) >= MAX_WAITING) throw new HttpError(409, 'Too many photos are waiting for an order. Place the order, or try again tomorrow.');
  const name = store(uploadDir, buf, MAX_PHOTO_BYTES, '10 MB');
  try {
    const [r] = await db.query('INSERT INTO vehicle_photos (vehicle_id, dealer_id, uploaded_by, position, file_name, bytes) VALUES (NULL,?,?,0,?,?)', [dealerId, userId, name, buf.length]);
    return r.insertId;
  } catch (err) {
    removeFiles(uploadDir, [{ file_name: name }]);
    throw err;
  }
}

/** One uploaded photo of this dealer (attached to a car or not), or a 404. */
export async function getUpload(db, dealerId, id) {
  const [rows] = await db.query('SELECT * FROM vehicle_photos WHERE id = ? AND dealer_id = ? AND url IS NULL', [Number(id) || 0, dealerId]);
  if (!rows.length) throw new HttpError(404, 'Photo not found.');
  return rows[0];
}

export async function setThumb(db, uploadDir, photo, buf) {
  const name = store(uploadDir, buf, MAX_THUMB_BYTES, '300 KB');
  await db.query('UPDATE vehicle_photos SET thumb_name = ? WHERE id = ?', [name, photo.id]);
  removeFiles(uploadDir, [{ thumb_name: photo.thumb_name }]);
}

/** Removes an upload that no order uses yet (a photo of an ordered car changes with the next order instead). */
export async function deleteUpload(db, uploadDir, photo) {
  if (photo.vehicle_id) throw new HttpError(409, 'This photo belongs to an ordered car. Leave it out of the next order instead.');
  await db.query('DELETE FROM vehicle_photos WHERE id = ?', [photo.id]);
  removeFiles(uploadDir, [photo]);
}

/** Our server has these uploads: delete the full files, keep the thumbnails (a photo without one keeps its full file). */
export async function photosCopied(db, uploadDir, photos) {
  for (const p of photos) {
    if (p.url || p.copied_at || !p.thumb_name) continue;
    await db.query('UPDATE vehicle_photos SET copied_at = NOW(3), file_name = NULL WHERE id = ?', [p.id]);
    removeFiles(uploadDir, [{ file_name: p.file_name }]);
  }
}
