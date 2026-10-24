// Snapshot sync: DealerCenter (Golden Auto) and Dealer.com photo hosts, per-client inventory and change log.
// No network: photo downloads are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb, save, state } from '../src/lib/db.js';
import { dcNormalize, dcCleanDescription, dcPhotoId, dcSync, syncLogKey, snapshotImportStart } from '../src/lib/dealercenter.js';
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

test('descriptions lose the website\'s Cloudflare script text', () => {
  const text = 'Reach out to us for more details or to schedule a test drive today!';
  const cf = " window.__CF$cv$params={r:'a4d99104affbaf1b',t:'MTc5MjUxNTQ5Nw==',i:60};(function(){if(!document.body)return;var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/precursor/main.js';document.head.appendChild(s);})();";
  assert.equal(dcCleanDescription(text + cf), text);
  assert.equal(dcCleanDescription(text + " (function(){if(!document.body)return;var s=1;})();"), text);
  assert.equal(dcCleanDescription('A great car (function and form).'), 'A great car (function and form).', 'ordinary brackets stay');
});

test('DealerCenter list-only cars: a saved car stays active and unchanged, a new one waits for details', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-dc-list-');
  const cfg = { asset_dir: dir, public_base_url: 'https://staging.example.com:4343' };
  const db = openMemoryDb();
  save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }] });
  const saved = (stock, extra = {}) => ({ StockNumber: stock, Vin: 'V' + stock, source: 'zip', Year: 2015, Make: 'HONDA', Model: 'ODYSSEY', price: 15026.25, Odometer: 99587, photos: ['https://x/a.jpg'], dc_photo_count: 1, ...extra });
  save(db, 'inventory', { vehicles: [saved('053326'), saved('101049', { Make: 'BMW', Model: 'S1000 XR' }), saved('428316', { active: false, Make: 'TOYOTA', Model: 'COROLLA' })] });
  const download = async (urls) => Object.fromEntries(urls.map((_, i) => [i, Buffer.from(JPEG_1800x900, 'base64')]));
  try {
    assert.throws(() => dcNormalize({ stock: 'X1', list_only: true, vin: 'bad' }), /invalid VIN/);
    const log = await dcSync(db, cfg, [
      { stock: '053326', vin: '5FNRL5H69FB053326', list_only: true, title: '2015 HONDA ODYSSEY EX-L MINIVAN 4D' },   // saved, not on the website yet
      { stock: '428316', list_only: true },                                                                        // was hidden, back in inventory
      { stock: '050440', list_only: true, title: '2014 MERCEDES-BENZ S-CLASS S 550 SEDAN 4D' },                    // new, no details yet
    ], null, download);
    const inv = Object.fromEntries(state(db, 'inventory').vehicles.map((v) => [v.StockNumber, v]));
    assert.ok(inv['053326'].active !== false && inv['053326'].price === 15026.25 && inv['053326'].Odometer === 99587, 'kept active, details unchanged');
    assert.equal(inv['428316'].active, true, 'returned');
    assert.equal(inv['101049'].active, false, 'gone from DealerCenter: hidden');
    assert.ok(!inv['050440'], 'a new car is not added without details');
    assert.deepEqual(log.kept_listed, ['053326 2015 HONDA ODYSSEY', '428316 2015 TOYOTA COROLLA']);
    assert.deepEqual(log.waiting_details, ['050440 2014 MERCEDES-BENZ S-CLASS S 550 SEDAN 4D (in DealerCenter, not on the website yet)']);
    assert.deepEqual(log.returned, ['428316 2015 TOYOTA COROLLA']);
    assert.deepEqual(log.removed, ['101049 2015 BMW S1000 XR']);
    assert.equal(log.active_count, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('details from DealerCenter with keep_photos: saved photos stay, a new car waits for photos', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-dc-keep-');
  const cfg = { asset_dir: dir, public_base_url: 'https://staging.example.com:4343' };
  const db = openMemoryDb();
  save(db, 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }] });
  save(db, 'inventory', { vehicles: [{ StockNumber: '053326', Vin: '5FNRL5H69FB053326', source: 'zip', Year: 2015, Make: 'HONDA', Model: 'ODYSSEY', ExteriorColor: '-', Odometer: 99587, price: 15026.25, photos: ['https://x/a.jpg'], dc_photo_key: 'k', dc_photo_count: 27 }] });
  let downloads = 0;
  const download = async (urls) => { downloads += urls.length; return {}; };
  try {
    const base = { year: 2015, make: 'HONDA', model: 'ODYSSEY', trim: 'EX-L MINIVAN 4D', drivetrain: 'FWD', prices: [15026.25, 14888], description: 'From DealerCenter.', keep_photos: true };
    const log = await dcSync(db, cfg, [{ ...base, stock: '053326', vin: '5FNRL5H69FB053326', color: 'GRAY', mileage: 99610 }, { ...base, stock: '050440', vin: 'WDDUG8CB7EA050440', make: 'MERCEDES-BENZ', model: 'S-CLASS', mileage: 101270 }], null, download);
    const v = state(db, 'inventory').vehicles.find((x) => x.StockNumber === '053326');
    assert.ok(v.ExteriorColor === 'GRAY' && v.Odometer === 99610 && v.description === 'From DealerCenter.', 'details from DealerCenter');
    assert.ok(v.photos.length === 1 && v.dc_photo_key === 'k' && downloads === 0, 'saved photos kept, nothing downloaded');
    assert.deepEqual(log.updated, ['053326 2015 HONDA ODYSSEY']);
    assert.deepEqual(log.waiting_photos, ['050440 2015 MERCEDES-BENZ S-CLASS (new, not on the website yet: no photos)']);
    assert.ok(!state(db, 'inventory').vehicles.some((x) => x.StockNumber === '050440'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
