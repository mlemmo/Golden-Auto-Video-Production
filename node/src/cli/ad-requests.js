#!/usr/bin/env node
// TikTok ads, by hand (src/lib/ads.js, docs/ADS_LAUNCH.md). Meta ads are launched by the ads worker (src/cli/ads-worker.js).
//   node src/cli/ad-requests.js pending              → JSON: TikTok requests to launch and TikTok ads past their end date
//   node src/cli/ad-requests.js record <id> tiktok key=value …
//        keys: status (launched_paused, active, paused, ended, failed, canceled), campaign_id, ad_group_id, ad_id, error,
//              spend, impressions, clicks
// Reads the site's private/config.json (run it from the site folder, e.g. /srv/golden-auto-staging/node).
import { loadConfig } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { adPending, adRecord } from '../lib/ads.js';

const [cmd, id, platform, ...pairs] = process.argv.slice(2);
const db = openDb(loadConfig());
if (cmd === 'pending') console.log(JSON.stringify(adPending(db), null, 2));
else if (cmd === 'record' && id && platform) {
  const fields = Object.fromEntries(pairs.map((p) => { const i = p.indexOf('='); if (i < 1) throw new Error('Use key=value: ' + p); return [p.slice(0, i), p.slice(i + 1)]; }));
  const a = adRecord(db, id, platform, fields);
  console.log(JSON.stringify({ id: a.id, platform, ...a.platforms[platform] }, null, 2));
} else {
  console.error('Usage: ad-requests.js pending | record <id> tiktok key=value …');
  process.exit(2);
}
