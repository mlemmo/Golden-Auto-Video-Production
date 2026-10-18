// Saved spokesperson library: images live in the assets folder, metadata in state row "spokespersons".
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, chmodSync, readFileSync } from 'node:fs';
import { state, save } from './db.js';
import { trim, str, gmdateC, U_SPACE } from './text.js';
import { probeImage } from './images.js';
import { SPOKESPERSON_DEFAULT_DESCRIPTION } from './prompts.js';

const SPACES = new RegExp(U_SPACE + '+', 'gu');
export const spokespersonDir = (cfg) => String(cfg.asset_dir ?? '');

export function spokespersonLibrary(db, cfg, random = randomBytes) {
  let lib = state(db, 'spokespersons');
  if (lib === null) {
    // First run: register the original single spokesperson image so nothing is lost.
    lib = { items: [], default: null };
    for (const legacy of ['spokesperson.png', 'spokesperson.jpg', 'spokesperson.jpeg', 'spokesperson.webp']) if (existsSync(spokespersonDir(cfg) + '/' + legacy)) {
      const id = random(8).toString('hex');
      lib.items.push({ id, name: 'Original spokesperson', description: SPOKESPERSON_DEFAULT_DESCRIPTION, file: legacy, created_at: gmdateC() });
      lib.default = id; break;
    }
    save(db, 'spokespersons', lib);
  }
  if (!Array.isArray(lib.items)) lib.items = [];
  return lib;
}
export const spokespersonPublic = (item, cfg) => ({ ...item, url: item.url ?? str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/' + item.file });
export function spokespersonFind(db, cfg, id) {
  for (const item of spokespersonLibrary(db, cfg).items) if (item.id === id) return spokespersonPublic(item, cfg);
  throw new Error('Choose a spokesperson. Upload one under Spokespersons if the list is empty.');
}
export function spokespersonClean(s, max, field) {
  s = trim(s.replace(SPACES, ' '));
  if (s === '') throw new Error('Enter the spokesperson ' + field + '.');
  if ([...s].length > max) throw new Error('Spokesperson ' + field + ' must be at most ' + max + ' characters.');
  if (s.includes('"')) throw new Error('Do not use double quotes in the spokesperson ' + field + '.');
  return s;
}

/** files.image: { tmp_name, size, error } from the multipart upload (src/lib/multipart.js), (error 0 = OK). */
export function spokespersonApi(action, inp, cfg, db, files = {}, random = randomBytes) {
  const lib = spokespersonLibrary(db, cfg, random);
  if (action === 'spokesperson_list') { /* list only */ }
  else if (action === 'spokesperson_upload') {
    const name = spokespersonClean(str(inp.name ?? ''), 60, 'name'), description = spokespersonClean(str(inp.description ?? ''), 300, 'description');
    const file = files.image ?? null;
    if (!file || file.error !== 0 || !existsSync(file.tmp_name)) throw new Error('Image upload failed. The file may be too large or the upload was interrupted.');
    if (file.size > 20000000) throw new Error('Spokesperson image must be 20 MB or smaller.');
    const size = probeImage(readFileSync(file.tmp_name));
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[size?.type] ?? null;
    if (!size || !ext) throw new Error('Upload a JPG, PNG or WebP image.');
    if (size.width * size.height > 16000000) throw new Error('Spokesperson image is too large to decode; keep it under 16 megapixels.');
    if (size.width < 300 || size.height < 300) throw new Error('Spokesperson image must be at least 300×300 pixels.');
    const dir = spokespersonDir(cfg);
    try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { throw new Error('Cannot create assets folder.'); }
    const id = random(8).toString('hex'), stored = 'spokesperson-' + id + '.' + ext;
    try { copyFileSync(file.tmp_name, dir + '/' + stored); unlinkSync(file.tmp_name); } catch { throw new Error('Could not save the spokesperson image.'); }
    chmodSync(dir + '/' + stored, 0o644);
    lib.items.push({ id, name, description, file: stored, created_at: gmdateC() });
    lib.default ??= id; save(db, 'spokespersons', lib);
  } else if (action === 'spokesperson_default') {
    const id = str(inp.id ?? ''); spokespersonFind(db, cfg, id); lib.default = id; save(db, 'spokespersons', lib);
  } else if (action === 'spokesperson_delete') {
    const id = str(inp.id ?? ''); const item = spokespersonFind(db, cfg, id);
    lib.items = lib.items.filter((i) => i.id !== id);
    if (lib.default === id) lib.default = lib.items[0]?.id ?? null;
    save(db, 'spokespersons', lib);
    // Only uploaded files are removed; the original spokesperson.* stays on disk.
    const path = spokespersonDir(cfg) + '/' + item.file;
    if (item.file.startsWith('spokesperson-') && existsSync(path)) unlinkSync(path);
  } else throw new Error('Unknown action.');
  return { items: lib.items.map((i) => spokespersonPublic(i, cfg)), default: lib.default };
}
