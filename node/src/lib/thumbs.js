// Car card thumbnails: one small JPEG per car (its main photo, at most 360 px wide), made once with FFmpeg and kept in
// public/assets/thumbs/ next to the photos (served from disk like the other assets).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { probeImage, toJpeg } from './images.js';
import { str } from './text.js';

export const THUMB_WIDTH = 360;
const PHOTO_NAME = /^[a-f0-9]{40}\.(jpg|jpeg|png|webp)$/i;

/**
 * The photo that best shows the whole car: the first asset-sheet pick (the front view, chosen per car), otherwise the
 * first photo (the listing's main photo; website imports keep only whole-car exterior shots). Null without photos.
 */
export function mainPhoto(v) {
  const photos = Array.isArray(v.photos) ? v.photos : [];
  const first = Array.isArray(v.sheet_photos) && v.sheet_photos.length ? photos[Number(v.sheet_photos[0]) - 1] : undefined;
  return first ?? photos[0] ?? null;
}

/** Public address of the thumbnail for one of this site's photos, made on first use; null when it cannot be made. */
export function thumbUrl(cfg, url) {
  const base = str(cfg.public_base_url).replace(/\/+$/, '') + '/assets/';
  if (typeof url !== 'string' || !url.startsWith(base)) return null;
  const name = url.slice(base.length);
  if (!PHOTO_NAME.test(name)) return null;
  const out = name.replace(/\.\w+$/, '.jpg'), dir = cfg.asset_dir + '/thumbs', path = dir + '/' + out;
  if (!existsSync(path)) {
    try {
      const src = readFileSync(cfg.asset_dir + '/' + name), size = probeImage(src);
      if (!size) return null;
      const w = Math.min(THUMB_WIDTH, size.width), h = Math.max(1, Math.round((size.height * w) / size.width));
      mkdirSync(dir, { recursive: true });
      writeFileSync(path + '.tmp', toJpeg(src, { width: w, height: h, quality: 80 }), { mode: 0o644 });
      renameSync(path + '.tmp', path);
    } catch { return null; }
  }
  return base + 'thumbs/' + out;
}

/** An inventory record with each car's thumbnail address added (thumb); the saved record is not changed. */
export function withThumbs(cfg, inv) {
  return { ...inv, vehicles: (inv.vehicles ?? []).map((v) => { const t = thumbUrl(cfg, mainPhoto(v)); return t ? { ...v, thumb: t } : v; }) };
}
