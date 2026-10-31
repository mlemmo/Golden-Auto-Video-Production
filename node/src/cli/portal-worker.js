#!/usr/bin/env node
// Portal worker (long-running, systemd later): asks the LotSpotlight portal for jobs and runs them (src/lib/portal-client.js).
// Settings from the environment: PORTAL_API, WORKER_ID, WORKER_SECRET, optional POLL_SECONDS (default 15).
// Stops cleanly on SIGTERM/SIGINT after the job in hand. Not started by any service yet (Milestone 1 skeleton).
import { portalClient, runOnce } from '../lib/portal-client.js';
import { gmdateC } from '../lib/text.js';

const log = (line) => console.log(gmdateC() + ' ' + line);
const client = portalClient({ api: process.env.PORTAL_API, workerId: process.env.WORKER_ID, secret: process.env.WORKER_SECRET });
const pollMs = Math.max(5, Number(process.env.POLL_SECONDS) || 15) * 1000;

let stopping = false, wake = () => {};
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; wake(); log(`${sig}: stopping after the current job`); });
const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });

log(`portal worker ${process.env.WORKER_ID} started`);
while (!stopping) {
  try {
    if (!await runOnce(client, undefined, { log })) await sleep(pollMs);
  } catch (e) {
    log('portal worker: ' + e.message);
    await sleep(pollMs);
  }
}
log('portal worker stopped');
