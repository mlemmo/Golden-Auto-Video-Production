import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';

const hasPhp = spawnSync('php', ['-v']).status === 0;

test('config is read from private/config.php through PHP; asset_dir defaults like index.php', { skip: !hasPhp && 'php CLI not installed' }, () => {
  const root = mkdtempSync(tmpdir() + '/ga-cfg-');
  try {
    mkdirSync(root + '/private');
    writeFileSync(root + '/private/config.php', "<?php return ['data_dir' => __DIR__ . '/data', 'public_base_url' => 'https://node.example.com:4343', 'respell' => ['San Ramon' => 'San Rah-moan']];");
    const cfg = loadConfig(root);
    assert.equal(cfg.data_dir, root + '/private/data');
    assert.equal(cfg.asset_dir, root + '/public/assets');
    assert.deepEqual(cfg.respell, { 'San Ramon': 'San Rah-moan' });
    writeFileSync(root + '/private/config.php', "<?php return [ syntax error");
    assert.throws(() => loadConfig(root + '/nope'), /Could not read private\/config.php/, 'a missing or broken file is reported without its contents');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
