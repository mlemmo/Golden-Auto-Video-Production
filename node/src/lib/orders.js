// Customer orders from the LotSpotlight portal, for the admin's "Orders" window. The portal is served by this same
// server with this same database (src/portal), so orders are read directly. "Open in studio" copies the ordered car
// and its photos into its dealer's cars here (source 'portal'), marks the order in progress and selects the car in
// step 1. Free: no paid API is called here.
import { readFileSync } from 'node:fs';
import { clientsLoad, clientInventoryKey } from './clients.js';
import { dcsStorePhotos } from './photos.js';
import { dcPhotoId, dcPhotoUrl } from './dealercenter.js';
import { state, save } from './db.js';
import { gmdateC, trim, upper } from './text.js';
import { getOrder, listOrders, moveOrder, orderView, uploadPath } from '../portal/store.js';
import { deps } from '../portal/deps.js';

/** What the window lists for one order. */
function orderRow(o) {
  const v = o.vehicle ?? {};
  return {
    id: o.id, status: o.status, product: o.product, product_name: o.product_name, length_s: o.length_s, notes: o.notes ?? '',
    dealer: o.dealer_name, client: o.dealer_id, ordered_by: o.ordered_by_email ?? '', created_at: o.created_at, paid_at: o.paid_at, studio_ref: o.studio_ref,
    vehicle: { title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '), vin: v.vin, stock: v.stock_no ?? '', price: v.price ?? null, mileage: v.mileage ?? null, photos: (v.photos ?? []).length },
  };
}

export function portalOrders(db) {
  const names = new Map(clientsLoad(db).items.map((c) => [c.id, c.name]));
  return { configured: true, orders: listOrders(db, { statuses: ['paid', 'in_progress'] }).map((r) => orderRow(orderView(r, (id) => names.get(id) ?? id))) };
}

/** A website photo address as downloaded: DealerCenter photos without the website's logo overlay, Dealer.com originals. */
function photoSource(url) {
  const id = dcPhotoId(String(url));
  return id ? dcPhotoUrl(id) : url;
}

/** Opens a paid order in the studio. Returns { client, stock, message }. */
export async function portalOrderOpen(db, cfg, id, { siteFetch = (url) => deps.siteFetch(url) } = {}) {
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
  const names = sources.map((s) => stored.get(s)).filter(Boolean);
  if (!names.length) throw new Error('None of this car’s photos could be copied. Try again, or ask the dealer to upload photos.');

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
    photos: names.map((n) => base + n), photos_pending: false, active: true,
    imported_at: prev?.imported_at ?? gmdateC(), detail_checked_at: gmdateC(),
  };
  // New photos: the asset sheet starts again from the default picks.
  if (JSON.stringify(prev?.photos ?? null) !== JSON.stringify(car.photos)) delete car.sheet_photos;
  inv.vehicles = [...(inv.vehicles ?? []).filter((x) => x.StockNumber !== stock), car];
  save(db, key, inv);

  if (order.status === 'paid') moveOrder(db, order.id, ['paid'], 'in_progress', { studio_ref: client + '/' + stock, claimed_at: new Date().toISOString() });
  return { client, stock, message: `Order ${order.id} opened: ${car.Year} ${car.Make} ${car.Model} is in ${order.dealer_name}'s cars (stock ${stock}).` };
}
