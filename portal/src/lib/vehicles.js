// A dealer's cars: added by form, pulled from their website or sent by a DMS sync. Fields a customer changes by hand
// are listed in customer_edits_json and left alone by later pulls and syncs. Website photos stay links (url); only
// uploaded photos are files on the portal (lib/photos.js).
import { createHash } from 'node:crypto';
import { json } from './db.js';
import { HttpError } from './errors.js';

export const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const MAX_PHOTOS = 30;
const TEXT = { stock_no: 40, make: 60, model: 80, trim: 120, color: 60, drivetrain: 40, description: 5000, page_url: 500 };
const NAMES = { stock_no: 'stock number', make: 'make', model: 'model', trim: 'trim', color: 'colour', drivetrain: 'drive', description: 'description', page_url: 'car page address' };
export const EDITABLE = ['stock_no', 'year', 'make', 'model', 'trim', 'color', 'drivetrain', 'mileage', 'price', 'description', 'page_url'];

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

/** The editable fields present in input, checked; with required, year, make and model must be given. */
export function cleanFields(input, { required = false } = {}) {
  const out = {};
  for (const key of EDITABLE) {
    if (!Object.hasOwn(input ?? {}, key)) continue;
    const value = input[key];
    if (key === 'year') out.year = wholeNumber(value, 'year', 1900, new Date().getUTCFullYear() + 2);
    else if (key === 'mileage') out.mileage = wholeNumber(value, 'miles', 0, 2_000_000);
    else if (key === 'price') out.price = wholeNumber(value, 'price in whole dollars', 0, 10_000_000);
    else {
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text.length > TEXT[key]) throw new HttpError(400, `The ${NAMES[key]} is too long (up to ${TEXT[key]} characters).`);
      if (key === 'page_url' && text !== '' && !/^https:\/\/[^\s"'<>]+$/.test(text)) throw new HttpError(400, 'The car page address must start with https://');
      out[key] = text === '' ? null : text;
    }
  }
  if (required) for (const key of ['year', 'make', 'model']) if (out[key] === null || out[key] === undefined) throw new HttpError(400, `Enter the ${NAMES[key] ?? key}.`);
  return out;
}

/** How the browser shows a photo: the website's own address, or the portal's copy of an upload. */
export function photoView(dealerId, vehicleId, p) {
  const base = `/api/dealers/${dealerId}/vehicles/${vehicleId}/photos/${p.id}`;
  return p.url ? { id: p.id, src: p.url, thumb: p.url, uploaded: false } : { id: p.id, src: base + (p.file_name ? '' : '?size=thumb'), thumb: base + '?size=thumb', uploaded: true };
}

export async function vehiclePhotos(db, vehicleId) {
  const [rows] = await db.query('SELECT * FROM vehicle_photos WHERE vehicle_id = ? ORDER BY position, id', [vehicleId]);
  return rows;
}

const parseList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : []);

export async function listVehicles(db, dealerId) {
  const [rows] = await db.query(
    `SELECT v.id, v.vin, v.stock_no, v.year, v.make, v.model, v.trim, v.color, v.mileage, v.price, v.source, v.missing_since, v.updated_at,
            (SELECT COUNT(*) FROM vehicle_photos p WHERE p.vehicle_id = v.id) AS photo_count,
            (SELECT o.status FROM orders o WHERE o.vehicle_id = v.id ORDER BY o.id DESC LIMIT 1) AS order_status
       FROM vehicles v WHERE v.dealer_id = ? AND v.status = 'active' ORDER BY v.year DESC, v.make, v.model, v.id`,
    [dealerId]);
  if (!rows.length) return [];
  const [firsts] = await db.query(
    `SELECT p.* FROM vehicle_photos p
       JOIN (SELECT vehicle_id, MIN(position) AS position FROM vehicle_photos WHERE vehicle_id IN (?) GROUP BY vehicle_id) f
         ON f.vehicle_id = p.vehicle_id AND f.position = p.position`,
    [rows.map((r) => r.id)]);
  const first = new Map(firsts.map((p) => [p.vehicle_id, p]));
  return rows.map((r) => ({ ...r, photo_count: Number(r.photo_count), photo: first.has(r.id) ? photoView(dealerId, r.id, first.get(r.id)) : null }));
}

