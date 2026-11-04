// Customer orders from the LotSpotlight portal, for the admin's "Orders" window. The portal is served by this same
// server with this same database (src/portal), so orders are read directly. "Open in studio" copies the ordered car
// and its photos into its dealer's cars here (source 'portal'), marks the order in progress and selects the car in
// step 1 with the order's length and type. "Send to customer" puts finished videos of that car on the order for the
// customer to approve or reject (Milestone 4). Free: no paid API is called here.
import { readFileSync } from 'node:fs';
import { clientsLoad, clientInventoryKey } from './clients.js';
import { dcsStorePhotos, photoClassify } from './photos.js';
import { dcPhotoId, dcPhotoUrl } from './dealercenter.js';
import { state, save } from './db.js';
import { gmdateC, trim, upper } from './text.js';
import { deliverOrder, getOrder, listOrders, moveOrder, orderView, uploadPath } from '../portal/store.js';
import { libraryVideos } from './jobs.js';
import { deps } from '../portal/deps.js';

/** The order's car in the studio: its stock number as opened (studio_ref "client/stock"), else as ordered. */
const studioStock = (o) => (o.studio_ref ? o.studio_ref.split('/').slice(1).join('/') : trim(String(o.vehicle?.stock_no ?? '')) || String(o.vehicle?.vin ?? '').slice(-8));

