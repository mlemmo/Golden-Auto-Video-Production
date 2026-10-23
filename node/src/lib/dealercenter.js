// Snapshot inventory tracking: Golden Auto's DealerCenter list, or another client's website read in a browser (a
// site that blocks this server). Input: a snapshot of the active list (no costs). Photos come from each item's
// photo_urls (imagescf.dealercenter.net or pictures.dealer.com, downloaded
// server-to-server; the URL set is tracked so replaced photos are noticed) or, as a fallback, from ZIPs named
// <stock>.zip with photo_count. Compares with saved inventory, records a change log in state row "sync_log", marks
// vehicles missing from the snapshot inactive (kept, never deleted). Downloaded photos are imported directly and
// images are made with FFmpeg.
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, statSync, rmSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trim, upper, str, filterValidateInt, isNumeric, toFloat, gmdateC, parseUrl, U_SPACE } from './text.js';
import { money, title } from './price.js';
import { state, save } from './db.js';
import { CLIENT_DEFAULT, clientFind, clientInventoryKey } from './clients.js';
import { importMedia, importMediaZip, downloadPhotos, assetSheet, mbSafeText } from './media.js';

const isList = Array.isArray;
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** (array)$x for a JSON value. */
const toArray = (v) => (v === null || v === undefined ? [] : isList(v) ? v : isMap(v) ? Object.values(v) : [v]);
const unlinkQuiet = (f) => { try { unlinkSync(f); } catch { /* gone */ } };

/** DealerCenter descriptions open with a tax/registration price disclaimer; it never belongs in ad copy. */
export function dcCleanDescription(s) {
  s = s.replace(new RegExp('Total price does not include State Sales Tax or Registration fees,?' + U_SPACE + '*please call us for the total price\\.?', 'giu'), '');
  return mbSafeText(s.replace(new RegExp('^' + U_SPACE + '+', 'u'), ''));
}

