// Cars with videos: a car is stored only when it is ordered (Sawyer, 2026-11-03), with the details and photos the
// customer ordered it with; ordering it again updates it. A dealer's other cars are read live from their website and
// never saved (lib/listing.js). Website photos stay links (url); uploaded photos are files on the portal
// (lib/photos.js).
import { HttpError } from './errors.js';

export const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const MAX_PHOTOS = 30;
const TEXT = { stock_no: 40, make: 60, model: 80, trim: 120, color: 60, drivetrain: 40, description: 5000, page_url: 500 };
const NAMES = { stock_no: 'stock number', make: 'make', model: 'model', trim: 'trim', color: 'colour', drivetrain: 'drive', description: 'description', page_url: 'car page address' };
export const EDITABLE = ['stock_no', 'year', 'make', 'model', 'trim', 'color', 'drivetrain', 'mileage', 'price', 'description', 'page_url'];
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

export function cleanVin(vin) {
  const v = String(vin ?? '').trim().toUpperCase();
  if (!VIN.test(v)) throw new HttpError(400, 'Enter the 17-character VIN (letters and numbers; never I, O or Q).');
  return v;
}

/** A whole number from a number or text such as "$14,688" or "52,000 mi"; null when empty. */
function wholeNumber(value, label, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]|mi(les)?$/gi, ''));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Enter the ${label} as a number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`);
  return Math.round(n);
}

/** The car's fields, checked: year, make and model are required, the rest optional. */
export function cleanFields(input) {
  const out = {};
  for (const key of EDITABLE) {
    const value = input?.[key];
    if (key === 'year') out.year = wholeNumber(value, 'year', 1900, new Date().getUTCFullYear() + 2);
    else if (key === 'mileage') out.mileage = wholeNumber(value, 'miles', 0, 2_000_000);
    else if (key === 'price') out.price = wholeNumber(value, 'price in whole dollars', 0, 10_000_000);
    else {
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text.length > TEXT[key]) throw new HttpError(400, `The ${NAMES[key]} is too long (up to ${TEXT[key]} characters).`);
      if (key === 'page_url' && text !== '' && !HTTPS.test(text)) throw new HttpError(400, 'The car page address must start with https://');
      out[key] = text === '' ? null : text;
    }
  }
  for (const key of ['year', 'make', 'model']) if (out[key] === null) throw new HttpError(400, `Enter the ${NAMES[key] ?? key}.`);
  return out;
}

/** How the browser shows a photo: the website's own address, or the portal's copy of an upload. */
export function photoView(dealerId, p) {
  const base = `/api/dealers/${dealerId}/photos/${p.id}`;
  return p.url ? { id: p.id, url: p.url, src: p.url, thumb: p.url, uploaded: false } : { id: p.id, src: base, thumb: base + '?size=thumb', uploaded: true };
}

export async function vehiclePhotos(db, vehicleId) {
  const [rows] = await db.query('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY position, id', [vehicleId]);
  return rows;
}

/** The dealer's cars with videos, newest order first, each with its first photo and latest order. */
export async function listVehicles(db, dealerId) {
  const [rows] = await db.query(
    `SELECT v.id, v.vin, v.stock_no, v.year, v.make, v.model, v.trim, v.color, v.mileage, v.price, v.source, v.updated_at,
            (SELECT COUNT(*) FROM vehicle_photos p WHERE p.vehicle_id = v.id) AS photo_count,
            o.status AS order_status, o.id AS order_id, o.created_at AS ordered_at
       FROM vehicles v
       LEFT JOIN orders o ON o.id = (SELECT MAX(id) FROM orders WHERE vehicle_id = v.id)
      WHERE v.dealer_id = ? AND v.status = 'active' ORDER BY o.id DESC, v.id DESC`,
    [dealerId]);
  if (!rows.length) return [];
  const [firsts] = await db.query(
    `SELECT p.* FROM vehicle_photos p
       JOIN (SELECT vehicle_id, MIN(position) AS position FROM vehicle_photos WHERE vehicle_id IN (?) GROUP BY vehicle_id) f
         ON f.vehicle_id = p.vehicle_id AND f.position = p.position`,
    [rows.map((r) => r.id)]);
  const first = new Map(firsts.map((p) => [p.vehicle_id, p]));
  return rows.map((r) => ({ ...r, photo_count: Number(r.photo_count), photo: first.has(r.id) ? photoView(dealerId, first.get(r.id)) : null }));
}

/** One stored car of this dealer with its photos, or a 404. */
export async function getVehicle(db, dealerId, id) {
  const [rows] = await db.query("SELECT * FROM vehicles WHERE id = ? AND dealer_id = ? AND status = 'active'", [Number(id) || 0, dealerId]);
  if (!rows.length) throw new HttpError(404, 'Car not found.');
  const photos = await vehiclePhotos(db, rows[0].id);
  return { ...rows[0], photos, photo_views: photos.map((p) => photoView(dealerId, p)) };
}

/** Public shape of a stored car for the browser. */
export function vehicleView(v) {
  const { photos, photo_views, source_hash, features_json, ...rest } = v;
  return { ...rest, photos: photo_views };
}

/**
 * Saves the car being ordered, inside the order's transaction (conn): its details as the customer ordered it, and its
 * photos in their order. photos: [{ url } | { upload_id }]; an upload must be this dealer's, either not yet attached
 * or already this car's. Website photos are kept as links. Returns { id, removed } (removed: uploads the car no longer
 * uses, whose files the caller deletes after the transaction).
 */
export async function saveOrderedCar(conn, dealerId, car, photos, source) {
  const vin = cleanVin(car?.vin);
  const fields = cleanFields(car);
  const list = Array.isArray(photos) ? photos : [];
  if (!list.length) throw new HttpError(400, 'Add at least one photo of this car.');
  if (list.length > MAX_PHOTOS) throw new HttpError(400, `Use up to ${MAX_PHOTOS} photos.`);
  for (const p of list) if (!(p?.upload_id || (typeof p?.url === 'string' && HTTPS.test(p.url) && p.url.length <= 1024))) throw new HttpError(400, 'A photo address is not valid.');

  const [rows] = await conn.query('SELECT id FROM vehicles WHERE dealer_id = ? AND vin = ? FOR UPDATE', [dealerId, vin]);
  let id = rows[0]?.id;
  if (id) {
    await conn.query(`UPDATE vehicles SET ${EDITABLE.map((k) => `${k} = ?`).join(', ')}, status = 'active', source = ?, last_seen_at = NOW(3) WHERE id = ?`,
      [...EDITABLE.map((k) => fields[k]), source, id]);
  } else {
    [{ insertId: id }] = await conn.query(`INSERT INTO vehicles (dealer_id, vin, ${EDITABLE.join(', ')}, status, source, last_seen_at) VALUES (?, ?, ${EDITABLE.map(() => '?').join(', ')}, 'active', ?, NOW(3))`,
      [dealerId, vin, ...EDITABLE.map((k) => fields[k]), source]);
  }

  const uploadIds = [...new Set(list.filter((p) => p.upload_id).map((p) => Number(p.upload_id)))];
  const [uploads] = uploadIds.length
    ? await conn.query('SELECT id FROM vehicle_photos WHERE id IN (?) AND dealer_id = ? AND url IS NULL AND (vehicle_id IS NULL OR vehicle_id = ?) FOR UPDATE', [uploadIds, dealerId, id])
    : [[]];
  if (uploads.length !== uploadIds.length) throw new HttpError(400, 'An uploaded photo is missing. Upload it again.');
  const [old] = await conn.query('SELECT id, file_name, thumb_name FROM vehicle_photos WHERE vehicle_id = ? AND url IS NULL', [id]);
  const removed = old.filter((p) => !uploadIds.includes(p.id));
  await conn.query('DELETE FROM vehicle_photos WHERE vehicle_id = ? AND (url IS NOT NULL OR id NOT IN (?))', [id, uploadIds.length ? uploadIds : [0]]);
  for (const [i, p] of list.entries()) {
    if (p.upload_id) await conn.query('UPDATE vehicle_photos SET vehicle_id = ?, position = ? WHERE id = ?', [id, i, Number(p.upload_id)]);
    else await conn.query('INSERT INTO vehicle_photos (vehicle_id, dealer_id, position, url) VALUES (?,?,?,?)', [id, dealerId, i, p.url]);
  }
  return { id, removed };
}

/** The car as ordered: its details and photo list, frozen into the order. */
export function vehicleSnapshot(v) {
  const pick = Object.fromEntries(['id', 'vin', ...EDITABLE].map((k) => [k, v[k] ?? null]));
  return { ...pick, photos: v.photos.map((p) => ({ id: p.id, url: p.url ?? null, uploaded: !p.url })) };
}
