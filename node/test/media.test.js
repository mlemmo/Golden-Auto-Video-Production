// Photo import and the asset sheet (FFmpeg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { importMedia, importMediaZip, assetSheet, defaultSheetPhotos, mbSafeText, validateAppBase } from '../src/lib/media.js';
import { probeImage } from '../src/lib/images.js';
import { writeZip, readZip } from '../src/lib/zip.js';
import { JPEG_40x30, PNG_20x20_TRANSPARENT, JPEG_1800x900 } from './fixtures/images.js';

const fields = { stock: '870288', year: '2013', make: 'Subaru', model: 'XV Crosstrek', prices: '$14,550; 14688.25', mileage: '60123', description: 'Clean <b>Carfax</b>' };

test('photo import: natural order, ≤1600 px JPEGs on white, files removed on failure', () => {
  const dir = mkdtempSync(tmpdir() + '/ga-med-');
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343' };
  try {
    const zip = dir + '/m.zip';
    writeFileSync(zip, writeZip([['photo_10.jpg', Buffer.from(JPEG_40x30, 'base64')], ['photo_2.png', Buffer.from(PNG_20x20_TRANSPARENT, 'base64')],
      ['big.jpg', Buffer.from(JPEG_1800x900, 'base64')], ['notes.txt', Buffer.from('x')], ['__MACOSX/photo_1.jpg', Buffer.from('x')]]));
    const v = importMediaZip(zip, fields, cfg);
    assert.deepEqual(v.original_filenames, ['big.jpg', 'photo_2.png', 'photo_10.jpg'], 'natural order; other files ignored');
    assert.deepEqual([v.price, v.VehiclePrice, v.Odometer, v.Make, v.description], [14688.25, 14688.25, 60123, 'SUBARU', 'Clean Carfax']);
    const sizes = v.photos.map((u) => probeImage(readFileSync(cfg.asset_dir + '/' + u.split('/').pop())));
    assert.deepEqual(sizes.map((s) => [s.width, s.height, s.type]), [[1600, 800, 'jpeg'], [20, 20, 'jpeg'], [40, 30, 'jpeg']]);
    assert.match(v.photos[0], /^https:\/\/node\.example\.com:4343\/assets\/[a-f0-9]{40}\.jpg$/);
    const before = readdirSync(cfg.asset_dir).length;
    assert.throws(() => importMedia([{ name: 'a.jpg', bytes: Buffer.from(JPEG_40x30, 'base64') }, { name: 'b.jpg', bytes: Buffer.from('nope') }], fields, cfg), /Invalid or oversized/);
    assert.equal(readdirSync(cfg.asset_dir).length, before, 'the first photo of a failed import is removed');
    assert.throws(() => importMediaZip(zip, { ...fields, year: '1899' }, cfg), /vehicle year/, 'fields checked before the ZIP');
    assert.throws(() => mbSafeText('x'.repeat(20001)), /too long/);
    assert.throws(() => validateAppBase({ public_base_url: 'https://localhost:4343' }), /public/);
    assert.equal(readZip(writeZip([['a', Buffer.from('b')]]))[0].data().toString(), 'b');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('asset sheet: picks, record fields and a JPEG sheet', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-sht-');
  const cfg = { asset_dir: dir + '/assets', public_base_url: 'https://node.example.com:4343' };
  try {
    mkdirSync(cfg.asset_dir);
    const photos = [];
    for (const [i, b64] of [JPEG_1800x900, JPEG_40x30, JPEG_1800x900, JPEG_40x30, PNG_20x20_TRANSPARENT].entries()) {
      // Sheet photos are this server's imported JPEGs (40-hex names).
      const name = String(i).repeat(40).slice(0, 40).replace(/[^0-9a-f]/g, 'a') + '.jpg';
      writeFileSync(cfg.asset_dir + '/' + name, Buffer.from(i === 4 ? JPEG_40x30 : b64, 'base64'));
      photos.push(cfg.public_base_url + '/assets/' + name);
    }
    const v = { Year: 2013, Make: 'SUBARU', Model: 'XV CROSSTREK', StockNumber: '870288', photos, sheet_photos: [3, 1, 2, 4] };
    for (const selected of [[], photos]) {
      const node = await assetSheet(v, cfg, selected);
      const want = selected.length ? selected : defaultSheetPhotos(v);
      assert.deepEqual(node.photo_urls, want, 'the chosen photos, in order');
      assert.equal(node.photo_count, want.length);
      assert.match(node.gallery_hash, /^[a-f0-9]{64}$/); assert.match(node.content_hash, /^[a-f0-9]{64}$/);
      const ns = probeImage(readFileSync(cfg.asset_dir + '/' + node.url.split('/').pop()));
      assert.ok(ns.width >= 300 && ns.height >= 300, 'sheet size');
    }
    assert.deepEqual(defaultSheetPhotos(v), [photos[2], photos[0], photos[1], photos[3]], 'saved front/side/side/rear picks');
    await assert.rejects(assetSheet(v, cfg, ['https://elsewhere/x.jpg']), /Choose 1–9 photos/);
    await assert.rejects(assetSheet({ ...v, photos: [] }, cfg), /No photos/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
