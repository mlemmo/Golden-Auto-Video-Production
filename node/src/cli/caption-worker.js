#!/usr/bin/env node
// Caption worker (cron, every minute): auto build, then one queued final render (src/lib/worker.js). Node version of
// private/caption_worker.php. One run at a time: a lock folder in data_dir, taken over when older than 20 minutes
// (a run that died; PHP marks a render stuck after 15).
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { captionWorkerRun } from '../lib/worker.js';

const cfg = loadConfig();
if (String(cfg.render_backend ?? 'linux') !== 'linux') process.exit(0);
const lock = String(cfg.data_dir) + '/caption-worker.lock.d';
try { mkdirSync(lock); }
catch {
  try { if (Date.now() - statSync(lock).mtimeMs < 20 * 60 * 1000) process.exit(0); rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); }
  catch { process.exit(0); }
}
try {
  for (const line of await captionWorkerRun(openDb(cfg), cfg)) console.log(line);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
