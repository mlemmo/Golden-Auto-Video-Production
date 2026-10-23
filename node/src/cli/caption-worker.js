#!/usr/bin/env node
// Caption worker (cron, every minute): the auto build, then every queued final render, one after the other
// without waiting for the next minute (config render_parallel for more at once) (src/lib/worker.js captionWorkerDrain).
// One run at a time: a lock folder in data_dir, kept fresh while rendering and taken over when older than 20 minutes
// (a run that died; a render is marked stuck after 15).
import { mkdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { captionWorkerDrain } from '../lib/worker.js';

const cfg = loadConfig();
if (String(cfg.render_backend ?? 'linux') !== 'linux') process.exit(0);
const lock = String(cfg.data_dir) + '/caption-worker.lock.d';
try { mkdirSync(lock); }
catch {
  try { if (Date.now() - statSync(lock).mtimeMs < 20 * 60 * 1000) process.exit(0); rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); }
  catch { process.exit(0); }
}
try {
  const touch = () => { try { const t = new Date(); utimesSync(lock, t, t); } catch { /* lock gone */ } };
  for (const line of await captionWorkerDrain(openDb(cfg), cfg, { touch })) console.log(line);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
