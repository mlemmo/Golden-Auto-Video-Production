// LotSpotlight portal data, in the studio's own database (agent.sqlite; one database for both, Sawyer 2026-11-03):
//   portal_cars     a dealer's cars with videos: stored only when ordered, with the details and photos ordered with
//   portal_uploads  photos customers upload while filling in an order (files in <data_dir>/portal-uploads)
//   portal_orders   video orders, each with a frozen copy of the car as ordered
// Dealers are the studio's clients and accounts are the studio's accounts (src/portal/api.js).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { HttpError } from '../lib/auth.js';
import { gmdateC } from '../lib/text.js';
import { cleanFields, cleanVin, EDITABLE, HTTPS, MAX_PHOTOS } from './cars.js';

export const PRODUCTS = {
  ai_video: { name: 'AI spokesperson video', lengths: [15, 30] },
  slideshow: { name: 'Photo slideshow', lengths: [15, 30, 60] },
};
export const STATUSES = ['awaiting_payment', 'paid', 'in_progress', 'ready_for_review', 'approved', 'rejected', 'cancelled'];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_THUMB_BYTES = 300 * 1024;
const MAX_WAITING = 60;
const MAX_NOTES = 2000;
const MAX_REASON = 1000;
// A rejected video is remade once at no charge; a second rejection goes to eShield staff to decide (plan, 2026-11-03).
export const FREE_REMAKES = 1;
const NAME = /^[a-f0-9]{40}\.jpg$/;

