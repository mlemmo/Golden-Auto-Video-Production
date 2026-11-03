// Customer orders from the LotSpotlight portal: linking a portal dealer to a client here, and "Open in studio" (the
// ordered car and its photos copied into that client's cars). The portal and the dealer's photo host are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDb, state } from '../src/lib/db.js';
import { clientsLoad, clientInventory, clientDetails, clientFind } from '../src/lib/clients.js';
import { applyPortalDealer, portalDealerClient, portalFromConfig, portalOrderOpen, portalOrders } from '../src/lib/orders.js';
import { JPEG_1800x900, JPEG_1800x900_B } from './fixtures/images.js';

const VIN = '1HGBH41JXMN109186';
const order = (status = 'paid') => ({
  id: 7, status, dealer_id: 3, dealer_name: 'Golden Auto', dealer_website: 'https://www.mygoldenauto.net', product: 'slideshow',
  product_name: 'Photo slideshow', length_s: 30, notes: 'Mention the new tyres', created_at: '2026-11-03T18:00:00.000Z',
  vehicle: { id: 11, vin: VIN, stock_no: '0931', year: 2019, make: 'Honda', model: 'Civic', trim: 'EX', color: 'Blue', drivetrain: 'FWD',
    mileage: 41000, price: 15688, description: 'Clean title.', page_url: null,
    photos: [{ id: 1, url: 'https://imagescf.dealercenter.net/640/480/overlay-x/abc123.jpg', uploaded: false }, { id: 2, url: null, uploaded: true }] },
});
const PHOTOS = [{ id: 1, url: 'https://imagescf.dealercenter.net/640/480/overlay-x/abc123.jpg' }, { id: 2, path: '/api/worker/orders/7/photos/2' }];

const DEALER = { id: 3, name: 'Golden Auto', website: 'https://www.mygoldenauto.net', city: null, state: null, phone: '925-555-0100' };

function fakePortal(o = order(), dealer = DEALER) {
  const calls = [];
  return {
    calls,
    dealerConfig: async (id) => { calls.push(['dealer', id]); return { dealer }; },
    orders: async () => [o],
    order: async (id) => { calls.push(['order', id]); return { order: o, photos: PHOTOS }; },
    orderPhoto: async (id, photoId) => { calls.push(['photo', id, photoId]); return Buffer.from(JPEG_1800x900_B, 'base64'); },
    claimOrder: async (id, ref) => { calls.push(['claim', id, ref]); return { ...o, status: 'in_progress' }; },
    photosCopied: async (id, ids) => { calls.push(['copied', id, ids]); },
  };
}
const siteFetchLog = () => {
  const fetched = [];
  return { fetched, fetch: async (url) => { fetched.push(url); return { code: 200, bodyBuffer: Buffer.from(JPEG_1800x900, 'base64') }; } };
};
const config = () => ({ asset_dir: mkdtempSync(join(tmpdir(), 'orders-assets-')), public_base_url: 'https://staging.example.net' });

test('without portal settings nothing is sent and the window says so', async () => {
  assert.equal(portalFromConfig({}), null);
  assert.equal(portalFromConfig({ portal: { api: 'https://app.example.com/api/worker', worker_id: 'w1' } }), null, 'secret missing');
  assert.deepEqual(await portalOrders(openMemoryDb(), {}, null), { configured: false, orders: [] });
  await assert.rejects(portalOrderOpen(openMemoryDb(), {}, 7, { portal: null }), /Connect the LotSpotlight portal/);
});

test('a portal dealer links to the client with its name, or gets a new client', () => {
  const db = openMemoryDb();
  assert.equal(portalDealerClient(db, { dealer_id: 3, dealer_name: 'golden auto' }), 'golden-auto');
  assert.equal(clientsLoad(db).items.length, 1, 'no second Golden Auto');
  assert.equal(portalDealerClient(db, { dealer_id: 9, dealer_name: 'Bay Motors', dealer_website: 'https://www.baymotors.com/' }), 'bay-motors');
  const bay = clientsLoad(db).items.find((c) => c.id === 'bay-motors');
  assert.deepEqual([bay.name, bay.website, bay.portal_dealer_id], ['Bay Motors', 'https://www.baymotors.com', 9]);
  // Linked by id from now on, even if the dealer is renamed on the portal.
  assert.equal(portalDealerClient(db, { dealer_id: 9, dealer_name: 'Bay Motors Inc' }), 'bay-motors');
  assert.equal(portalDealerClient(db, { dealer_id: 10, dealer_name: 'Bay Motors' }), 'bay-motors-2', 'a different dealer with a taken name');
});

