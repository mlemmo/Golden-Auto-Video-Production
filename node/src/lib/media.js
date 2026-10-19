// Vehicle photos: importing a DealerCenter media ZIP (or a list of downloaded photos), downloading DealerCenter CDN
// photos, and the car asset sheet sent to the video model. Image work is done with FFmpeg
// (src/lib/images.js).
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { readZip } from './zip.js';
import { probeImage, toJpeg, renderSheet } from './images.js';
import { trim, upper, lower, filterValidateInt, strnatcasecmp, stripTags, strlen, isNumeric, toFloat, gmdateC, parseUrl, str } from './text.js';
import { title } from './price.js';
import { jsonEncode } from './storedjson.js';

const assetDir = (cfg) => String(cfg.asset_dir ?? '');

/** publicImage(): a public https image address (no credentials, port or IP host). */
export function publicImage(url) {
  const p = parseUrl(url) || {};
  const host = lower(p.host ?? '');
  if (p.scheme !== 'https' || !host.includes('.') || /^[0-9.]+$/.test(host) || host.startsWith('[') || p.user !== undefined || p.pass !== undefined || p.port !== undefined)
    throw new Error('Use a public HTTPS image URL without credentials or a custom port.');
  if (/(?:^|\.)(localhost|local|internal)$/.test(host)) throw new Error('Use a publicly hosted reference image.');
  return url;
}
/** validateAppBase(): the dashboard's public origin (https on port 4343, or local http for testing). */
export function validateAppBase(cfg) {
  const base = str(cfg.public_base_url ?? '').replace(/\/+$/, '');
  const u = parseUrl(base) || {};
  const clean = u.user === undefined && u.pass === undefined && !/[?#]/.test(base);
  if (cfg.allow_local_http && u.scheme === 'http' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.host ?? '') && u.port === 4343 && clean) return base;
  if (u.scheme === 'https' && u.port === 4343 && clean) { publicImage('https://' + (u.host ?? '') + '/image.jpg'); return base; }
  publicImage(base + '/image.jpg');
  return base;
}

/** mbSafeText(): descriptions up to 20,000 bytes, tags removed, trimmed. */
export function mbSafeText(s) {
  if (strlen(s) > 20000) throw new Error('Description is too long.');
  return trim(stripTags(s));
}

/**
 * importMediaZip() for already-read images: images = [{ name, bytes }] (from a ZIP or a download). Validates the
 * listing fields, sorts photos by name naturally, saves each as a ≤1600 px JPEG on white with a
 * random 40-hex name, and returns the vehicle. On any failure the files written so far are removed.
 */
