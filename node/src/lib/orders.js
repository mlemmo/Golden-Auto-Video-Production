// Customer orders from the LotSpotlight portal (approved plan, Milestone 2), for the admin's "Customer orders" window.
// The portal keeps every dealer's cars; this server only receives the one car an order is for. "Open in studio"
// links the portal dealer to a client here (created on first use, or an existing client with the same name), copies
// the ordered car and its photos into that client's inventory (source 'portal'), and marks the order in progress on
// the portal. Dealer details edited on the portal (name, city, website, phone) are copied into the client's script
// details whenever the orders are listed or opened. Settings: config "portal": { "api", "worker_id", "worker_secret" }; without them the window says how to
// connect and nothing is sent anywhere. Free: no paid API is called here.
import { portalClient } from './portal-client.js';
import { clientsLoad, clientInventory, clientInventoryKey, clientFetch, clientWebsite, clientFind, clientDetails, clientSaveDetails } from './clients.js';
import { dcsStorePhotos } from './photos.js';
import { dcPhotoId, dcPhotoUrl } from './dealercenter.js';
import { state, save } from './db.js';
import { gmdateC, lower, trim, upper } from './text.js';

/** The portal connection from config, or null when it is not set up. */
export function portalFromConfig(cfg, fetchFn = fetch) {
  const p = cfg.portal ?? {};
  if (!p.api || !p.worker_id || !p.worker_secret) return null;
  return portalClient({ api: p.api, workerId: p.worker_id, secret: p.worker_secret, fetchFn });
}

