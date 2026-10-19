#!/usr/bin/env node
// Snapshot sync from the command line: node src/cli/dealercenter-sync.js [--client <id>] snapshot.json [zip-dir].
// Reads the snapshot JSON, updates the client's inventory (default Golden Auto's DealerCenter list) in the shared
// database and prints the change log. Other clients: a website that blocks this server, read in a browser.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { dcSync } from '../lib/dealercenter.js';

const args = process.argv.slice(2);
let client = 'golden-auto';
const at = args.indexOf('--client');
if (at !== -1) { client = args[at + 1] ?? ''; args.splice(at, 2); }
const [snapshotPath, zipDir] = args;
if (!snapshotPath || !client) { console.error('usage: node src/cli/dealercenter-sync.js [--client <id>] snapshot.json [zip-dir]'); process.exit(2); }
try {
  const cfg = loadConfig();
  const log = await dcSync(openDb(cfg), cfg, JSON.parse(readFileSync(snapshotPath, 'utf8')), zipDir ?? null, undefined, client);
  console.log(JSON.stringify(log, null, 4));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
