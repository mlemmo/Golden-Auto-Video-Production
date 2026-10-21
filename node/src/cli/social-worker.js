#!/usr/bin/env node
// Social worker (cron, every minute): publishes due Facebook and Instagram posts step by step (src/lib/social.js).
// One run at a time: a lock folder in data_dir, taken over when older than 15 minutes (a run that died).
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { socialWorkerRun } from '../lib/social.js';
import { gmdateC } from '../lib/text.js';

const cfg = loadConfig();
const lock = String(cfg.data_dir) + '/social-worker.lock.d';
try { mkdirSync(lock); }
catch {
  try { if (Date.now() - statSync(lock).mtimeMs < 15 * 60 * 1000) process.exit(0); rmSync(lock, { recursive: true, force: true }); mkdirSync(lock); }
  catch { process.exit(0); }
}
try {
  for (const line of await socialWorkerRun(openDb(cfg), cfg)) console.log(gmdateC() + ' ' + line);
} catch (e) {
  console.log(gmdateC() + ' social worker failed: ' + e.message);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