export function importMedia(images, fields, cfg) {
  const stock = trim(str(fields.stock ?? ''));
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(stock)) throw new Error('Enter a valid stock number.');
  const year = filterValidateInt(fields.year ?? null);
  if (!year || year < 1900 || year > new Date().getUTCFullYear() + 2) throw new Error('Enter the vehicle year.');
  const make = trim(str(fields.make ?? '')), model = trim(str(fields.model ?? ''));
  if (!make || !model || strlen(make) > 60 || strlen(model) > 100) throw new Error('Enter make and model.');
  const vin = upper(trim(str(fields.vin ?? '')));
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new Error('VIN must be 17 characters or left blank.');
  const prices = [];
  for (let p of str(fields.prices ?? '').split(';')) {
    p = trim(p.replace(/[$,]/g, ''));
    if (p === '') continue;
    if (!isNumeric(p) || toFloat(p) <= 0) throw new Error('Enter positive advertised prices, separated by semicolons.');
    prices.push(toFloat(p));
  }
  const mile = trim(str(fields.mileage ?? ''));
  if (mile !== '' && (!/^[0-9]+$/.test(mile) || Number(mile) > 2000000)) throw new Error('Mileage must be digits or blank.');
  const description = mbSafeText(str(fields.description ?? ''));
  const base = validateAppBase(cfg);
  if (images === null) return null;  // fields checked only (importMediaZip)
  const entries = images.filter((e) => /\.(jpg|jpeg|png|webp)$/i.test(e.name));
  if (!entries.length || entries.length > 100) throw new Error('ZIP must contain 1–100 supported images.');
  entries.sort((a, b) => strnatcasecmp(a.name, b.name));
  const dir = assetDir(cfg);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  const created = [], photos = [], originals = [];
  try {
    for (const e of entries) {
      const size = probeImage(e.bytes);
      if (!size || size.width * size.height > 16000000) throw new Error('Invalid or oversized image in ZIP.');
      const ratio = Math.min(1, 1600 / size.width, 1600 / size.height);
      const jpg = toJpeg(e.bytes, { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 92 });
      const name = randomBytes(20).toString('hex') + '.jpg';
      writeFileSync(dir + '/' + name, jpg, { mode: 0o644 }); created.push(dir + '/' + name);
      photos.push(base + '/assets/' + name); originals.push(e.name);
    }
  } catch (err) {
    for (const f of created) try { unlinkSync(f); } catch { /* already gone */ }
    throw err;
  }
  return { source: 'zip', StockNumber: stock, Vin: vin || 'stock:' + stock, Year: year, Make: upper(make), Model: upper(model), Trim: trim(str(fields.trim ?? '')),
    Drivetrain: trim(str(fields.drivetrain ?? '')), ExteriorColor: '', Odometer: mile === '' ? null : Number(mile), VehiclePrice: prices.length ? Math.max(...prices) : 0,
    price: prices.length ? Math.max(...prices) : null, description, photos, original_filenames: originals, imported_at: gmdateC(), url: '', detail_checked_at: gmdateC() };
}

/** importMediaZip(): a DealerCenter media ZIP file → vehicle (ZIP rules: ≤50 MB, ≤150 entries, safe paths). */
export function importMediaZip(path, fields, cfg) {
  importMedia(null, fields, cfg);  // the listing fields first, before opening the ZIP
  if (!existsSync(path) || statSync(path).size > 50000000) throw new Error('ZIP must be under 50 MB.');
  const zip = readZip(readFileSync(path));
  if (zip.length > 150) throw new Error('ZIP has too many entries.');
  const images = []; let total = 0;
  for (const e of zip) {
    if (e.name.includes('..') || e.name.startsWith('/') || e.name.includes('\\')) throw new Error('Invalid ZIP paths.');
    if (e.name.endsWith('/') || e.name.startsWith('__MACOSX/') || !/\.(jpg|jpeg|png|webp)$/i.test(e.name)) continue;
    total += e.size;
    if (e.size > 10000000 || total > 200000000) throw new Error('ZIP image data is too large.');
    images.push({ name: e.name, bytes: e.data() });
  }
  return importMedia(images, fields, cfg);
}

/** Vehicle photo hosts the server downloads from: DealerCenter and Dealer.com image servers (neither blocks it). */
export const PHOTO_HOSTS = ['imagescf.dealercenter.net', 'pictures.dealer.com'];
/** downloadPhotos(): vehicle photos from PHOTO_HOSTS only, in parallel; index → bytes for the ones that arrived (200, ≤4 MB). */
export async function downloadPhotos(urls) {
  for (const url of urls) if (!PHOTO_HOSTS.includes((parseUrl(url) || {}).host) || !String(url).startsWith('https://')) throw new Error('Photo is not from the vehicle image provider.');
  const out = {};
  await Promise.all(urls.map(async (url, i) => {
    try {
      const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'GoldenAutoInventoryVideo/1.0' }, signal: AbortSignal.timeout(25000) });
      if (r.status !== 200) return;
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length <= 4000000) out[i] = b;
    } catch { /* missing; the caller retries or reports */ }
  }));
  return out;
}

/** defaultSheetPhotos(): the saved front/side/side/rear picks (1-based), else the first four photos. */
export function defaultSheetPhotos(v) {
  const all = v.photos ?? [];
  const picked = [];
  for (const n of v.sheet_photos ?? []) if (all[n - 1] !== undefined) picked.push(all[n - 1]);
  return picked.length ? picked : all.slice(0, 4);
}