/** What the window lists for one order, with the finished videos of its car to send. */
function orderRow(o, finished = []) {
  const v = o.vehicle ?? {};
  const sent = new Set(o.videos.map((x) => x.job_id));
  return {
    id: o.id, status: o.status, product: o.product, product_name: o.product_name, length_s: o.length_s, notes: o.notes ?? '', choices: o.choices,
    dealer: o.dealer_name, client: o.dealer_id, ordered_by: o.ordered_by_email ?? '', created_at: o.created_at, paid_at: o.paid_at, studio_ref: o.studio_ref,
    vehicle: { title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '), vin: v.vin, stock: v.stock_no ?? '', price: v.price ?? null, mileage: v.mileage ?? null, photos: (v.photos ?? []).length },
    delivered_at: o.delivered_at, remake: o.remake, rejections: o.rejections,
    finished: finished.map((f) => ({ id: f.id, kind: f.kind, format: f.format, duration: f.duration, url: f.url, poster: f.poster, created_at: f.created_at, sent: sent.has(f.id) })),
  };
}

const finishedFor = (db, o) => (o.status === 'paid' ? [] : libraryVideos(db, [o.dealer_id]).filter((f) => f.stock === studioStock(o)));

export function portalOrders(db) {
  const names = new Map(clientsLoad(db).items.map((c) => [c.id, c.name]));
  const orders = listOrders(db, { statuses: ['paid', 'in_progress', 'ready_for_review', 'rejected'] }).map((r) => orderView(r, (id) => names.get(id) ?? id));
  return { configured: true, orders: orders.map((o) => orderRow(o, finishedFor(db, o))) };
}

/** Sends finished videos of the order's car (job ids from the Orders window) to the customer for review. */
export function portalOrderDeliver(db, id, jobIds, user) {
  const order = orderView(getOrder(db, Number(id)));
  const ids = new Set((Array.isArray(jobIds) ? jobIds : []).map(String));
  const videos = finishedFor(db, order).filter((f) => ids.has(f.id))
    .map((f) => ({ job_id: f.id, url: f.url, poster: f.poster || null, format: f.format, kind: f.kind, duration: f.duration }));
  if (videos.length !== ids.size) throw new Error('A chosen video is not a finished video of this car. Refresh and choose again.');
  deliverOrder(db, order.id, videos, user);
  return { message: `Sent ${videos.length} video${videos.length === 1 ? '' : 's'} to ${order.dealer_name} for order ${order.id}. They can approve it or ask for changes on the portal.` };
}

/** A website photo address as downloaded: DealerCenter photos without the website's logo overlay, Dealer.com originals. */
function photoSource(url) {
  const id = dcPhotoId(String(url));
  return id ? dcPhotoUrl(id) : url;
}

/** Opens a paid order in the studio. Returns { client, stock, length_s, product, notes, choices, message }. */
export async function portalOrderOpen(db, cfg, id, { siteFetch = (url) => deps.siteFetch(url), classify = (paths) => (deps.classify ?? ((p) => photoClassify(cfg, p)))(paths) } = {}) {
  const order = orderView(getOrder(db, Number(id)));
  if (!['paid', 'in_progress'].includes(order.status)) throw new Error('Only paid orders can be opened in the studio.');
  const client = order.dealer_id;
  const v = order.vehicle ?? {};

  // Photos in the order's order: website links downloaded, uploads read from the portal's folder on this server.
  const sources = (v.photos ?? []).map((p) => (p.url ? photoSource(p.url) : 'upload:' + p.upload_id));
  const fetchPhoto = async (src) => {
    if (!src.startsWith('upload:')) return siteFetch(src);
    const row = db.prepare('SELECT file FROM portal_uploads WHERE id = ? AND client = ?').get(Number(src.slice(7)), client);
    const path = row ? uploadPath(cfg, row.file) : null;
    return path ? { code: 200, bodyBuffer: readFileSync(path) } : { code: 404 };
  };
  const stored = new Map(await dcsStorePhotos(cfg, sources, fetchPhoto));
  let names = [...new Set(sources.map((s) => stored.get(s)).filter(Boolean))];
  if (!names.length) throw new Error('None of this car’s photos could be copied. Try again, or ask the dealer to upload photos.');
  // A walkaround is made from whole-car outside shots, as for the studio's website imports (photos.js): the free local
  // sorter labels the photos and only 'exterior' ones are kept, in the customer's order. No sorter, or no outside shot
  // found → all photos. Slideshows keep every photo (the interior is part of the tour).
  let labels = null;
  if (order.product === 'ai_video') {
    const dir = String(cfg.asset_dir);
    const got = await classify(names.map((n) => dir + '/' + n));
    if (got) {
      labels = {};
      for (const n of names) { const l = got[dir + '/' + n] ?? 'error'; labels[l] = (labels[l] ?? 0) + 1; }
      const outside = names.filter((n) => got[dir + '/' + n] === 'exterior');
      if (outside.length) names = outside;
    }
  }

  const base = String(cfg.public_base_url).replace(/\/+$/, '') + '/assets/';
  const stock = trim(String(v.stock_no ?? '')) || String(v.vin ?? '').slice(-8);
  const key = clientInventoryKey(client), inv = state(db, key) ?? { vehicles: [] };
  const prev = (inv.vehicles ?? []).find((x) => x.StockNumber === stock) ?? null;
  const car = {
    ...(prev ?? {}),
    source: 'portal', portal_order: order.id, StockNumber: stock, Vin: v.vin, Year: v.year,
    Make: upper(String(v.make ?? '')), Model: upper(String(v.model ?? '')), Trim: String(v.trim ?? ''), ExteriorColor: String(v.color ?? ''),
    Drivetrain: String(v.drivetrain ?? ''), Odometer: v.mileage ?? null, VehiclePrice: v.price ?? 0, price: v.price ?? null,
    description: String(v.description ?? ''), ...(v.page_url ? { page_url: v.page_url } : {}),
    photos: names.map((n) => base + n), photo_labels: labels ?? undefined, photos_pending: false, active: true,
    imported_at: prev?.imported_at ?? gmdateC(), detail_checked_at: gmdateC(),
  };
  // New photos: the asset sheet starts again from the default picks.
  if (JSON.stringify(prev?.photos ?? null) !== JSON.stringify(car.photos)) delete car.sheet_photos;
  inv.vehicles = [...(inv.vehicles ?? []).filter((x) => x.StockNumber !== stock), car];
  save(db, key, inv);

  if (order.status === 'paid') moveOrder(db, order.id, ['paid'], 'in_progress', { studio_ref: client + '/' + stock, claimed_at: new Date().toISOString() });
  // The studio's length and video type follow the order (web/src/CustomerOrders.jsx applies them).
  // The customer's choices too (spokesperson, background setting, slideshow background, shapes; portal/options.js).
  const kept = labels ? ` Kept ${names.length} outside photo${names.length === 1 ? '' : 's'} of ${sources.length} for the walkaround.` : '';
  return { client, stock, length_s: order.length_s, product: order.product, notes: order.notes ?? '', choices: order.choices ?? null,
    message: `Order ${order.id} opened: make a ${order.length_s}-second ${String(order.product_name).toLowerCase()} of the ${car.Year} ${car.Make} ${car.Model} (stock ${stock}, ${order.dealer_name}).`
      + kept + (order.notes ? ` Customer notes: ${order.notes}` : '') };
}