/** A snapshot photo URL → its stable id: "<document>.jpg" (DealerCenter, as before) or "pictures.dealer.com/<path>". */
export function dcPhotoId(u) {
  const dc = u.match(/^https:\/\/imagescf\.dealercenter\.net\/(?:[0-9]+\/[0-9]+\/)?(?:[A-Za-z0-9-]+\/)?([A-Za-z0-9-]+\.jpg)$/);
  if (dc) return dc[1];
  const ddc = u.match(/^https:\/\/pictures\.dealer\.com\/([a-z0-9]\/[A-Za-z0-9_-]{1,80}\/[0-9]{1,8}\/[A-Za-z0-9_-]{1,100}\.(?:jpe?g|png|webp))(?:\?[^#\s]*)?$/i);
  return ddc ? 'pictures.dealer.com/' + ddc[1] : null;
}
/** The download URL for a photo id (DealerCenter's 1600×1200 size, Dealer.com's original). */
export const dcPhotoUrl = (id) => (id.startsWith('pictures.dealer.com/') ? 'https://' + id : 'https://imagescf.dealercenter.net/1600/1200/' + id);

export function dcNormalize(raw) {
  const s = isMap(raw) ? raw : isList(raw) ? Object.fromEntries(raw.map((v, i) => [String(i), v])) : { 0: raw };
  const stock = trim(str(s.stock ?? ''));
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(stock)) throw new Error('Snapshot has an invalid stock number.');
  const year = filterValidateInt(s.year ?? null);
  if (!year || year < 1900 || year > new Date().getUTCFullYear() + 2) throw new Error(`Stock ${stock}: invalid year.`);
  const make = upper(trim(str(s.make ?? ''))), model = upper(trim(str(s.model ?? '')));
  if (!make || !model || Buffer.byteLength(make) > 60 || Buffer.byteLength(model) > 100) throw new Error(`Stock ${stock}: make and model required.`);
  const vin = upper(trim(str(s.vin ?? '')));
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error(`Stock ${stock}: invalid VIN.`);
  const prices = [];
  for (const p of toArray(s.prices ?? [])) if (isNumeric(p) && toFloat(p) > 0) prices.push(toFloat(p));
  const mileage = s.mileage ?? null;
  if (mileage !== null && mileage !== '' && (filterValidateInt(mileage) === false || filterValidateInt(mileage) < 0 || filterValidateInt(mileage) > 2000000)) throw new Error(`Stock ${stock}: invalid mileage.`);
  let urls = null, key = null, count = s.photo_count;
  if (s.photo_urls !== undefined && s.photo_urls !== null) {
    if (!isList(s.photo_urls) || s.photo_urls.length > 100) throw new Error(`Stock ${stock}: photo_urls must be a list of up to 100 URLs.`);
    // Two photo hosts: DealerCenter (imagescf.dealercenter.net; CDN paths are /W/H/[overlay-folder/]document.jpg and
    // only the document id is kept — the folder-less original without the website's logo/phone overlay — so the
    // photo key stays stable if the overlay is toggled) and Dealer.com (pictures.dealer.com/<x>/<dealer>/<n>/<id>.jpg;
    // resize parameters are dropped so the original is downloaded).
    let ids = [];
    for (const u of s.photo_urls) {
      const id = typeof u === 'string' ? dcPhotoId(u) : null;
      if (!id) throw new Error(`Stock ${stock}: photos must come from imagescf.dealercenter.net or pictures.dealer.com.`);
      ids.push(id);
    }
    ids = [...new Set(ids)];
    key = createHash('sha256').update(ids.join('\n')).digest('hex');
    urls = ids.map(dcPhotoUrl);
    count = urls.length;
  }
  const photos = filterValidateInt(count ?? null);
  if (photos === false || photos < 0 || photos > 100) throw new Error(`Stock ${stock}: photo_count must be 0–100.`);
  // The car's own page on the dealer's website (ads link to it); optional.
  const pageUrl = trim(str(s.page_url ?? ''));
  if (pageUrl !== '' && (!/^https:\/\/[^\s"'<>]+$/.test(pageUrl) || pageUrl.length > 500)) throw new Error(`Stock ${stock}: page_url must be an https web address.`);
  let sheet = null;
  if (s.sheet_photos !== undefined && s.sheet_photos !== null) {
    sheet = s.sheet_photos;
    if (!isList(sheet) || sheet.length < 1 || sheet.length > 9 || new Set(sheet.map(String)).size !== sheet.length) throw new Error(`Stock ${stock}: sheet_photos must list 1–9 different photo positions.`);
    for (const n of sheet) if (!Number.isInteger(n) || n < 1 || n > photos) throw new Error(`Stock ${stock}: sheet photo ${str(n)} is not in the gallery.`);
  }
  return { stock, vin, year, make, model, trim: trim(str(s.trim ?? '')), drivetrain: trim(str(s.drivetrain ?? '')), color: trim(str(s.color ?? '')),
    mileage: mileage === null || mileage === '' ? null : filterValidateInt(mileage), price: prices.length ? Math.max(...prices) : null,
    description: dcCleanDescription(str(s.description ?? '')), photo_count: photos, photo_urls: urls, photo_key: key, sheet_photos: sheet, page_url: pageUrl };
}
/** True when the saved photo set no longer matches the snapshot (URL set when known, otherwise the count). */
export function dcPhotosChanged(cur, s) {
  if (!cur || !(cur.photos ?? []).length) return true;
  return s.photo_key !== null ? (cur.dc_photo_key ?? null) !== s.photo_key : (cur.dc_photo_count ?? null) !== s.photo_count;
}
/** Saved JSON turns 9000.0 into 9000, so compare prices by value. */
export const dcSamePrice = (a, b) => (a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(toFloat(a) - toFloat(b)) < 0.005);
/** Local imported photo files (40-hex .jpg in assets) referenced by a vehicle. */
export function dcLocalPhotos(v, cfg) {
  const out = [];
  for (const url of v.photos ?? []) {
    const path = String(url).replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, '').split(/[?#]/)[0];
    const name = path.split('/').pop();
    if (/^[a-f0-9]{40}\.jpg$/.test(name)) out.push(String(cfg.asset_dir) + '/' + name);
  }
  return out;
}
export function dcApplyFields(v, s, feed = 'dealercenter') {
  v = { ...v };
  v.Vin = s.vin || (v.Vin ?? 'stock:' + s.stock); v.Year = s.year; v.Make = s.make; v.Model = s.model; v.Trim = s.trim;
  v.Drivetrain = s.drivetrain; v.ExteriorColor = s.color; v.Odometer = s.mileage; v.VehiclePrice = s.price ?? 0; v.price = s.price;
  if (s.description !== '') v.description = s.description;
  if (s.page_url) v.page_url = s.page_url;
  v.feed = feed; v.active = true; delete v.removed_at; v.dc_checked_at = gmdateC();
  return v;
}

/** Downloaded CDN photos for a car, one retry for missing ones; [{ name: photo_001.jpg, bytes }]. */
async function dcPhotosFromUrls(urls, download) {
  if (!urls.length) throw new Error('No photos listed for this vehicle.');
  const got = await download(urls);
  const missing = urls.map((_, i) => i).filter((i) => !got[i]);
  if (missing.length) { const again = await download(missing.map((i) => urls[i])); missing.forEach((i, j) => { if (again[j]) got[i] = again[j]; }); }
  const n = urls.filter((_, i) => got[i]).length;
  if (n !== urls.length) throw new Error(`${urls.length - n} of ${urls.length} photos could not be downloaded; try the sync again.`);
  return urls.map((_, i) => ({ name: 'photo_' + String(i + 1).padStart(3, '0') + '.jpg', bytes: got[i] }));
}

/** The change-log state row: "sync_log" for Golden Auto, "sync_log:<client>" for others. */
export const syncLogKey = (client) => (client === CLIENT_DEFAULT ? 'sync_log' : 'sync_log:' + clientInventoryKey(client).slice('inventory:'.length));

/**
 * client: whose inventory the snapshot is (default Golden Auto). Other clients' snapshots come from their website read
 * in a browser (e.g. a Dealer.com site that blocks this server); the same rules apply to their inventory and log.
 */
export async function dcSync(db, cfg, snapshot, zipDir = null, download = downloadPhotos, client = CLIENT_DEFAULT) {
  clientFind(db, client);
  const invKey = clientInventoryKey(client), logKey = syncLogKey(client), feed = client === CLIENT_DEFAULT ? 'dealercenter' : 'snapshot';
  if (!isList(snapshot) || !snapshot.length) throw new Error('Snapshot must be a non-empty list of vehicles.');
  const items = new Map();
  for (const raw of snapshot) { const s = dcNormalize(raw); if (items.has(s.stock)) throw new Error('Duplicate stock ' + s.stock + ' in snapshot.'); items.set(s.stock, s); }
  const before = new Map();
  for (const v of state(db, invKey)?.vehicles ?? []) before.set(str(v.StockNumber), v);

  // Phase 1 (no DB lock): import photos for vehicles that are new or whose photo set changed.
  const imported = new Map(); let created = [];
  try {
    for (const [stock, s] of items) {
      if (!dcPhotosChanged(before.get(stock) ?? null, s)) continue;
      const fields = { stock, year: s.year, make: s.make, model: s.model, trim: s.trim, vin: s.vin, mileage: s.mileage === null ? '' : String(s.mileage),
        prices: s.price === null ? '' : String(s.price), description: s.description, drivetrain: s.drivetrain };
      let v;
      if (s.photo_urls !== null) v = importMedia(await dcPhotosFromUrls(s.photo_urls, download), fields, cfg);
      else {
        const zip = zipDir ? zipDir.replace(/\/+$/, '') + '/' + stock + '.zip' : null;
        if (!zip || !existsSync(zip)) continue;
        v = importMediaZip(zip, fields, cfg);
      }
      created = created.concat(dcLocalPhotos(v, cfg));
      v.dc_photo_count = s.photo_count; v.dc_photo_key = s.photo_key; imported.set(stock, v);
    }
  } catch (e) { created.forEach(unlinkQuiet); throw e; }

  // Phase 2 (short transaction): re-read inventory and apply all changes.
  const log = { at: gmdateC(), source: feed, active_count: items.size, added: [], photos_updated: [], price_changed: [], updated: [], returned: [], removed: [], waiting_photos: [], sheet_views: [] };
  let stale = []; const rebuild = new Set(); let byStock;
  db.exec('BEGIN');
  try {
    const inv = state(db, invKey) ?? { vehicles: [] };
    byStock = new Map();
    for (const v of inv.vehicles) byStock.set(str(v.StockNumber), v);
    for (const [stock, s] of items) {
      const cur = byStock.get(stock) ?? null, label = stock + ' ' + trim(s.year + ' ' + s.make + ' ' + s.model);
      let v;
      if (imported.has(stock)) {
        v = dcApplyFields(imported.get(stock), s, feed); v.imported_at = imported.get(stock).imported_at;
        if (cur) { const keep = dcLocalPhotos(v, cfg); stale = stale.concat(dcLocalPhotos(cur, cfg).filter((f) => !keep.includes(f))); log.photos_updated.push(label + ' (' + v.photos.length + ' photos)'); }
        else log.added.push(label + ' (' + v.photos.length + ' photos)');
      } else if (cur) {
        v = dcApplyFields(cur, s, feed);
        if (dcPhotosChanged(cur, s)) log.waiting_photos.push(label + ' (photo count ' + str(cur.dc_photo_count ?? 'unknown') + ' → ' + s.photo_count + ')');
      } else { log.waiting_photos.push(label + ' (new, ' + s.photo_count + ' photos)'); continue; }
      if (cur) {
        if (!dcSamePrice(cur.price ?? null, v.price)) { log.price_changed.push(label + ': ' + money(cur.price ?? null) + ' → ' + money(v.price)); v.price_changed_at = gmdateC(); }
        if ((cur.active ?? true) === false) log.returned.push(label);
        else if (!imported.has(stock) && ((cur.Odometer ?? null) !== v.Odometer || (cur.description ?? '') !== (v.description ?? '') || (cur.Trim ?? '') !== v.Trim)) log.updated.push(label);
      }
      if (s.sheet_photos !== null) {
        if (JSON.stringify(s.sheet_photos) !== JSON.stringify(cur?.sheet_photos ?? null)) { rebuild.add(stock); if (!imported.has(stock)) log.sheet_views.push(label + ' (photos ' + s.sheet_photos.join(', ') + ')'); }
        v.sheet_photos = s.sheet_photos;
      }
      if (imported.has(stock)) rebuild.add(stock);
      byStock.set(stock, v);
    }
    for (const [stock, v] of byStock) {
      if (items.has(stock) || (v.source ?? '') !== 'zip' || (v.active ?? true) === false) continue;
      byStock.set(stock, { ...v, active: false, removed_at: gmdateC() }); log.removed.push(stock + ' ' + title(v));
    }
    inv.vehicles = [...byStock.values()]; inv.dealercenter_checked_at = gmdateC(); save(db, invKey, inv);
    for (const stock of imported.keys()) save(db, 'import:' + (client === CLIENT_DEFAULT ? '' : client + ':') + stock, byStock.get(stock));
    const history = state(db, logKey) ?? { entries: [] };
    history.entries = [log, ...(history.entries ?? [])].slice(0, 30); save(db, logKey, history);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ } created.forEach(unlinkQuiet); throw e; }
  for (const f of stale) if (existsSync(f)) unlinkQuiet(f);
  // Asset sheets for new photo sets or new view picks. A failure leaves the vehicle usable (the dashboard rebuilds
  // on open). The replaced sheet image is deleted.
  for (const stock of rebuild) {
    const v = byStock.get(stock), old = state(db, 'sheet:' + v.Vin);
    let fresh;
    try { fresh = await assetSheet(v, cfg, [], download); save(db, 'sheet:' + v.Vin, fresh); }
    catch (e) { (log.sheet_errors ??= []).push(stock + ': ' + e.message); continue; }
    const oldFile = old ? String((parseUrl(old.url) && String(old.url).replace(/^[a-z]+:\/\/[^/]*/i, '')) || '').split(/[?#]/)[0].split('/').pop() : '';
    if (/^[a-f0-9]{40}\.jpg$/.test(oldFile) && oldFile !== fresh.url.split('/').pop()) unlinkQuiet(String(cfg.asset_dir) + '/' + oldFile);
  }
  return log;
}

/**
 * A snapshot sent from the dashboard (admin; read in the browser from a site that blocks this server): checked now,
 * saved under data_dir/snapshots and imported in the background by the sync CLI (downloads and asset sheets take
 * minutes). One import per client at a time (lock folder, taken over after 30 minutes). run(file, lock) is
 * replaceable in tests.
 */
export function snapshotImportStart(db, cfg, client, snapshot, run = null) {
  clientFind(db, client);
  if (!isList(snapshot) || !snapshot.length || snapshot.length > 500) throw new Error('Send a list of 1–500 vehicles.');
  const stocks = new Set();
  for (const raw of snapshot) { const s = dcNormalize(raw); if (stocks.has(s.stock)) throw new Error('Duplicate stock ' + s.stock + ' in snapshot.'); stocks.add(s.stock); }
  const dir = String(cfg.data_dir) + '/snapshots', lock = String(cfg.data_dir) + '/snapshot-' + client + '.lock.d';
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { mkdirSync(lock); }
  catch {
    if (Date.now() - statSync(lock).mtimeMs < 30 * 60 * 1000) throw new Error('An import for this client is still running. Wait for it to finish (see Inventory changes).');
    rmSync(lock, { recursive: true, force: true }); mkdirSync(lock);
  }
  const file = dir + '/' + client + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  writeFileSync(file, JSON.stringify(snapshot), { mode: 0o600 });
  (run ?? snapshotImportRun)(cfg, client, file, lock);
  return { message: `Snapshot of ${snapshot.length} vehicles received. The import runs in the background (photos and asset sheets take a few minutes); reload the inventory to see the cars.`, vehicles: snapshot.length };
}
function snapshotImportRun(cfg, client, file, lock) {
  const cli = fileURLToPath(new URL('../cli/dealercenter-sync.js', import.meta.url));
  const out = openSync(String(cfg.data_dir) + '/snapshot-sync.log', 'a');
  // Arguments are passed as positional parameters, never pasted into the shell text.
  const p = spawn('/bin/sh', ['-c', 'echo "$(date -u +%FT%TZ) $2 $3"; "$0" "$1" --client "$2" "$3"; rm -rf "$4"', process.execPath, cli, client, file, lock],
    { detached: true, stdio: ['ignore', out, out] });
  p.unref(); closeSync(out);
}
