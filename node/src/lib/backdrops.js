// Showroom backdrops for photo slideshows: the car in its whole-car exterior photos is cut out (free, local rembg
// model, private/backdrop.py run with config cutout_python) and stood on a backdrop; interior, detail, open-door and
// text photos are left as they are (sorted by the local CLIP model, photoClassify). Built-in backdrops are seamless
// studio sweeps; admins can upload photos of their own showroom (state row "backdrops", files in assets/backdrops).
// Results are cached per photo and backdrop in data_dir/backdrop-cache, so every shape of one build reuses them.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, accessSync, constants, mkdirSync, copyFileSync, unlinkSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { state, save } from './db.js';
import { str, trim, gmdateC } from './text.js';
import { probeImage } from './images.js';
import { photoClassify } from './photos.js';

const COMPOSER = fileURLToPath(new URL('../../../private/backdrop.py', import.meta.url));
const VERSION = 2;   // bump when backdrop.py changes how pictures look, so cached ones are redrawn
export const BUILTIN_BACKDROPS = [{ id: 'studio', name: 'Studio — charcoal' }, { id: 'white', name: 'Studio — white' }];
const backdropDir = (cfg) => str(cfg.asset_dir ?? '') + '/backdrops';
const library = (db) => state(db, 'backdrops') ?? { items: [] };

/** Whether this server can cut cars out (config cutout_python points at a Python with rembg). */
export function backdropsAvailable(cfg) {
  const python = str(cfg.cutout_python ?? '');
  if (python === '') return false;
  try { accessSync(python, constants.X_OK); return true; } catch { return false; }
}

/** A backdrop by id: a built-in sweep, or an uploaded photo with its file checked; null for '' (original photos). */
export function backdropFind(db, cfg, id) {
  id = str(id);
  if (id === '') return null;
  const builtin = BUILTIN_BACKDROPS.find((b) => b.id === id);
  if (builtin) return { ...builtin, spec: id };
  const item = library(db).items.find((i) => i.id === id);
  if (!item) throw new Error('That background was removed. Choose another or "Original photos".');
  const path = backdropDir(cfg) + '/' + item.file;
  if (!/^backdrop-[a-f0-9]{16}\.(jpg|png|webp)$/.test(item.file) || !existsSync(path)) throw new Error('The background photo is missing. Upload it again.');
  return { ...item, spec: path };
}

/** backdrop_list (everyone), backdrop_upload and backdrop_delete (admins). */
export function backdropApi(action, inp, cfg, db, files = {}, { random = randomBytes } = {}) {
  const lib = library(db);
  if (action === 'backdrop_upload') {
    const name = trim(str(inp.name ?? '').replace(/[\u0000-\u001f]/g, '')).slice(0, 60);
    if (name === '') throw new Error('Give the background a name.');
    const file = files.backdrop ?? null;
    if (!file || file.error !== 0 || !existsSync(file.tmp_name)) throw new Error('Upload failed. The file may be too large or the upload was interrupted.');
    if (file.size > 20000000) throw new Error('Background photos must be 20 MB or smaller.');
    const size = probeImage(readFileSync(file.tmp_name));
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[size?.type] ?? null;
    if (!size || !ext) throw new Error('Upload a JPG, PNG or WebP photo.');
    if (size.width < 1200 || size.height < 700) throw new Error('Use a background photo at least 1200 × 700 pixels.');
    if (size.width * size.height > 40000000) throw new Error('The photo is too large to use; keep it under 40 megapixels.');
    const dir = backdropDir(cfg);
    try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { throw new Error('Cannot create the backgrounds folder.'); }
    const id = random(8).toString('hex'), stored = 'backdrop-' + id + '.' + ext;
    try { copyFileSync(file.tmp_name, dir + '/' + stored); unlinkSync(file.tmp_name); } catch { throw new Error('Could not save the background photo.'); }
    chmodSync(dir + '/' + stored, 0o644);
    lib.items.push({ id, name, file: stored, created_at: gmdateC() });
    save(db, 'backdrops', lib);
  } else if (action === 'backdrop_delete') {
    const id = str(inp.id ?? '');
    const item = BUILTIN_BACKDROPS.some((b) => b.id === id) ? null : backdropFind(db, cfg, id);
    if (!item) throw new Error('Built-in backgrounds cannot be deleted.');
    lib.items = lib.items.filter((i) => i.id !== id); save(db, 'backdrops', lib);
    try { unlinkSync(item.spec); } catch { /* already gone */ }
  } else if (action !== 'backdrop_list') throw new Error('Unknown action.');
  const base = str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/backdrops/';
  return { available: backdropsAvailable(cfg), builtin: BUILTIN_BACKDROPS, items: lib.items.map((i) => ({ id: i.id, name: i.name, url: base + i.file })) };
}

