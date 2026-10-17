// Image work with FFmpeg (already on the server; no npm image library): what PHP does with GD — reading an image's
// size and type, re-encoding/resizing photos to JPEG on white, and drawing the car asset sheet. Output is not
// byte-identical to GD (different JPEG encoder, DejaVu Sans instead of GD's bitmap font); sizes, layout and text are.
// Like GD, EXIF rotation is ignored (-noautorotate), so photos keep the orientation PHP gave them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
export const FONT = process.env.SHEET_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const FONT_BOLD = process.env.SHEET_FONT_BOLD ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const IMAGE_CODECS = new Set(['mjpeg', 'png', 'webp', 'gif', 'bmp']);

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 28, timeout: 120000 });
  if (r.error) throw new Error(cmd + ' could not run: ' + r.error.message);
  return r;
}

/** getimagesizefromstring(): { width, height, type } for JPEG/PNG/WebP/GIF/BMP bytes, or null. */
export function probeImage(buf) {
  if (!buf || buf.length < 8) return null;
  const r = run(FFPROBE, ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json'], buf);
  if (r.status !== 0) return null;
  const s = JSON.parse(r.stdout.toString() || '{}').streams?.[0];
  if (!s || !IMAGE_CODECS.has(s.codec_name) || !(s.width > 0) || !(s.height > 0)) return null;
  return { width: s.width, height: s.height, type: s.codec_name === 'mjpeg' ? 'jpeg' : s.codec_name };
}

/** GD quality 0–100 → FFmpeg MJPEG -q:v 2–31 (92 → 2, 88 → 3). */
const qscale = (q) => Math.max(2, Math.min(31, Math.round(2 + (100 - q) / 4)));

/**
 * Re-encode an image as JPEG: scaled to width × height (default: as is), transparency flattened onto white like
 * imagecreatetruecolor + white fill + imagecopyresampled. Returns the JPEG bytes.
 */
export function toJpeg(buf, { width, height, quality = 92 } = {}) {
  const size = probeImage(buf);
  if (!size) throw new Error('Unsupported image.');
  const w = width ?? size.width, h = height ?? size.height;
  const filter = `[0:v]scale=${w}:${h}:flags=bicubic,format=rgba[p];color=white:s=${w}x${h}[bg];[bg][p]overlay=format=auto:shortest=1,format=yuvj444p`;
  const r = run(FFMPEG, ['-v', 'error', '-noautorotate', '-f', 'image2pipe', '-i', 'pipe:0', '-filter_complex', filter, '-frames:v', '1', '-q:v', String(qscale(quality)), '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], buf);
  if (r.status !== 0 || r.stdout.length < 100) throw new Error('Cannot convert the image.');
  return r.stdout;
}

/**
 * Draw a sheet: a width × height canvas in colour bg ("#121720"), each tile = { bytes, x, y, w, h } scaled to w × h at
 * (x, y), and texts = { text, x, y, size, color, bold }. Returns JPEG bytes (quality as GD's 92).
 */
export function renderSheet({ width, height, bg, tiles, texts, quality = 92 }) {
  const dir = mkdtempSync(tmpdir() + '/ga-sheet-');
  try {
    const args = ['-v', 'error', '-noautorotate'];
    tiles.forEach((t, i) => { const f = `${dir}/t${i}`; writeFileSync(f, t.bytes); args.push('-f', 'image2', '-i', f); });
    let chain = `color=${bg}:s=${width}x${height}[c0]`, last = 'c0';
    tiles.forEach((t, i) => {
      chain += `;[${i}:v]scale=${t.w}:${t.h}:flags=bicubic,format=rgba[s${i}];[${last}][s${i}]overlay=${t.x}:${t.y}:format=auto:shortest=1[c${i + 1}]`;
      last = `c${i + 1}`;
    });
    texts.forEach((t, i) => {
      const f = `${dir}/text${i}.txt`; writeFileSync(f, t.text);
      chain += `;[${last}]drawtext=fontfile=${t.bold ? FONT_BOLD : FONT}:textfile=${f}:x=${t.x}:y=${t.y}:fontsize=${t.size}:fontcolor=${t.color}[d${i}]`;
      last = `d${i}`;
    });
    chain += `;[${last}]format=yuvj444p[out]`;
    const out = `${dir}/sheet.jpg`;
    const r = run(FFMPEG, [...args, '-filter_complex', chain, '-map', '[out]', '-frames:v', '1', '-q:v', String(qscale(quality)), '-y', out]);
    if (r.status !== 0) throw new Error('Cannot draw the asset sheet: ' + r.stderr.toString().slice(0, 300));
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
