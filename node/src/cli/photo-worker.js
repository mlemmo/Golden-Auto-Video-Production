#!/usr/bin/env node
// Photo worker (cron, every minute): copies and sorts photos of website-imported client cars (src/lib/photos.js).
// Node version of private/photo_worker.php. One run at a time: a lock folder in data_dir, taken over when older than
// 15 minutes (a run that died). Free: public photo downloads, FFmpeg and the local image model.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { dcsProcessPhotos } from '../lib/photos.js';
import { gmdateC } from '../lib/php.js';

const cfg = loadConfig();
const lock = String(cfg.data_dir) + '/photo-worker.lock.d';
try { mkdirSync(lock); }
catch {
  try { if (Date.now() - statSync(lock).mtimeMs < 15 * 60 * 1000) process.exit(0); rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); }
  catch { process.exit(0); }
}
try {
  for (const line of await dcsProcessPhotos(openDb(cfg), cfg, 50)) console.log(gmdateC() + ' ' + line);
} catch (e) {
  console.log(gmdateC() + ' photo worker failed: ' + e.message);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
