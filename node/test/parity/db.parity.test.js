// Data-layer parity: Node and PHP share agent.sqlite during the move, so rows each one writes must read back the same
// on the other side, and Node must write the exact bytes PHP would. Generated inventory-like values, temporary file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rng, vehicle } from './cases.js';
import { openDb, closeDb, save, state, jobInsert, jobGet } from '../../src/lib/db.js';

const app = fileURLToPath(new URL('../../../private/app.php', import.meta.url));
const hasPhp = spawnSync('php', ['-v']).status === 0;
const TEXT = ['Café', 'San José', 'Rogue’s', '😀 deal', 'a/b\\c "q"', ' nbsp', 'line\nbreak', 'tab\t', '\u007f', '', '0', 'https://x.com/a?b=1&c=2'];

function value(r, depth = 0) {
  const k = r();
  if (depth > 3 || k < 0.35) {
    const p = r();
    if (p < 0.3) return TEXT[Math.floor(r() * TEXT.length)];
    if (p < 0.5) return Math.floor(r() * 1e6) - 5000;
    if (p < 0.7) return Math.round(r() * 1e7) / 100;
    if (p < 0.8) return [true, false, null][Math.floor(r() * 3)];
    return [0.1, 1e-7, 123456789012, 9000, 1.5e300, -0.25][Math.floor(r() * 6)];
  }
  if (k < 0.5) return vehicle(r);
  if (k < 0.7) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth + 1));
  const o = {};
  for (let i = 0, n = Math.floor(r() * 5); i < n; i++) o[TEXT[Math.floor(r() * TEXT.length)] + i] = value(r, depth + 1);
  return o;
}
// json_decode($s, true) reads {} as [] and {"0":…,"1":…} as a list; JS objects list number-like keys first. Compare
// in a canonical form: such objects as lists, other objects with sorted keys.
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const keys = Object.keys(x);
    if (keys.every((k, i) => k === String(i))) return keys.map((k) => canon(x[k]));
    return Object.fromEntries(keys.sort().map((k) => [k, canon(x[k])]));
  }
  return x;
}

test('Node and PHP read and write the same SQLite rows, byte for byte', { skip: !hasPhp && 'php CLI not installed' }, () => {
  const dir = mkdtempSync(tmpdir() + '/ga-dbp-');
  const cfg = { data_dir: dir };
  try {
    const db = openDb(cfg);
    const r = rng(7), n = 300, values = [];
    for (let i = 0; i < n; i++) { const v = { case: i, v: value(r) }; values.push(v); save(db, 'node:' + i, v); }
    jobInsert(db, 'JN', 'fp-node', { id: 'JN', status: 'queued', price: 9000, vehicle: 'Café 4WD' });
    // PHP reads every Node row with state() and writes it back with save(); then writes its own job.
    const php = `require $argv[1];$db=db(['data_dir'=>$argv[2]]);
      for($i=0;$i<${n};$i++){$v=state($db,'node:'.$i);save($db,'php:'.$i,$v);}
      $q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute(['JN']);$j=json_decode($q->fetchColumn(),true);
      $j['id']='JP';$j['status']='completed';$db->prepare('INSERT INTO jobs VALUES (?,?,?)')->execute(['JP','fp-php',json_encode($j)]);`;
    const res = spawnSync('php', ['-r', php, app, dir], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const raw = (id) => db.prepare('SELECT payload FROM state WHERE id = ?').get(id).payload;
    const bad = [];
    for (let i = 0; i < n; i++) {
      if (raw('node:' + i) !== raw('php:' + i)) bad.push({ i, node: raw('node:' + i), php: raw('php:' + i) });
      else if (JSON.stringify(canon(state(db, 'php:' + i))) !== JSON.stringify(canon(values[i]))) bad.push({ i, read: state(db, 'php:' + i), wrote: values[i] });
    }
    assert.equal(bad.length, 0, 'mismatches:\n' + JSON.stringify(bad.slice(0, 3), null, 1));
    assert.deepEqual(jobGet(db, 'JP'), { id: 'JP', status: 'completed', price: 9000, vehicle: 'Café 4WD' }, 'job written by PHP reads in Node');
  } finally {
    closeDb(cfg);
    rmSync(dir, { recursive: true, force: true });
  }
});