/** What the window lists for one order. */
function orderRow(o, clients) {
  const v = o.vehicle ?? {};
  const linked = clients.find((c) => c.portal_dealer_id === o.dealer_id);
  return {
    id: o.id, status: o.status, product: o.product, product_name: o.product_name, length_s: o.length_s, notes: o.notes ?? '',
    dealer: o.dealer_name, dealer_id: o.dealer_id, client: linked?.id ?? null, ordered_by: o.ordered_by_email ?? '', created_at: o.created_at,
    paid_at: o.paid_at, studio_ref: o.studio_ref ?? null,
    vehicle: { title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '), vin: v.vin, stock: v.stock_no ?? '', price: v.price ?? null, mileage: v.mileage ?? null, photos: (v.photos ?? []).length },
  };
}

/**
 * Sends this studio's clients to the portal, so eShield staff can add them there with one click; the answer says which
 * portal dealer each client is linked to, saved here as portal_dealer_id. Sent when the studio starts, when a client is
 * added or edited, and when the Orders window lists orders.
 */
export async function pushClientsToPortal(db, portal) {
  const clients = clientsLoad(db).items.map((c) => {
    const d = clientDetails(c);
    let cars = null;
    try { cars = (clientInventory(db, c.id).vehicles ?? []).filter((v) => v.active !== false).length; } catch { /* no inventory yet */ }
    return { id: c.id, name: c.name, website: c.website || null, city: d.city || null, state: c.analysis?.dealer?.state ?? null,
      phone: d.phone || c.analysis?.dealer?.telephone || null, car_count: cars, portal_dealer_id: c.portal_dealer_id ?? null };
  });
  const { links } = await portal.syncClients(clients);
  const c = clientsLoad(db);
  let changed = false;
  for (const x of c.items) if (links?.[x.id] && x.portal_dealer_id !== links[x.id]) { x.portal_dealer_id = links[x.id]; changed = true; }
  if (changed) save(db, 'clients', c);
  return links ?? {};
}

/**
 * pushClientsToPortal in the background (studio start, client changes). retryMs: waits before trying again (the portal
 * may still be starting when a deploy restarts both); a last failure is only logged.
 */
export function pushClientsSoon(db, cfg, { retryMs = [], log = (m) => console.error(m) } = {}) {
  const portal = portalFromConfig(cfg);
  if (!portal) return;
  const attempt = (left) => pushClientsToPortal(db, portal).catch((e) => {
    if (left.length) setTimeout(() => attempt(left.slice(1)), left[0]).unref?.();
    else log('portal client sync: ' + e.message);
  });
  attempt(retryMs);
}

export async function portalOrders(db, cfg, portal = portalFromConfig(cfg)) {
  if (!portal) return { configured: false, orders: [] };
  try { await pushClientsToPortal(db, portal); } catch { /* orders still list */ }
  const orders = await portal.orders();
  // Dealers edit their details on the portal: bring linked clients up to date while listing (a failure only skips it).
  for (const id of new Set(orders.map((o) => o.dealer_id))) {
    const linked = clientsLoad(db).items.find((c) => c.portal_dealer_id === id);
    if (linked) try { await syncPortalDealer(db, portal, linked.id, id); } catch { /* listed with the details we have */ }
  }
  const clients = clientsLoad(db).items;
  return { configured: true, orders: orders.map((o) => orderRow(o, clients)) };
}

/**
 * The portal dealer's details (name, city, website, phone; edited on the portal by the dealer or eShield staff) into
 * the linked client's script details here, and its name in the client list. An empty portal field keeps what the
 * client has, so Golden Auto stays "San Ramon" until the portal gives a city. Returns true when something changed.
 */
export function applyPortalDealer(db, clientId, dealer) {
  const cur = clientDetails(clientFind(db, clientId));
  let host = '';
  try { host = dealer.website ? new URL(dealer.website).hostname.replace(/^www\./, '') : ''; } catch { /* keep ours */ }
  const next = { name: dealer.name || cur.name, city: dealer.city || cur.city, website: host || cur.website, phone: dealer.phone || cur.phone,
    website_spoken: host && host !== cur.website ? '' : cur.website_spoken };
  if (['name', 'city', 'website', 'phone'].every((k) => next[k] === cur[k])) return false;
  clientSaveDetails(db, clientId, next);
  const c = clientsLoad(db);
  const item = c.items.find((x) => x.id === clientId);
  if (dealer.name && item.name !== dealer.name && !c.items.some((x) => x.id !== clientId && lower(x.name) === lower(dealer.name))) {
    item.name = String(dealer.name).slice(0, 80);
    save(db, 'clients', c);
  }
  return true;
}

export async function syncPortalDealer(db, portal, clientId, dealerId) {
  const { dealer } = await portal.dealerConfig(dealerId);
  return applyPortalDealer(db, clientId, dealer);
}

/** The client for a portal dealer: already linked, else an unlinked client with the same name, else a new one. */
export function portalDealerClient(db, order) {
  const c = clientsLoad(db);
  let found = c.items.find((x) => x.portal_dealer_id === order.dealer_id)
    ?? c.items.find((x) => !x.portal_dealer_id && lower(x.name) === lower(order.dealer_name));
  if (!found) {
    let website = '';
    try { website = order.dealer_website ? clientWebsite(order.dealer_website) : ''; } catch { /* no usable website */ }
    const base = (trim(lower(order.dealer_name).replace(/[^a-z0-9]+/g, '-'), '-') || 'client').slice(0, 32);
    let id = base, n = 2;
    while (c.items.some((x) => x.id === id)) id = base + '-' + n++;
    found = { id, name: String(order.dealer_name).slice(0, 80), website, created_at: gmdateC() };
    c.items.push(found);
  }
  found.portal_dealer_id = order.dealer_id;
  save(db, 'clients', c);
  return found.id;
}

/** A website photo address as downloaded: DealerCenter photos without the website's logo overlay, Dealer.com originals. */
function photoSource(url) {
  const id = dcPhotoId(String(url));
  return id ? dcPhotoUrl(id) : url;
}

/**
 * Opens a paid order in the studio. Returns { client, stock, message }. Photos already copied for an earlier order
 * of the same car are reused (state portal_photos); website photos are downloaded from the dealer's photo host.
 */
export async function portalOrderOpen(db, cfg, id, { portal = portalFromConfig(cfg), siteFetch = clientFetch } = {}) {
  if (!portal) throw new Error('Connect the LotSpotlight portal first (config "portal").');
  const { order, photos } = await portal.order(Number(id));
  if (!['paid', 'in_progress'].includes(order.status)) throw new Error('Only paid orders can be opened in the studio.');
  const v = order.vehicle ?? {};
  const client = portalDealerClient(db, order);
  let detailsNote = '';
  try { if (await syncPortalDealer(db, portal, client, order.dealer_id)) detailsNote = ' Dealer details updated from the portal.'; }
  catch (e) { detailsNote = ` Dealer details were not updated (${e.message}).`; }

  // Photos, in the order's order: website links downloaded, uploads fetched from the portal (signed), earlier copies reused.
  const known = state(db, 'portal_photos') ?? {};
  const sources = [], fresh = [];
  for (const p of photos) {
    if (known[p.id]) sources.push('known:' + p.id);
    else if (p.url) sources.push(photoSource(p.url));
    else if (p.path) { sources.push('portal:' + p.id); fresh.push(p.id); }
  }
  const fetchPhoto = async (src) => {
    if (src.startsWith('portal:')) {
      try { return { code: 200, bodyBuffer: await portal.orderPhoto(order.id, Number(src.slice(7))) }; } catch { return { code: 0 }; }
    }
    return siteFetch(src);
  };
  const stored = new Map(await dcsStorePhotos(cfg, sources.filter((s) => !s.startsWith('known:')), fetchPhoto));
  const names = sources.map((s) => (s.startsWith('known:') ? known[s.slice(6)] : stored.get(s))).filter(Boolean);
  if (!names.length) throw new Error('None of this car’s photos could be copied. Try again, or ask the dealer to upload photos.');
  for (const p of photos) {
    const name = p.url ? stored.get(photoSource(p.url)) : stored.get('portal:' + p.id);
    if (name && !p.url) known[p.id] = name;
  }
  save(db, 'portal_photos', known);

  const base = String(cfg.public_base_url).replace(/\/+$/, '') + '/assets/';
  const stock = trim(String(v.stock_no ?? '')) || String(v.vin ?? '').slice(-8);
  const key = clientInventoryKey(client), inv = state(db, key) ?? { vehicles: [] };
  const prev = (inv.vehicles ?? []).find((x) => x.StockNumber === stock) ?? null;
  const car = {
    ...(prev ?? {}),
    source: 'portal', portal_order: order.id, portal_vehicle_id: v.id ?? null, StockNumber: stock, Vin: v.vin, Year: v.year,
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

  await portal.claimOrder(order.id, client + '/' + stock);
  const copied = fresh.filter((pid) => known[pid]);
  if (copied.length) await portal.photosCopied(order.id, copied).catch(() => {});  // the portal keeps them; harmless
  return { client, stock, message: `Order ${order.id} opened: ${car.Year} ${car.Make} ${car.Model} is in ${order.dealer_name}'s cars (stock ${stock}).${detailsNote}` };
}
