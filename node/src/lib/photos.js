// Photo worker for website-imported client cars (Dealer Car Search). Port of dcsStorePhotos, photoClassify and
// dcsProcessPhotos (private/importers.php). Every photo is downloaded, re-encoded as JPEG with FFmpeg (PHP: GD,
// quality 88) and named by its content hash, sorted by the free local image model (private/photo_classify.py, run
// with the ML environment's Python), and only whole-car exterior shots (doors closed) are kept, in website order.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, unlinkSync, accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clientFetch } from './clients.js';
import { DCS_PHOTO_LIMIT } from './importers.js';
import { state, save, stateIds, stateMentions } from './db.js';
import { toJpeg } from './images.js';
import { phpJsonEncode } from './phpjson.js';
import { gmdateC } from './php.js';

const CLASSIFIER = fileURLToPath(new URL('../../../private/photo_classify.py', import.meta.url));

/** Save remote photos as local JPEG assets named by content. Returns [[source URL, file name], …] (a URL once). */
export async function dcsStorePhotos(cfg, urls, fetchFn = clientFetch) {
  const out = new Map();
  const dir = String(cfg.asset_dir);
  for (const url of urls) {
    const r = await fetchFn(url);
    const body = r.bodyBuffer ?? Buffer.from(String(r.body ?? ''), 'latin1');  // tests may pass bytes as a latin1 string
    if ((r.code ?? 0) !== 200 || body.length < 1000 || body.length > 15000000) continue;
    let jpg;
    try { jpg = toJpeg(body, { quality: 88 }); } catch { continue; }
    const name = createHash('sha1').update(jpg).digest('hex') + '.jpg';
    if (!existsSync(dir + '/' + name)) writeFileSync(dir + '/' + name, jpg, { mode: 0o644 });
    out.set(url, name);  // a repeated URL keeps its first position, like a PHP array key
  }
  return [...out.entries()];
}

/** Labels from the local image model: { path: label }, or null when it is not installed or fails (keep all). */
export function photoClassify(cfg, paths) {
  const python = String(cfg.photo_python ?? (process.env.HOME || '/home/mark') + '/golden-auto-ml/bin/python');
  if (!paths.length) return {};
  try { accessSync(python, constants.X_OK); } catch { return null; }
  const r = spawnSync(python, [CLASSIFIER], { input: JSON.stringify({ images: paths, threads: Number(cfg.photo_threads ?? 3) }), maxBuffer: 1 << 26, timeout: 600000 });
  if (r.status !== 0) return null;
  let d; try { d = JSON.parse(r.stdout.toString()); } catch { return null; }
  if (!Array.isArray(d.results)) return null;
  const labels = {};
  for (const x of d.results) if (x && x.path !== undefined && x.label !== undefined) labels[x.path] = String(x.label);
  return labels;
}

/**
 * One worker run: for clients' website-imported cars whose photo set is new or changed, download every photo, sort
 * them and keep the whole-car exterior shots. Dropped copies are deleted unless a saved record uses the file. Stops
 * after `budget` seconds; the next run continues. Returns log lines (same text as PHP).
 */
export async function dcsProcessPhotos(db, cfg, budget = 50, fetchFn = clientFetch, classify = (paths) => photoClassify(cfg, paths)) {
  const start = Date.now(), log = [], dir = String(cfg.asset_dir), base = String(cfg.public_base_url).replace(/\/+$/, '') + '/assets/';
  for (const key of stateIds(db, 'inventory:')) {
    for (const car of state(db, key)?.vehicles ?? []) {
      if (!car.photos_pending || (car.source ?? '') !== 'dcs') continue;
      if ((Date.now() - start) / 1000 > budget) return log;
      const map = await dcsStorePhotos(cfg, (car.photo_sources ?? []).slice(0, DCS_PHOTO_LIMIT), fetchFn);
      const labels = await classify(map.map(([, n]) => dir + '/' + n));
      let keep = []; const counts = {};
      for (const [, name] of map) {
        const label = labels === null ? 'unsorted' : labels[dir + '/' + name] ?? 'error';
        counts[label] = (counts[label] ?? 0) + 1;
        if (labels === null || label === 'exterior') keep.push(name);
      }
      // A model that found no exterior shot at all is more likely wrong than the website: keep everything.
      if (!keep.length && map.length) keep = map.map(([, n]) => n);
      for (const [, name] of map) if (!keep.includes(name) && existsSync(dir + '/' + name) && !stateMentions(db, name)) unlinkSync(dir + '/' + name);
      // Save only this car, on the latest copy of the inventory (an import may have run meanwhile).
      const inv = state(db, key) ?? { vehicles: [] };
      for (const v of inv.vehicles) {
        if (v.StockNumber === car.StockNumber && phpJsonEncode(v.photo_sources ?? []) === phpJsonEncode(car.photo_sources ?? [])) {
          v.photos = keep.map((n) => base + n); v.photo_labels = counts; v.photos_pending = false;
          v.photo_sources_done = car.photo_sources; v.photos_checked_at = gmdateC(); delete v.sheet_photos;
        }
      }
      save(db, key, inv);
      log.push(`${key} ${car.StockNumber}: ${map.length} photos, kept ${keep.length} exterior (${phpJsonEncode(counts)})`);
    }
  }
  return log;
}
