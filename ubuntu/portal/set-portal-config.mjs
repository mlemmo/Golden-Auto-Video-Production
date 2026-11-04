// Records the portal's API address and its pages' addresses in a site's private/config.json (portal_api: { url,
// origins }); a copy of the previous file is kept as config.json.bak-before-portal-api. Used by setup-portal-root.sh:
//   node ubuntu/portal/set-portal-config.mjs /srv/golden-auto-staging/private/config.json <api-host> <pages-host>
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const [file, api, pages] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(file, 'utf8'));
cfg.portal_api = { ...(cfg.portal_api ?? {}) };
if (api) cfg.portal_api.url = `https://${api}:4343`;
if (pages) cfg.portal_api.origins = [`https://${pages}:4343`, `https://${pages}`];
copyFileSync(file, file + '.bak-before-portal-api');
writeFileSync(file + '.tmp', JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
renameSync(file + '.tmp', file);
console.log(`portal_api: ${JSON.stringify(cfg.portal_api)}`);
