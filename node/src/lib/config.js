// Configuration: read once from private/config.json (mode 600, gitignored), so secrets live in one place and are
// never copied, printed or committed. asset_dir defaults to <root>/public/assets. A site still on the PHP-era
// private/config.json converts it once with: node src/cli/config-from-php.js (needs the PHP CLI that one time).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The checkout this service runs from (…/node/src/lib → …). */
export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

let loaded = null;
export function loadConfig(root = process.env.GOLDEN_ROOT ?? ROOT) {
  if (loaded && loaded.root === root) return loaded.cfg;
  let cfg;
  // Never echo the file or the parser's message: either could contain parts of a secret.
  try { cfg = JSON.parse(readFileSync(root + '/private/config.json', 'utf8')); }
  catch { throw new Error('Could not read private/config.json (missing or not valid JSON). Convert private/config.json with node src/cli/config-from-php.js.'); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('private/config.json must hold one JSON object.');
  cfg.asset_dir ??= root + '/public/assets';
  loaded = { root, cfg };
  return cfg;
}
/** Tests: use a given config instead of private/config.json. */
export function setConfig(cfg, root = ROOT) { loaded = { root, cfg }; }