/** sheetBytes(): photo bytes by position, from this server's assets or downloaded from the CDN. */
export async function sheetBytes(urls, cfg, download = downloadPhotos) {
  const base = str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/';
  const out = {}, remote = {};
  urls.forEach((url, i) => {
    const name = url.startsWith(base) ? url.slice(base.length) : '';
    if (/^[a-f0-9]{40}\.jpg$/.test(name)) {
      const file = assetDir(cfg) + '/' + name;
      if (!existsSync(file) || statSync(file).size > 10000000) throw new Error('Imported photo is missing or too large.');
      out[i] = readFileSync(file);
    } else remote[i] = url;
  });
  const keys = Object.keys(remote);
  if (keys.length) { const got = await download(keys.map((k) => remote[k])); keys.forEach((k, j) => { if (got[j]) out[k] = got[j]; }); }
  return out;
}

/**
 * assetSheet(): the reference sheet for the video model — up to 9 original photos in a 2- (≤4 photos) or 3-column
 * grid on a dark background, with the car's name and stock number and "SOURCE PHOTO n" under each, drawn with
 * FFmpeg. Returns the sheet record saved as state 'sheet:<VIN>'.
 */
export async function assetSheet(v, cfg, selected = [], download = downloadPhotos) {
  const base = validateAppBase(cfg);
  const all = v.photos ?? [];
  if (!all.length) throw new Error('No photos found for this vehicle.');
  const urls = selected.length ? selected : defaultSheetPhotos(v);
  if (urls.length > 9 || urls.length < 1 || urls.some((u) => !all.includes(u))) throw new Error('Choose 1–9 photos from this vehicle gallery.');
  const bytes = await sheetBytes(urls, cfg, download);
  if (Object.keys(bytes).length !== urls.length) throw new Error('A vehicle photo could not be downloaded. No incomplete sheet was saved; try again or choose other photos.');
  const cols = urls.length <= 4 ? 2 : 3, width = 1800, tileW = Math.trunc(width / cols), boxW = tileW - 30, boxH = Math.round(boxW * 0.737);
  const rows = Math.ceil(urls.length / cols), height = 100 + rows * (boxH + 40);
  const tiles = [], texts = [
    { text: title(v) + ' | STOCK ' + str(v.StockNumber ?? ''), x: 24, y: 20, size: 22, color: '#efbd64', bold: true },
    { text: 'Original inventory photos - source views only; no invented angles or features', x: 24, y: 52, size: 16, color: '#f4f4f4' },
  ];
  const hash = createHash('sha256');
  urls.forEach((url, i) => {
    const size = probeImage(bytes[i]);
    if (!size || size.width * size.height > 16000000) throw new Error('Invalid or excessively large source image.');
    const x = (i % cols) * tileW + 15, y = 100 + Math.floor(i / cols) * (boxH + 40);
    const ratio = Math.min(boxW / size.width, boxH / size.height), w = Math.round(size.width * ratio), h = Math.round(size.height * ratio);
    tiles.push({ bytes: bytes[i], x: x + Math.trunc((boxW - w) / 2), y: y + Math.trunc((boxH - h) / 2), w, h });
    texts.push({ text: 'SOURCE PHOTO ' + (all.indexOf(url) + 1), x, y: y + boxH + 8, size: 16, color: '#f4f4f4' });
    hash.update(bytes[i]);
  });
  const jpg = renderSheet({ width, height, bg: '#121720', tiles, texts, quality: 92 });
  const dir = assetDir(cfg);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  const name = randomBytes(20).toString('hex') + '.jpg';
  writeFileSync(dir + '/' + name, jpg, { mode: 0o644 });
  return { url: base + '/assets/' + name, photo_urls: urls, gallery_hash: createHash('sha256').update(jsonEncode(all)).digest('hex'),
    content_hash: hash.digest('hex'), created_at: gmdateC(), photo_count: urls.length };
}