/** Run private/backdrop.py: { items: [{ src, out }], backdrop } → the outputs written (a failed picture is skipped). */
export function backdropCompose(cfg, items, spec, layout = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(str(cfg.cutout_python), ['-I', COMPOSER], { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.stdout.on('data', (d) => out.push(d));
    p.on('error', () => { clearTimeout(timer); reject(new Error('Background replacement could not start.')); });
    p.on('close', (code) => {
      clearTimeout(timer);
      let d = null; try { d = JSON.parse(Buffer.concat(out).toString()); } catch { /* reported below */ }
      if (code !== 0 || !Array.isArray(d?.files)) return reject(new Error('Background replacement failed.'));
      resolve(d.files);
    });
    p.stdin.on('error', () => {});
    p.stdin.end(JSON.stringify({ items, backdrop: spec, ...layout }));
  });
}

/**
 * How a backdrop picture is drawn for a video of size [w, h]: built-in sweeps at the video's own size (in a tall frame
 * the car stands a little below the middle, clear of the captions); an uploaded showroom photo at 4:3 with the car on
 * its floor line (the slideshow shows it like any other photo).
 */
export function backdropLayout(backdrop, [w, h]) {
  if (BUILTIN_BACKDROPS.some((b) => b.id === backdrop.id)) return { width: w, height: h, floor: h > w * 1.2 ? 0.64 : 0.86 };
  return { width: 1600, height: 1200, floor: 0.86 };
}

/**
 * The slideshow's photo files with the backdrop applied to whole-car exterior shots (in place: files[i].file is
 * replaced by the composed picture). Labels and pictures are cached by photo content; without a classifier no photo
 * is changed (a cut-out interior would look broken). Returns the number of photos replaced.
 */
export async function applyBackdrop(cfg, files, backdrop, size, { classify = (paths) => photoClassify(cfg, paths), compose = backdropCompose } = {}) {
  const cache = str(cfg.data_dir ?? '') + '/backdrop-cache';
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const layout = backdropLayout(backdrop, size);
  const key = backdrop.id + (backdrop.file ? ':' + backdrop.file : '') + `:${layout.width}x${layout.height}`;
  const sums = files.map((f) => createHash('sha256').update(readFileSync(f.file)).digest('hex'));
  // Labels: cached ones, then one classifier run for the rest.
  const labels = sums.map((h) => { try { return readFileSync(`${cache}/${h}.label`, 'utf8'); } catch { return null; } });
  const unknown = files.map((f, i) => (labels[i] === null ? i : -1)).filter((i) => i >= 0);
  if (unknown.length) {
    const got = classify(unknown.map((i) => files[i].file));
    if (!got) return 0;
    for (const i of unknown) { labels[i] = str(got[files[i].file] ?? 'error'); writeFileSync(`${cache}/${sums[i]}.label`, labels[i]); }
  }
  const outs = sums.map((h) => `${cache}/${createHash('sha256').update(VERSION + '|' + key + '|' + h).digest('hex')}.jpg`);
  const todo = files.map((f, i) => i).filter((i) => labels[i] === 'exterior' && !existsSync(outs[i]));
  if (todo.length) await compose(cfg, todo.map((i) => ({ src: files[i].file, out: outs[i] })), backdrop.spec, layout);
  let n = 0;
  files.forEach((f, i) => { if (labels[i] === 'exterior' && existsSync(outs[i])) { f.file = outs[i]; f.size = { width: layout.width, height: layout.height }; n++; } });
  return n;
}