/** One active car of this dealer with its photos, or a 404. */
export async function getVehicle(db, dealerId, id) {
  const [rows] = await db.query("SELECT * FROM vehicles WHERE id = ? AND dealer_id = ? AND status = 'active'", [Number(id) || 0, dealerId]);
  if (!rows.length) throw new HttpError(404, 'Car not found.');
  const v = rows[0];
  const photos = await vehiclePhotos(db, v.id);
  return { ...v, customer_edits: parseList(v.customer_edits_json), photos, photo_views: photos.map((p) => photoView(dealerId, v.id, p)) };
}

/** Public shape of a car for the browser. */
export function vehicleView(v) {
  const { customer_edits_json, photos, photo_views, source_hash, features_json, ...rest } = v;
  return { ...rest, photos: photo_views };
}

/** Adds a car typed in by the customer. A car they removed earlier comes back with the new details. */
export async function createVehicle(db, dealerId, input) {
  const vin = cleanVin(input?.vin);
  const fields = cleanFields(input, { required: true });
  const cols = EDITABLE.filter((k) => Object.hasOwn(fields, k));
  const [old] = await db.query('SELECT id, status FROM vehicles WHERE dealer_id = ? AND vin = ?', [dealerId, vin]);
  if (old.length && old[0].status !== 'removed') throw new HttpError(409, 'That VIN is already in your cars.');
  if (old.length) {
    await db.query(`UPDATE vehicles SET ${EDITABLE.map((k) => `${k} = ?`).join(', ')}, status = 'active', source = 'form', customer_edits_json = NULL, missing_since = NULL WHERE id = ?`,
      [...EDITABLE.map((k) => fields[k] ?? null), old[0].id]);
    return old[0].id;
  }
  const [r] = await db.query(`INSERT INTO vehicles (dealer_id, vin, ${cols.join(', ')}, source, last_seen_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, 'form', NOW(3))`,
    [dealerId, vin, ...cols.map((k) => fields[k])]);
  return r.insertId;
}

/** Saves the customer's changes and remembers which fields they changed, so pulls and syncs keep them. */
export async function updateVehicle(db, vehicle, input) {
  const fields = cleanFields(input);
  const changed = Object.keys(fields).filter((k) => fields[k] !== (vehicle[k] ?? null));
  if (!changed.length) return [];
  const edits = [...new Set([...vehicle.customer_edits, ...changed])];
  await db.query(`UPDATE vehicles SET ${changed.map((k) => `${k} = ?`).join(', ')}, customer_edits_json = ? WHERE id = ?`,
    [...changed.map((k) => fields[k]), json(edits), vehicle.id]);
  return changed;
}

/** Marks a car removed (orders keep their own copy of it). */
export async function removeVehicle(db, vehicle) {
  await db.query("UPDATE vehicles SET status = 'removed' WHERE id = ?", [vehicle.id]);
}

/** Puts the car's photos in the order given (every photo id exactly once); remembered as a customer edit. */
export async function orderPhotos(db, vehicle, ids) {
  const want = (Array.isArray(ids) ? ids : []).map(Number);
  const have = vehicle.photos.map((p) => p.id);
  if (want.length !== have.length || new Set(want).size !== want.length || want.some((id) => !have.includes(id))) throw new HttpError(400, 'Send every photo of this car once, in the new order.');
  for (const [i, id] of want.entries()) await db.query('UPDATE vehicle_photos SET position = ? WHERE id = ?', [i, id]);
  await markPhotosEdited(db, vehicle);
}

export async function markPhotosEdited(db, vehicle) {
  if (vehicle.customer_edits.includes('photos')) return;
  await db.query('UPDATE vehicles SET customer_edits_json = ? WHERE id = ?', [json([...vehicle.customer_edits, 'photos']), vehicle.id]);
}

// ---- Pulled cars (website pull, DMS sync) -------------------------------------------------------------------------

const intOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const textOrNull = (v, max) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

