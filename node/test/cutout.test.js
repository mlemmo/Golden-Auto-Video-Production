// The car cut out of its lot photos for the video model, and the end of her speech. No paid calls; the background
// removal is a fake (the real one needs the rembg venv, config cutout_python).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb } from '../src/lib/db.js';
import { cutoutSheet } from '../src/lib/media.js';
import { promptNative, finalWords } from '../src/lib/prompts.js';
import { JPEG_1800x900 } from './fixtures/images.js';

test('the cut-out sheet is built from the sheet photos, saved and reused', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-cut-');
  const cfg = { asset_dir: dir, public_base_url: 'https://staging.example.com:4343' };
  const db = openMemoryDb();
  const photo = (n) => n.repeat(40) + '.jpg';
  for (const n of ['a', 'b']) writeFileSync(dir + '/' + photo(n), Buffer.from(JPEG_1800x900, 'base64'));
  const v = { StockNumber: 'S1', Year: 2015, Make: 'VOLKSWAGEN', Model: 'GOLF', photos: ['a', 'b'].map((n) => cfg.public_base_url + '/assets/' + photo(n)) };
  const sheet = { url: cfg.public_base_url + '/assets/sheet.jpg', photo_urls: v.photos, content_hash: 'h1' };
  let calls = 0;
  const cut = async (c, images) => { calls++; assert.equal(images.length, 2); return images; };
  try {
    assert.equal(await cutoutSheet(v, cfg, db, sheet), null, 'not set up: the original sheet is used');
    const r = await cutoutSheet(v, cfg, db, sheet, { cut });
    assert.ok(r.url.startsWith(cfg.public_base_url + '/assets/') && existsSync(dir + '/' + r.url.split('/').pop()));
    const again = await cutoutSheet(v, cfg, db, sheet, { cut });
    assert.deepEqual([again.url, calls], [r.url, 1], 'reused for the same photos');
    await assert.rejects(cutoutSheet(v, cfg, db, { ...sheet, content_hash: 'h2' }, { cut: async () => { throw new Error('Background removal failed.'); } }), /Background removal failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('her final words are named and the talking window fits her real pace', () => {
  const speech = 'Explore this twenty fifteen Volkswagen Golf. Book your test drive at my golden auto dot net.';
  assert.equal(finalWords(speech), 'Her final words are "at my golden auto dot net.": she says them only once, then immediately stops talking, closes her mouth and smiles warmly; she never says them again. ');
  const p = promptNative({ Year: 2015, Make: 'VW', Model: 'Golf' }, speech, 15, 'adult woman', 'speech', 10.96);
  assert.ok(p.includes('finishes by 10.6 seconds') && p.includes('Her final words are'), 'window ends when she really finishes (8% faster than the recording)');
});
