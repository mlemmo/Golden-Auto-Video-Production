import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';

test('config is read from private/config.json; asset_dir defaults to public/assets', () => {
  const root = mkdtempSync(tmpdir() + '/ga-cfg-');
  try {
    mkdirSync(root + '/private');
    writeFileSync(root + '/private/config.json', JSON.stringify({ data_dir: root + '/private/data', public_base_url: 'https://node.example.com:4343', respell: { 'San Ramon': 'San Rah-moan' } }));
    const cfg = loadConfig(root);
    assert.equal(cfg.data_dir, root + '/private/data');
    assert.equal(cfg.asset_dir, root + '/public/assets');
    assert.deepEqual(cfg.respell, { 'San Ramon': 'San Rah-moan' });
    mkdirSync(root + '/broken/private', { recursive: true });
    writeFileSync(root + '/broken/private/config.json', '{"higgsfield_key": "secret-value", oops');
    assert.throws(() => loadConfig(root + '/broken'), (e) => /Could not read private\/config.json/.test(e.message) && !e.message.includes('secret'), 'a broken file is reported without its contents');
    assert.throws(() => loadConfig(root + '/nope'), /Could not read private\/config.json/, 'a missing file is reported');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
