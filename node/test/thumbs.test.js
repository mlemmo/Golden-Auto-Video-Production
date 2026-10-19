// Car card thumbnails: which photo is used, and the small copy made once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mainPhoto, thumbUrl, withThumbs, THUMB_WIDTH } from '../src/lib/thumbs.js';
import { probeImage } from '../src/lib/images.js';
import { JPEG_1800x900, JPEG_40x30 } from './fixtures/images.js';

test('main photo: the first asset-sheet pick, else the first photo', () => {
  assert.equal(mainPhoto({ photos: ['a', 'b', 'c'], sheet_photos: [2, 3, 1] }), 'b', 'front view picked for the sheet');
  assert.equal(mainPhoto({ photos: ['a', 'b'] }), 'a');
  assert.equal(mainPhoto({ photos: ['a'], sheet_photos: [5] }), 'a', 'a pick that no longer exists falls back');
  assert.equal(mainPhoto({ photos: [] }), null);
  assert.equal(mainPhoto({}), null);
});

test('thumbnails are small JPEGs made once in assets/thumbs', () => {
  const dir = mkdtempSync(tmpdir() + '/ga-thumb-');
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://site.example.com:4343/' };
  try {
    mkdirSync(cfg.asset_dir);
    const big = 'a'.repeat(40) + '.jpg', small = 'b'.repeat(40) + '.jpg', base = 'https://site.example.com:4343/assets/';
    writeFileSync(cfg.asset_dir + '/' + big, Buffer.from(JPEG_1800x900, 'base64'));
    writeFileSync(cfg.asset_dir + '/' + small, Buffer.from(JPEG_40x30, 'base64'));
    assert.equal(thumbUrl(cfg, base + big), base + 'thumbs/' + big);
    const t = probeImage(readFileSync(cfg.asset_dir + '/thumbs/' + big));
    assert.deepEqual([t.width, t.height, t.type], [THUMB_WIDTH, 180, 'jpeg'], 'scaled to 360 px wide, same shape');
    const made = statSync(cfg.asset_dir + '/thumbs/' + big).mtimeMs;
    thumbUrl(cfg, base + big);
    assert.equal(statSync(cfg.asset_dir + '/thumbs/' + big).mtimeMs, made, 'made once');
    assert.equal(probeImage(readFileSync(cfg.asset_dir + '/thumbs/' + (thumbUrl(cfg, base + small).split('/').pop()))).width, 40, 'small photos are not enlarged');
    for (const bad of ['https://elsewhere.com/assets/' + big, base + '../x.jpg', base + 'c'.repeat(40) + '.jpg', null]) assert.equal(thumbUrl(cfg, bad), null, String(bad));
    const inv = { checked_at: 'x', vehicles: [{ StockNumber: '1', photos: [base + small, base + big], sheet_photos: [2] }, { StockNumber: '2', photos: [] }] };
    const out = withThumbs(cfg, inv);
    assert.deepEqual([out.checked_at, out.vehicles[0].thumb, out.vehicles[1].thumb], ['x', base + 'thumbs/' + big, undefined]);
    assert.equal(inv.vehicles[0].thumb, undefined, 'the saved record is not changed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
