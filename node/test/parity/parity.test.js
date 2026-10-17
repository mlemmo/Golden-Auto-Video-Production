// Runs every ported helper and its PHP original on the same generated inputs and requires identical results.
// Needs the php CLI (present on the server and in dev); skipped when php is missing. No network, no paid APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCases } from './cases.js';
import * as speech from '../../src/lib/speech.js';
import * as captions from '../../src/lib/captions.js';
import * as price from '../../src/lib/price.js';
import * as scripts from '../../src/lib/scripts.js';

const fns = { ...speech, ...captions, ...price, ...scripts };
const harness = fileURLToPath(new URL('./harness.php', import.meta.url));
const hasPhp = spawnSync('php', ['-v']).status === 0;

function runPhp(cases) {
  const res = spawnSync('php', ['-d', 'memory_limit=1G', harness], { input: JSON.stringify(cases), maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error('PHP harness failed: ' + res.stderr.toString());
  return JSON.parse(res.stdout.toString());
}
function runNode(c) {
  try { return { ok: fns[c.fn](...structuredClone(c.args)) }; } catch (e) { return { error: e.message }; }
}
// Floats must agree to 1e-9 s; everything else exactly. PHP's empty array and JSON null/undefined are normalised.
function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
  }
  return a === b;
}

test('Node helpers match PHP on generated inputs', { skip: !hasPhp && 'php CLI not installed' }, () => {
  const seeds = (process.env.PARITY_SEEDS ?? '1,2,3').split(',').map(Number);
  let total = 0;
  for (const seed of seeds) {
    const cases = buildCases(seed, Number(process.env.PARITY_COUNT ?? 300));
    const php = runPhp(cases);
    const bad = [];
    cases.forEach((c, i) => {
      const node = JSON.parse(JSON.stringify(runNode(c)) ?? 'null');
      if (!same(node, php[i])) bad.push({ fn: c.fn, args: c.args, php: php[i], node });
    });
    total += cases.length;
    assert.equal(bad.length, 0, `seed ${seed}: ${bad.length} mismatches, first:\n` + JSON.stringify(bad.slice(0, 3), null, 1));
  }
  assert.ok(total > 0);
});
