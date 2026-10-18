// One-time conversion of a PHP-era private/config.json into private/config.json (mode 600). Run from the checkout:
//   node node/src/cli/config-from-php.js
// It needs the PHP CLI this once; the values are never printed. An existing config.json is left alone.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { ROOT } from '../lib/config.js';

const root = process.argv[2] ?? ROOT, src = root + '/private/config.json', dst = root + '/private/config.json';
if (existsSync(dst)) { console.log('private/config.json already exists; nothing changed.'); process.exit(0); }
if (!existsSync(src)) { console.error('No private/config.json to convert.'); process.exit(1); }
const res = spawnSync('php', ['-r', 'echo json_encode(require $argv[1], JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT);', src], { encoding: 'utf8' });
if (res.status !== 0) { console.error('Could not read private/config.json (php exited ' + res.status + ').'); process.exit(1); }
JSON.parse(res.stdout);  // must be valid before it is written
writeFileSync(dst, res.stdout + '\n', { mode: 0o600 });
chmodSync(dst, 0o600);
console.log('Wrote private/config.json (mode 600). private/config.json can be deleted once the site works.');
