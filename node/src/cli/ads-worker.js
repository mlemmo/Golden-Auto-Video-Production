#!/usr/bin/env node
// Ads worker (cron, every minute): launches Meta ad requests PAUSED through Meta's Marketing API, applies Switch on /
// Pause, pauses ads past their end date and refreshes spend/views/clicks (src/lib/meta-ads.js).
// One run at a time: a lock folder in data_dir, taken over when older than 15 minutes (a run that died).
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { adsWorkerRun } from '../lib/meta-ads.js';
import { gmdateC } from '../lib/text.js';

const cfg = loadConfig();
const lock = String(cfg.data_dir) + '/ads-worker.lock.d';
try { mkdirSync(lock); }
catch {
  try { if (Date.now() - statSync(lock).mtimeMs < 15 * 60 * 1000) process.exit(0); rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); }
  catch { process.exit(0); }
}
try {
  for (const line of await adsWorkerRun(openDb(cfg), cfg)) console.log(gmdateC() + ' ' + line);
} catch (e) {
  console.log(gmdateC() + ' ads worker failed: ' + e.message);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
