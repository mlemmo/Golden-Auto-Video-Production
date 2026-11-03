// Website importer for clients on Dealer Car Search sites (e.g. eLease Returns): clientImportDcs. The page reading
// (dcsParseVdp and the sitemap) is in shared/dcs.js, which the LotSpotlight portal uses too. Photos are left to the
// photo worker (it copies, re-encodes and sorts them with the local image model).
import { gmdateC } from './text.js';
import { clientFetch, clientInventoryKey, clientsLoad } from './clients.js';
import { state, save } from './db.js';
import { dcsVehiclePages, dcsParseVdp, dcsPageError } from '../../../shared/dcs.js';

export { DCS_PHOTO_LIMIT, DCS_MAX_CARS, dcsParseVdp, dcsSitemapName, dcsPageError, dcsVehiclePages } from '../../../shared/dcs.js';

/**
 * Import a Dealer Car Search client's inventory from its website. Cars that left the site stay listed as inactive.
 * Photos are left to the photo worker: a car whose photo set is new or changed is marked photos_pending.
 * Returns { vehicles, checked_at, report: { added, updated, gone, errors } }.
 */
export async function clientImportDcs(db, client, fetchFn = clientFetch) {
  const pages = await dcsVehiclePages(client.website, client.analysis?.sitemap, fetchFn);
  const key = clientInventoryKey(client.id);
  const old = state(db, key) ?? { vehicles: [] };
  const byStock = new Map();
  for (const v of old.vehicles ?? []) byStock.set(String(v.StockNumber), v);
  const seen = new Set(), errors = [];
  let added = 0, updated = 0, dealer = null;
  for (const url of pages) {
    const r = await fetchFn(url);
    if ((r.code ?? 0) !== 200) { errors.push(dcsPageError(url, 'could not be loaded (HTTP ' + (r.code ?? 0) + ')')); continue; }
    let v;
    try { v = dcsParseVdp(String(r.body), url); } catch { errors.push(dcsPageError(url, 'has no year, make or model on the site (it may have been sold)')); continue; }
    dealer ??= v.dealer; delete v.dealer;
    const prev = byStock.get(v.StockNumber) ?? null;
    // Photos are copied and sorted by the photo worker; until then the car keeps the photos it had.
    const same = prev !== null && JSON.stringify(prev.photo_sources_done ?? null) === JSON.stringify(v.photo_sources);
    v.photos = prev?.photos ?? [];
    v.photos_pending = !same;
    for (const k of ['photo_sources_done', 'photo_labels', 'photos_checked_at', 'sheet_photos']) if (prev && Object.hasOwn(prev, k) && prev[k] !== null) v[k] = prev[k];
    v.active = true; v.imported_at = prev?.imported_at ?? gmdateC(); v.detail_checked_at = gmdateC();
    prev ? updated++ : added++;
    // A car that moved stock numbers keeps its place; a new one goes last.
    byStock.set(v.StockNumber, v); seen.add(v.StockNumber);
  }
  let gone = 0;
  // Cars from LotSpotlight portal orders are not on this website list; they stay as they are.
  for (const [stock, v] of byStock) if (!seen.has(stock) && (v.active ?? true) !== false && (v.source ?? '') !== 'portal') { v.active = false; gone++; }
  const checked = gmdateC();
  const vehicles = [...byStock.values()];
  save(db, key, { vehicles, checked_at: checked, import: 'dcs' });
  if (dealer && Object.keys(dealer).length) {
    const c = clientsLoad(db);
    for (const x of c.items) if (x.id === client.id) x.dealer = dealer;
    save(db, 'clients', c);
  }
  return { vehicles, checked_at: checked, report: { added, updated, gone, errors } };
}