const ready = new WeakSet();
export function tables(db) {
  if (ready.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_cars (client TEXT NOT NULL, vin TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (client, vin));
    CREATE TABLE IF NOT EXISTS portal_uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, uploaded_by TEXT, file TEXT NOT NULL, thumb TEXT,
      vin TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS portal_uploads_client ON portal_uploads (client, vin);
    CREATE TABLE IF NOT EXISTS portal_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, vin TEXT NOT NULL, status TEXT NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS portal_orders_client ON portal_orders (client, id);
    CREATE INDEX IF NOT EXISTS portal_orders_status ON portal_orders (status, id);`);
  ready.add(db);
  return db;
}
/** db.exec('BEGIN IMMEDIATE') … COMMIT around fn; rolled back when it throws. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---- Uploaded photos ----

export const uploadDir = (cfg) => String(cfg.data_dir) + '/portal-uploads';
const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
function store(cfg, buf, max, limit) {
  if (!isJpeg(buf)) throw new HttpError(415, 'Photos must be sent as JPEG.');
  if (buf.length > max) throw new HttpError(413, `That photo is too large (up to ${limit}).`);
  mkdirSync(uploadDir(cfg), { recursive: true, mode: 0o750 });
  const name = randomBytes(20).toString('hex') + '.jpg';
  writeFileSync(uploadDir(cfg) + '/' + name, buf, { mode: 0o640 });
  return name;
}
/** Path of a stored upload file, or null. */
export function uploadPath(cfg, name) {
  if (!NAME.test(String(name ?? ''))) return null;
  const path = uploadDir(cfg) + '/' + name;
  return existsSync(path) ? path : null;
}
function removeFiles(cfg, rows) {
  for (const r of rows) for (const n of [r.file, r.thumb]) { const p = uploadPath(cfg, n); if (p) unlinkSync(p); }
}

/** Stores a photo for an order being filled in; unused uploads older than a day are deleted first. Returns its id. */
export function addUpload(db, cfg, client, user, buf) {
  tables(db);
  const old = db.prepare("SELECT * FROM portal_uploads WHERE client = ? AND vin IS NULL AND created_at < ?").all(client, new Date(Date.now() - 86400_000).toISOString());
  if (old.length) { db.prepare(`DELETE FROM portal_uploads WHERE id IN (${old.map(() => '?').join(',')})`).run(...old.map((r) => r.id)); removeFiles(cfg, old); }
  if (db.prepare('SELECT COUNT(*) AS n FROM portal_uploads WHERE client = ? AND vin IS NULL').get(client).n >= MAX_WAITING) {
    throw new HttpError(409, 'Too many photos are waiting for an order. Place the order, or try again tomorrow.');
  }
  const file = store(cfg, buf, MAX_PHOTO_BYTES, '10 MB');
  return Number(db.prepare('INSERT INTO portal_uploads (client, uploaded_by, file, created_at) VALUES (?,?,?,?)').run(client, user.email, file, new Date().toISOString()).lastInsertRowid);
}
export function getUpload(db, client, id) {
  const row = tables(db).prepare('SELECT * FROM portal_uploads WHERE id = ? AND client = ?').get(Number(id) || 0, client);
  if (!row) throw new HttpError(404, 'Photo not found.');
  return row;
}
export function setThumb(db, cfg, upload, buf) {
  const thumb = store(cfg, buf, MAX_THUMB_BYTES, '300 KB');
  db.prepare('UPDATE portal_uploads SET thumb = ? WHERE id = ?').run(thumb, upload.id);
  removeFiles(cfg, [{ thumb: upload.thumb }]);
}
export function deleteUpload(db, cfg, upload) {
  if (upload.vin) throw new HttpError(409, 'This photo belongs to an ordered car. Leave it out of the next order instead.');
  db.prepare('DELETE FROM portal_uploads WHERE id = ?').run(upload.id);
  removeFiles(cfg, [upload]);
}

// ---- Cars with videos ----

/** How the browser shows a photo: the website's own address, or the portal's copy of an upload. */
export function photoView(client, p) {
  if (p.url) return { url: p.url, src: p.url, thumb: p.url, uploaded: false };
  const base = `/api/dealers/${client}/photos/${p.upload_id}`;
  return { id: p.upload_id, upload_id: p.upload_id, src: base, thumb: base + '?size=thumb', uploaded: true };
}
const carRow = (row) => (row ? { client: row.client, vin: row.vin, ...JSON.parse(row.payload), updated_at: row.updated_at } : null);

export function getCar(db, client, vin) {
  const car = carRow(tables(db).prepare('SELECT * FROM portal_cars WHERE client = ? AND vin = ?').get(client, String(vin ?? '').toUpperCase()));
  if (!car) throw new HttpError(404, 'Car not found.');
  return car;
}
export const carView = (car) => ({ ...car, id: car.vin, photos: car.photos.map((p) => photoView(car.client, p)) });

/** The dealer's cars with videos, newest order first, each with its first photo and latest order. */
export function listCars(db, client) {
  tables(db);
  const latest = new Map(db.prepare('SELECT vin, status, MAX(id) AS id FROM portal_orders WHERE client = ? GROUP BY vin').all(client).map((r) => [r.vin, r]));
  return db.prepare('SELECT * FROM portal_cars WHERE client = ?').all(client).map(carRow)
    .map((c) => ({ ...c, id: c.vin, photo_count: c.photos.length, photo: c.photos[0] ? photoView(client, c.photos[0]) : null, photos: undefined,
      order_status: latest.get(c.vin)?.status ?? null, order_id: latest.get(c.vin)?.id ?? null }))
    .sort((a, b) => (b.order_id ?? 0) - (a.order_id ?? 0));
}

// ---- Orders ----

export function orderView(row, clientName = (c) => c) {
  const p = JSON.parse(row.payload);
  const rejections = p.rejections ?? [];
  return { id: row.id, dealer_id: row.client, dealer_name: clientName(row.client), status: row.status, created_at: row.created_at, updated_at: row.updated_at,
    product: p.product, product_name: PRODUCTS[p.product]?.name ?? p.product, length_s: p.length_s, notes: p.notes ?? null, vehicle: p.vehicle,
    ordered_by_email: p.ordered_by ?? null, paid_via: p.paid_via ?? null, paid_at: p.paid_at ?? null, studio_ref: p.studio_ref ?? null,
    // Delivery and review (Milestone 4): the videos sent, when, and the customer's answers.
    videos: p.delivery?.videos ?? [], delivered_at: p.delivery?.sent_at ?? null, approved_at: p.approved_at ?? null, approved_by: p.approved_by ?? null,
    rejections, remake: row.status === 'in_progress' && rejections.length ? rejections.at(-1) : null,
    free_remakes_left: Math.max(0, FREE_REMAKES - rejections.length) };
}

/**
 * Places an order: the car as the customer filled it in (from their website or by hand) and its photos are saved as one
 * of their cars with videos, then frozen into the order. input: { car, photos: [{ url } | { upload_id }], source,
 * product, length_s, notes }. Returns the order id.
 */
export function placeOrder(db, cfg, client, user, input) {
  tables(db);
  const product = String(input?.product ?? '');
  const length = Number(input?.length_s);
  if (!PRODUCTS[product]) throw new HttpError(400, 'Choose a video type.');
  if (!PRODUCTS[product].lengths.includes(length)) throw new HttpError(400, `Choose a length: ${PRODUCTS[product].lengths.join(', ')} seconds.`);
  const notes = String(input?.notes ?? '').trim();
  if (notes.length > MAX_NOTES) throw new HttpError(400, `Notes can be up to ${MAX_NOTES} characters.`);
  const vin = cleanVin(input?.car?.vin);
  const fields = cleanFields(input?.car);
  const list = Array.isArray(input?.photos) ? input.photos : [];
  if (!list.length) throw new HttpError(400, 'Add at least one photo of this car.');
  if (list.length > MAX_PHOTOS) throw new HttpError(400, `Use up to ${MAX_PHOTOS} photos.`);
  const photos = list.map((p) => {
    if (p?.upload_id) return { upload_id: Number(p.upload_id) };
    if (typeof p?.url === 'string' && HTTPS.test(p.url) && p.url.length <= 1024) return { url: p.url };
    throw new HttpError(400, 'A photo address is not valid.');
  });
  const source = input?.source === 'website' ? 'website' : 'form';
  let removed = [];
  const id = transaction(db, () => {
    const uploads = [...new Set(photos.filter((p) => p.upload_id).map((p) => p.upload_id))];
    for (const uid of uploads) {
      const u = db.prepare('SELECT * FROM portal_uploads WHERE id = ? AND client = ? AND (vin IS NULL OR vin = ?)').get(uid, client, vin);
      if (!u) throw new HttpError(400, 'An uploaded photo is missing. Upload it again.');
    }
    // Uploads this car used before and no longer does are deleted; the new ones belong to it now.
    removed = db.prepare('SELECT * FROM portal_uploads WHERE client = ? AND vin = ?').all(client, vin).filter((u) => !uploads.includes(u.id));
    for (const u of removed) db.prepare('DELETE FROM portal_uploads WHERE id = ?').run(u.id);
    for (const uid of uploads) db.prepare('UPDATE portal_uploads SET vin = ? WHERE id = ?').run(vin, uid);
    const now = gmdateC();
    const car = { ...Object.fromEntries(EDITABLE.map((k) => [k, fields[k]])), source, photos };
    db.prepare('INSERT INTO portal_cars VALUES (?,?,?,?) ON CONFLICT(client, vin) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
      .run(client, vin, JSON.stringify(car), now);
    const vehicle = { vin, ...Object.fromEntries(EDITABLE.map((k) => [k, fields[k]])), photos: photos.map((p) => ({ ...p })) };
    const payload = { product, length_s: length, notes: notes || null, vehicle, ordered_by: user.email };
    return Number(db.prepare('INSERT INTO portal_orders (client, vin, status, payload, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(client, vin, 'awaiting_payment', JSON.stringify(payload), now, now).lastInsertRowid);
  });
  removeFiles(cfg, removed);
  return id;
}

export function getOrder(db, id, client = null) {
  const row = tables(db).prepare(`SELECT * FROM portal_orders WHERE id = ?${client === null ? '' : ' AND client = ?'}`).get(...(client === null ? [Number(id) || 0] : [Number(id) || 0, client]));
  if (!row) throw new HttpError(404, 'Order not found.');
  return row;
}

/** Orders of some dealers (null: all), optionally only some statuses, newest first. */
export function listOrders(db, { clients = null, statuses = null, limit = 200 } = {}) {
  tables(db);
  const where = [], args = [];
  if (clients) { where.push(`client IN (${clients.map(() => '?').join(',') || "''"})`); args.push(...clients); }
  if (statuses?.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); args.push(...statuses); }
  return db.prepare(`SELECT * FROM portal_orders${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit);
}

export function statusFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  const list = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  if (list.some((s) => !STATUSES.includes(s))) throw new HttpError(400, `Unknown status. Use: ${STATUSES.join(', ')}.`);
  return list;
}