test('the order list shows the car and which client it belongs to', async () => {
  const db = openMemoryDb();
  portalDealerClient(db, order());
  const { configured, orders } = await portalOrders(db, {}, fakePortal());
  assert.equal(configured, true);
  assert.deepEqual([orders[0].client, orders[0].vehicle.title, orders[0].vehicle.photos, orders[0].notes], ['golden-auto', '2019 Honda Civic EX', 2, 'Mention the new tyres']);
});

test('Open in studio copies only the ordered car and its photos, then claims the order', async () => {
  const db = openMemoryDb(), cfg = config(), portal = fakePortal(), site = siteFetchLog();
  const r = await portalOrderOpen(db, cfg, 7, { portal, siteFetch: site.fetch });
  assert.deepEqual([r.client, r.stock], ['golden-auto', '0931']);
  // DealerCenter photos are downloaded without the website's overlay folder, at full size.
  assert.deepEqual(site.fetched, ['https://imagescf.dealercenter.net/1600/1200/abc123.jpg']);
  const cars = clientInventory(db, 'golden-auto').vehicles;
  assert.equal(cars.length, 1);
  const car = cars[0];
  assert.deepEqual([car.source, car.StockNumber, car.Vin, car.Make, car.Model, car.price, car.portal_order, car.photos.length, car.active],
    ['portal', '0931', VIN, 'HONDA', 'CIVIC', 15688, 7, 2, true]);
  for (const url of car.photos) assert.ok(existsSync(join(cfg.asset_dir, url.split('/').pop())), url);
  assert.deepEqual(portal.calls.filter((c) => !['order', 'dealer'].includes(c[0])), [['photo', 7, 2], ['claim', 7, 'golden-auto/0931'], ['copied', 7, [2]]]);
  assert.match(r.message, /Dealer details updated/);
  assert.equal(clientDetails(clientFind(db, 'golden-auto')).phone, '925-555-0100');
  assert.ok(state(db, 'portal_photos')['2'], 'the uploaded photo is remembered');

  // Opening it again reuses the uploaded photo (the portal may have deleted its full copy) and keeps one car.
  const again = fakePortal({ ...order(), status: 'in_progress' });
  await portalOrderOpen(db, cfg, 7, { portal: again, siteFetch: site.fetch });
  assert.ok(!again.calls.some((c) => c[0] === 'photo'), 'no second upload download');
  assert.equal(clientInventory(db, 'golden-auto').vehicles.length, 1);
});

test('only paid orders open in the studio', async () => {
  for (const status of ['awaiting_payment', 'cancelled', 'approved']) {
    await assert.rejects(portalOrderOpen(openMemoryDb(), config(), 7, { portal: fakePortal(order(status)), siteFetch: siteFetchLog().fetch }), /Only paid orders/);
  }
});

test('dealer details edited on the portal reach the client; empty portal fields keep ours', () => {
  const db = openMemoryDb();
  const before = clientDetails(clientFind(db, 'golden-auto'));
  assert.equal(applyPortalDealer(db, 'golden-auto', { name: 'Golden Auto', website: 'https://www.mygoldenauto.net', city: null, phone: null }), false, 'nothing new');
  assert.equal(applyPortalDealer(db, 'golden-auto', { name: 'Golden Auto', website: 'https://www.mygoldenauto.net', city: '', phone: '(925) 555-1234' }), true);
  let d = clientDetails(clientFind(db, 'golden-auto'));
  assert.deepEqual([d.city, d.website, d.website_spoken, d.phone], [before.city, 'mygoldenauto.net', before.website_spoken, '(925) 555-1234'], 'San Ramon and the spoken website stay');
  portalDealerClient(db, { dealer_id: 9, dealer_name: 'Bay Motors', dealer_website: 'https://baymotors.com' });
  assert.equal(applyPortalDealer(db, 'bay-motors', { name: 'Bay Motors of Dublin', website: 'https://www.dublincars.com', city: 'Dublin', phone: null }), true);
  d = clientDetails(clientFind(db, 'bay-motors'));
  assert.deepEqual([d.name, d.city, d.website, d.website_spoken], ['Bay Motors of Dublin', 'Dublin', 'dublincars.com', 'dublincars dot com']);
  assert.equal(clientFind(db, 'bay-motors').name, 'Bay Motors of Dublin', 'the client list shows the new name');
  assert.throws(() => applyPortalDealer(db, 'bay-motors', { name: 'Bay Motors', website: null, city: 'Dublin', phone: '12' }), /phone/);
});

test('listing orders brings linked dealers up to date', async () => {
  const db = openMemoryDb();
  portalDealerClient(db, order());
  await portalOrders(db, {}, fakePortal(order(), { ...DEALER, city: 'Danville' }));
  assert.equal(clientDetails(clientFind(db, 'golden-auto')).city, 'Danville');
});
