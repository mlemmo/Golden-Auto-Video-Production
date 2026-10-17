// Configuration: read once from private/config.php through the PHP CLI, so secrets live in one place and are never
// copied, printed or committed. asset_dir defaults to <root>/public/assets as in public/index.php.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The checkout this service runs from (…/node/src/lib → …). */
export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

let loaded = null;
export function loadConfig(root = process.env.GOLDEN_ROOT ?? ROOT) {
  if (loaded && loaded.root === root) return loaded.cfg;
  const res = spawnSync('php', ['-r', 'echo json_encode(require $argv[1], JSON_THROW_ON_ERROR);', root + '/private/config.php'], { encoding: 'utf8' });
  // Never echo PHP's output here: on a syntax error it could contain parts of the file.
  if (res.status !== 0) throw new Error('Could not read private/config.php (php exited ' + res.status + ').');
  const cfg = JSON.parse(res.stdout);
  cfg.asset_dir ??= root + '/public/assets';
  loaded = { root, cfg };
  return cfg;
}
/** Tests: use a given config instead of private/config.php. */
export function setConfig(cfg, root = ROOT) { loaded = { root, cfg }; }