/** Moves an order from one of `from` to `to` (with extra payload fields) in one step; 409 with `conflict` otherwise. */
export function moveOrder(db, id, from, to, extra = {}, conflict = 'This order has moved on; reload to see where it is.') {
  return transaction(db, () => {
    const row = getOrder(db, id);
    if (!from.includes(row.status)) throw new HttpError(409, conflict);
    const payload = { ...JSON.parse(row.payload), ...extra };
    db.prepare('UPDATE portal_orders SET status = ?, payload = ?, updated_at = ? WHERE id = ?').run(to, JSON.stringify(payload), gmdateC(), row.id);
    return { ...row, status: to, payload: JSON.stringify(payload) };
  });
}

// ---- Delivery and review (Milestone 4) ----

/**
 * Staff send finished videos (from the studio) to the customer: the order waits for their review. videos: [{ job_id,
 * url, poster, format, kind, duration }]. From in progress (or a remake), from rejected (staff decided to try again), or
 * again while waiting (a corrected video).
 */
export function deliverOrder(db, id, videos, by) {
  if (!Array.isArray(videos) || !videos.length) throw new HttpError(400, 'Choose at least one finished video to send.');
  return moveOrder(db, id, ['in_progress', 'rejected', 'ready_for_review'], 'ready_for_review',
    { delivery: { videos, sent_at: new Date().toISOString(), sent_by: by.email } }, 'Only orders being worked on can be sent to the customer.');
}

/**
 * The customer's answer: approve, or reject with a reason. The first rejection sends the order back for a free remake
 * (in progress, with the reason); after that a rejection waits for eShield staff (rejected).
 */
export function reviewOrder(db, id, client, user, { approve, reason }) {
  const row = getOrder(db, id, client);
  if (approve) return moveOrder(db, row.id, ['ready_for_review'], 'approved', { approved_at: new Date().toISOString(), approved_by: user.email }, 'This order is not waiting for your review.');
  const why = String(reason ?? '').trim();
  if (!why) throw new HttpError(400, 'Tell us what to change, so the remake gets it right.');
  if (why.length > MAX_REASON) throw new HttpError(400, `Keep the reason under ${MAX_REASON} characters.`);
  const p = JSON.parse(row.payload);
  const rejections = [...(p.rejections ?? []), { reason: why, by: user.email, at: new Date().toISOString(), videos: (p.delivery?.videos ?? []).map((v) => v.job_id) }];
  return moveOrder(db, row.id, ['ready_for_review'], rejections.length <= FREE_REMAKES ? 'in_progress' : 'rejected', { rejections }, 'This order is not waiting for your review.');
}