/** A pulled car in the portal's shape; throws (400) without a valid VIN. */
export function normalPulled(v) {
  const vin = String(v?.vin ?? '').trim().toUpperCase();
  if (!VIN.test(vin)) throw new HttpError(400, `Invalid VIN: ${String(v?.vin ?? '').slice(0, 20)}`);
  const out = {
    vin, stock_no: textOrNull(v.stock_no, 40), year: intOrNull(v.year), make: textOrNull(v.make, 60), model: textOrNull(v.model, 80),
    trim: textOrNull(v.trim, 120), color: textOrNull(v.color, 60), drivetrain: textOrNull(v.drivetrain, 40), mileage: intOrNull(v.mileage),
    price: intOrNull(v.price), description: textOrNull(v.description, 5000),
    page_url: /^https:\/\/[^\s"'<>]+$/.test(String(v.page_url ?? '')) ? String(v.page_url).slice(0, 500) : null,
    photos: (Array.isArray(v.photos) ? v.photos : []).map(String).filter((u) => /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 1024).slice(0, MAX_PHOTOS),
    features: Array.isArray(v.features) ? v.features.map(String) : [],
  };
  // keep_photos: details only (e.g. a DealerCenter car the website does not show yet); its photos stay as they are.
  if (v.keep_photos === true) out.keep_photos = true;
  out.source_hash = createHash('sha256').update(JSON.stringify(out)).digest('hex');
  return out;
}

/**
 * Adds or updates pulled cars inside a transaction (conn). Fields the customer changed and photos they reordered or
 * deleted stay as they are; a car the customer removed stays removed. Returns { added, changed, vins }.
 */
export async function upsertPulled(conn, dealerId, cars, source) {
  let added = 0, changed = 0;
  const vins = [];
  for (const v of cars) {
    vins.push(v.vin);
    const [rows] = await conn.query('SELECT * FROM vehicles WHERE dealer_id = ? AND vin = ? FOR UPDATE', [dealerId, v.vin]);
    const old = rows[0];
    if (!old) {
      const [r] = await conn.query(
        `INSERT INTO vehicles (dealer_id, vin, stock_no, year, make, model, trim, color, drivetrain, mileage, price, description, page_url,
                               status, source, features_json, source_hash, last_seen_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?, NOW(3))`,
        [dealerId, v.vin, v.stock_no, v.year, v.make, v.model, v.trim, v.color, v.drivetrain, v.mileage, v.price, v.description, v.page_url,
          source, json(v.features), v.source_hash]);
      for (const [i, url] of v.photos.entries()) await conn.query('INSERT INTO vehicle_photos (vehicle_id, position, url) VALUES (?,?,?)', [r.insertId, i, url]);
      added++;
      continue;
    }
    if (old.status === 'removed') continue;
    const edits = parseList(old.customer_edits_json);
    if (old.source_hash !== v.source_hash || old.status !== 'active') changed++;
    const keys = EDITABLE.filter((k) => !edits.includes(k));
    await conn.query(
      `UPDATE vehicles SET ${keys.map((k) => `${k} = ?, `).join('')}features_json = ?, source_hash = ?, status = 'active', last_seen_at = NOW(3), missing_since = NULL WHERE id = ?`,
      [...keys.map((k) => v[k]), json(v.features), v.source_hash, old.id]);
    if (!edits.includes('photos') && !v.keep_photos && old.source_hash !== v.source_hash) await replaceLinkedPhotos(conn, old.id, v.photos);
  }
  return { added, changed, vins };
}

/** New website photo links first, in the website's order; the customer's uploads after them, in their order. */
async function replaceLinkedPhotos(conn, vehicleId, urls) {
  const [current] = await conn.query('SELECT id, url FROM vehicle_photos WHERE vehicle_id = ? ORDER BY position, id', [vehicleId]);
  const linked = current.filter((p) => p.url).map((p) => p.url);
  const uploads = current.filter((p) => !p.url);
  if (JSON.stringify(linked) === JSON.stringify(urls)) return;
  await conn.query('DELETE FROM vehicle_photos WHERE vehicle_id = ? AND url IS NOT NULL', [vehicleId]);
  const keep = urls.slice(0, Math.max(0, MAX_PHOTOS - uploads.length));
  for (const [i, url] of keep.entries()) await conn.query('INSERT INTO vehicle_photos (vehicle_id, position, url) VALUES (?,?,?)', [vehicleId, i, url]);
  for (const [i, p] of uploads.entries()) await conn.query('UPDATE vehicle_photos SET position = ? WHERE id = ?', [keep.length + i, p.id]);
}

/** The car as ordered: its details and photo list, frozen into the order. */
export function vehicleSnapshot(v) {
  const pick = Object.fromEntries(['id', 'vin', ...EDITABLE].map((k) => [k, v[k] ?? null]));
  return { ...pick, photos: v.photos.map((p) => ({ id: p.id, url: p.url ?? null, uploaded: !p.url })) };
}
