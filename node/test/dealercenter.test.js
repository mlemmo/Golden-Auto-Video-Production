// Snapshot sync: DealerCenter (Golden Auto) and Dealer.com photo hosts, per-client inventory and change log.
// No network: photo downloads are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save, state } from '../src/lib/db.js';
import { dcNormalize, dcPhotoId, dcSync, syncLogKey, snapshotImportStart } from '../src/lib/dealercenter.js';
import { downloadPhotos } from '../src/lib/media.js';
import { JPEG_1800x900 } from './fixtures/images.js';

const car = (stock, photo_urls, extra = {}) => ({ stock, year: 2022, make: 'Lexus', model: 'RX 350', trim: 'F SPORT', mileage: 30120, prices: [42914], photo_urls, ...extra });
const ddc = (id, q = '?impolicy=downsize&w=640') => `https://pictures.dealer.com/e/eastbaymotorcarsca/1234/${id}.jpg${q}`;

test('photo URLs: DealerCenter as before, Dealer.com originals; other hosts refused', () => {
  assert.equal(dcPhotoId('https://imagescf.dealercenter.net/640/480/logo-folder/202401-abc.jpg'), '202401-abc.jpg', 'DealerCenter ids unchanged, overlay dropped');
  assert.equal(dcPhotoId(ddc('a1b2c3')), 'pictures.dealer.com/e/eastbaymotorcarsca/1234/a1b2c3.jpg', 'resize parameters dropped');
  for (const bad of ['http://pictures.dealer.com/e/x/1/a.jpg', 'https://pictures.dealer.com/../etc/passwd', 'https://pictures.dealer.com.evil.com/e/x/1/a.jpg', 'https://evil.com/e/x/1/a.jpg', 'https://pictures.dealer.com/e/x/1/a.exe'])
    assert.equal(dcPhotoId(bad), null, bad);
  const s = dcNormalize(car('E1', [ddc('p1'), ddc('p1', ''), ddc('p2')]));
  assert.deepEqual(s.photo_urls, ['https://pictures.dealer.com/e/eastbaymotorcarsca/1234/p1.jpg', 'https://pictures.dealer.com/e/eastbaymotorcarsca/1234/p2.jpg'], 'same photo listed twice kept once');
  assert.equal(s.photo_count, 2);
  assert.throws(() => dcNormalize(car('E2', ['https://cdn.example.com/a.jpg'])), /imagescf\.dealercenter\.net or pictures\.dealer\.com/);
});

test('downloads only from the vehicle photo hosts', async () => {
  await assert.rejects(downloadPhotos(['https://cdn.example.com/a.jpg']), /not from the vehicle image provider/);
  await assert.rejects(downloadPhotos(['http://pictures.dealer.com/e/x/1/a.jpg']), /not from the vehicle image provider/);
});

test('a client snapshot fills that client’s inventory and log, not Golden Auto’s', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-dc-');
  const cfg = { asset_dir: dir, public_base_url: 'https://staging.example.com:4343' };
  const db = openMemoryDb();
  save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'eastbay-motorcars', name: 'Eastbay Motorcars', website: 'https://www.eastbaymotorcars.net' }] });
  save(db, 'inventory', { vehicles: [{ StockNumber: 'G1', source: 'zip', Year: 2013, Make: 'SUBARU', Model: 'XV', photos: [] }] });
  const asked = [];
  const download = async (urls) => { asked.push(...urls); return Object.fromEntries(urls.map((_, i) => [i, Buffer.from(JPEG_1800x900, 'base64')])); };
  try {
    const log = await dcSync(db, cfg, [car('E1', [ddc('p1'), ddc('p2')]), car('E2', [ddc('p3')], { prices: [] })], null, download, 'eastbay-motorcars');
    assert.equal(log.source, 'snapshot');
    assert.equal(log.added.length, 2);
    assert.ok(asked.every((u) => u.startsWith('https://pictures.dealer.com/') && !u.includes('?')), 'originals downloaded from Dealer.com');
    const inv = state(db, 'inventory:eastbay-motorcars');
    assert.deepEqual(inv.vehicles.map((v) => [v.StockNumber, v.price, v.photos.length, v.feed]), [['E1', 42914, 2, 'snapshot'], ['E2', null, 1, 'snapshot']]);
    assert.ok(state(db, 'sheet:' + inv.vehicles[0].Vin), 'asset sheet built');
    assert.deepEqual(state(db, 'inventory').vehicles.map((v) => [v.StockNumber, v.active ?? true]), [['G1', true]], 'Golden Auto untouched');
    assert.equal(state(db, 'sync_log'), null, 'Golden Auto log untouched');
    assert.equal(state(db, syncLogKey('eastbay-motorcars')).entries.length, 1);
    // Next snapshot: E2 sold, E1 price change, no new downloads for unchanged photos.
    asked.length = 0;
    const next = await dcSync(db, cfg, [car('E1', [ddc('p1', '?w=320'), ddc('p2')], { prices: [41914] })], null, download, 'eastbay-motorcars');
    assert.deepEqual([next.price_changed.length, next.removed, asked.length], [1, ['E2 2022 LEXUS RX 350'], 0]);
    await assert.rejects(dcSync(db, cfg, [car('X', [ddc('p9')])], null, download, 'nobody'), /client/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('snapshot from the dashboard: checked, saved, one import per client at a time', () => {
  const dir = mkdtempSync(tmpdir() + '/ga-snap-');
  const cfg = { asset_dir: dir, data_dir: dir };
  const db = openMemoryDb();
  save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'eastbay-motorcars', name: 'Eastbay Motorcars', website: 'https://www.eastbaymotorcars.net' }] });
  const runs = [];
  const run = (c, client, file, lock) => runs.push({ client, file, lock });
  try {
    assert.throws(() => snapshotImportStart(db, cfg, 'nobody', [car('E1', [ddc('p1')])], run), /client/i);
    assert.throws(() => snapshotImportStart(db, cfg, 'eastbay-motorcars', [], run), /1–500/);
    assert.throws(() => snapshotImportStart(db, cfg, 'eastbay-motorcars', [car('E1', ['https://evil.com/a.jpg'])], run), /photos must come from/);
    assert.equal(runs.length, 0, 'nothing started for a bad snapshot');
    const r = snapshotImportStart(db, cfg, 'eastbay-motorcars', [car('E1', [ddc('p1')]), car('E2', [ddc('p2')])], run);
    assert.ok(r.message.includes('2 vehicles') && runs.length === 1 && JSON.parse(readFileSync(runs[0].file, 'utf8')).length === 2);
    assert.throws(() => snapshotImportStart(db, cfg, 'eastbay-motorcars', [car('E1', [ddc('p1')])], run), /still running/);
    rmSync(runs[0].lock, { recursive: true });
    snapshotImportStart(db, cfg, 'eastbay-motorcars', [car('E1', [ddc('p1')])], run);
    assert.equal(runs.length, 2, 'next import once the previous one finished');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
