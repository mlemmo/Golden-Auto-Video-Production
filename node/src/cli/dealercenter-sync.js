#!/usr/bin/env node
// DealerCenter sync from the command line: node src/cli/dealercenter-sync.js snapshot.json [zip-dir].
// Reads the snapshot JSON, updates Golden Auto's inventory in the shared database and prints the change log.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { dcSync } from '../lib/dealercenter.js';

const [snapshotPath, zipDir] = process.argv.slice(2);
if (!snapshotPath) { console.error('usage: node src/cli/dealercenter-sync.js snapshot.json [zip-dir]'); process.exit(2); }
try {
  const cfg = loadConfig();
  const log = await dcSync(openDb(cfg), cfg, JSON.parse(readFileSync(snapshotPath, 'utf8')), zipDir ?? null);
  console.log(JSON.stringify(log, null, 4));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
