import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { phpJsonEncode } from '../src/lib/phpjson.js';
import { openDb, closeDb, state, save, stateIds, stateMentions, jobGet, jobInsert, jobSave, jobsList } from '../src/lib/db.js';

test('phpJsonEncode writes JSON the way PHP json_encode does', () => {
  assert.equal(phpJsonEncode({ url: 'https://x.com/a', city: 'San José', n: 9000, f: 14688.25 }), '{"url":"https:\\/\\/x.com\\/a","city":"San Jos\\u00e9","n":9000,"f":14688.25}');
  assert.equal(phpJsonEncode({}), '[]');
  assert.equal(phpJsonEncode([]), '[]');
  assert.equal(phpJsonEncode({ 0: 'a', 1: 'b' }), '["a","b"]');
  assert.equal(phpJsonEncode({ 0: 'a', 2: 'b' }), '{"0":"a","2":"b"}');
  assert.equal(phpJsonEncode('😀'), '"\\ud83d\\ude00"');
  assert.equal(phpJsonEncode(1e25), '1.0e+25');
  assert.equal(phpJsonEncode({ a: undefined, b: null }), '{"b":null}');
  assert.throws(() => phpJsonEncode(NaN));
});

test('state rows and jobs in the shared SQLite file', () => {
  const dir = mkdtempSync(tmpdir() + '/ga-db-');
  const cfg = { data_dir: dir + '/data' };
  try {
    const db = openDb(cfg);
    assert.equal(statSync(cfg.data_dir).mode & 0o777, 0o700, 'data folder created private, like PHP');
    assert.equal(state(db, 'inventory'), null);
    save(db, 'inventory', { vehicles: [{ StockNumber: '870288', price: 14688.25, photos: ['https://x/a.jpg'] }] });
    save(db, 'inventory:bay-motors', { vehicles: [] });
    save(db, 'inventory', { vehicles: [{ StockNumber: '870288', price: 9000 }] });
    assert.deepEqual(state(db, 'inventory'), { vehicles: [{ StockNumber: '870288', price: 9000 }] }, 'save replaces');
    assert.deepEqual(stateIds(db, 'inventory:'), ['inventory:bay-motors']);
    assert.deepEqual(stateIds(db, 'inv%'), [], 'LIKE wildcards in the prefix are literal');
    assert.ok(stateMentions(db, '870288') && !stateMentions(db, 'nope'));
    jobInsert(db, 'J1', 'fp1', { id: 'J1', status: 'queued' });
    jobInsert(db, 'J2', null, { id: 'J2', status: 'completed' });
    jobInsert(db, 'J3', null, { id: 'J3', status: 'completed' });
    assert.throws(() => jobInsert(db, 'J4', 'fp1', { id: 'J4' }), /UNIQUE/, 'duplicate request fingerprint refused');
    jobSave(db, { id: 'J1', status: 'completed' });
    assert.equal(jobGet(db, 'J1').status, 'completed');
    assert.deepEqual(jobsList(db, 2).map((j) => j.id), ['J3', 'J2'], 'newest first');
    assert.equal(openDb(cfg), db, 'one connection per file');
  } finally {
    closeDb(cfg);
    rmSync(dir, { recursive: true, force: true });
  }
});
