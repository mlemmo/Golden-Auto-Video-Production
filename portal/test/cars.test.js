// Milestone 2: cars (form, photos, VIN lookup), website pulls, orders, the staff release and the worker's order
// endpoints. Websites, the VIN service and the worker are faked or local; nothing outside is called.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { NO_DB, freshDb, startApp, browser, jpeg, WORKER_ID, WORKER_SECRET } from './helpers.js';
import { createUser } from '../src/lib/users.js';
import { portalClient } from '../../node/src/lib/portal-client.js';

const PW = 'correct horse battery';
const VIN_A = '1HGBH41JXMN109101', VIN_B = '1HGBH41JXMN109102', VIN_C = '1HGBH41JXMN109103', VIN_D = '1HGBH41JXMN109104', VIN_E = '1HGBH41JXMN109105';
const SITE = 'https://lr.example';

/** A Dealer Car Search vehicle page (the parts shared/dcs.js reads). */
const vdp = (id, vin, { price = 15688, miles = '41,000', year = 2019, make = 'Honda', model = 'Civic' } = {}) =>
  `<html><script>var init_utag_data = { "product_make": "${make}", "product_model": "${model}", "product_year": "${year}", "product_price": "${price}", "product_id": "${id}", };</script>`
  + `<ul><li class="detailOptTrim"><label>Trim:</label> EX</li><li class="detailOptColor"><label>Color:</label> BLUE</li>`
  + `<li class="detailOptMPG"><label>Mileage:</label> ${miles}</li><li class="detailOptStock"><label>Stock #:</label> S${id}</li><li class="detailOptVin"><label>Vin:</label> ${vin}</li></ul>`
  + `<img data-src='https://imagescdn.dealercarsearch.com/Media/1/${id}/p1.jpg'><img data-src='https://imagescdn.dealercarsearch.com/Media/1/${id}/p2.jpg'></html>`;

/** A fake Dealer Car Search website: cars = { id: [vin, options] }. */
function fakeSite(cars) {
  const site = { cars, fetched: [] };
  site.fetch = async (url) => {
    site.fetched.push(url);
    const ok = (body) => ({ code: 200, body, url, headers: 'HTTP/1.1 200 OK\r\n\r\n' });
    if (url === SITE) return ok('<html><script src="https://www.dealercarsearch.com/x.js"></script>Used cars</html>');
    if (url === SITE + '/robots.txt') return ok(`Sitemap: ${SITE}/sitemap.xml`);
    if (url === SITE + '/sitemap.xml') return ok(Object.keys(site.cars).map((id) => `<loc>${SITE}/vdp/${id}/Used-2019-Honda-Civic</loc>`).join(''));
    const m = url.match(/\/vdp\/(\d+)\//);
    if (m && site.cars[m[1]]) return ok(vdp(m[1], ...site.cars[m[1]]));
    return { code: 404, body: '', url, headers: '' };
  };
  return site;
}

describe('cars, website pulls and orders', { skip: NO_DB }, () => {
  let pool, app, staff, owner, approver, viewer, other, dealerId, otherDealerId, worker;
  const site = fakeSite({});
  const vinService = async (url) => ({ ok: true, status: 200, json: async () => ({ Results: [{ ModelYear: '2019', Make: 'HONDA', Model: 'Civic', Trim: 'EX', DriveType: 'FWD', url }] }) });
  const login = async (email) => { const b = browser(app.url); await b.login(email, PW); return b; };

  before(async () => {
    pool = await freshDb();
    app = await startApp(pool, {}, { fetchFn: vinService, siteFetch: (url) => site.fetch(url) });
    await createUser(pool, { email: 'staff@eshield.test', password: PW, isStaff: true });
    staff = await login('staff@eshield.test');
    dealerId = (await staff.post('/api/dealers', { name: 'eLease Returns', slug: 'elease', website: SITE })).data.dealer.id;
    otherDealerId = (await staff.post('/api/dealers', { name: 'Other Motors', slug: 'other' })).data.dealer.id;
    for (const [email, role, d] of [['owner@lr.test', 'owner', dealerId], ['approver@lr.test', 'approver', dealerId], ['viewer@lr.test', 'viewer', dealerId], ['owner@other.test', 'owner', otherDealerId]]) {
      assert.equal((await staff.post(`/api/dealers/${d}/users`, { email, role, password: PW })).status, 201);
    }
    [owner, approver, viewer, other] = await Promise.all(['owner@lr.test', 'approver@lr.test', 'viewer@lr.test', 'owner@other.test'].map(login));
    worker = portalClient({ api: `${app.url}/api/worker`, workerId: WORKER_ID, secret: WORKER_SECRET });
  });
  after(async () => { await app?.close(); await pool?.end(); });

  const path = (p) => `/api/dealers/${dealerId}${p}`;

  test('a car typed in by the customer: checks, roles and other dealers', async () => {
    assert.equal((await approver.post(path('/vehicles'), { vin: 'BAD', year: 2019, make: 'Honda', model: 'Civic' })).status, 400);
    assert.equal((await approver.post(path('/vehicles'), { vin: VIN_A, make: 'Honda', model: 'Civic' })).status, 400, 'year required');
    assert.equal((await approver.post(path('/vehicles'), { vin: VIN_A, year: 2019, make: 'Honda', model: 'Civic', page_url: 'http://x.test' })).status, 400);
    assert.equal((await viewer.post(path('/vehicles'), { vin: VIN_A, year: 2019, make: 'Honda', model: 'Civic' })).status, 403);
    const added = await approver.post(path('/vehicles'), { vin: VIN_A.toLowerCase(), year: '2019', make: 'Honda', model: 'Civic', price: '$15,688', mileage: '41,000 mi' });
    assert.equal(added.status, 201);
    assert.deepEqual([added.data.vehicle.vin, added.data.vehicle.price, added.data.vehicle.mileage, added.data.vehicle.source], [VIN_A, 15688, 41000, 'form']);
    assert.equal((await approver.post(path('/vehicles'), { vin: VIN_A, year: 2019, make: 'Honda', model: 'Civic' })).status, 409);
    assert.equal((await viewer.get(path('/vehicles'))).data.vehicles.length, 1);
    assert.equal((await other.get(path('/vehicles'))).status, 404, 'another dealer cannot see it');
    assert.equal((await other.get(path(`/vehicles/${added.data.vehicle.id}`))).status, 404);
  });

  test('VIN lookup fills the form from the (faked) NHTSA service', async () => {
    const r = await approver.get(path(`/vin/${VIN_B}`));
    assert.deepEqual(r.data.vehicle, { year: 2019, make: 'HONDA', model: 'Civic', trim: 'EX', drivetrain: 'FWD' });
    assert.equal((await viewer.get(path(`/vin/${VIN_B}`))).status, 403);
  });

  test('photos: JPEG only, thumbnails, order and delete', async () => {
    const car = (await approver.get(path('/vehicles'))).data.vehicles[0];
    const base = path(`/vehicles/${car.id}/photos`);
    assert.equal((await approver.upload(base, Buffer.from('not a jpeg'))).status, 415);
    assert.equal((await approver.upload(base, Buffer.from('GIF89a'), 'image/gif')).status, 415, 'only JPEG bodies');
    assert.equal((await viewer.upload(base, jpeg())).status, 403);
    const ids = [];
    for (const fill of [1, 2, 3]) {
      const r = await approver.upload(base, jpeg(300, fill));
      assert.equal(r.status, 201);
      ids.push(r.data.photo_id);
      assert.equal((await approver.upload(`${base}/${r.data.photo_id}/thumb`, jpeg(50, fill + 10))).status, 200);
    }
    const full = await viewer.bytes(`${base}/${ids[1]}`);
    assert.equal(full.status, 200);
    assert.deepEqual(full.bytes, jpeg(300, 2));
    assert.deepEqual((await viewer.bytes(`${base}/${ids[1]}?size=thumb`)).bytes, jpeg(50, 12));
    assert.equal((await approver.put(`${base}/order`, { ids: [ids[2], ids[0]] })).status, 400, 'every photo once');
    const reordered = await approver.put(`${base}/order`, { ids: [ids[2], ids[0], ids[1]] });
    assert.deepEqual(reordered.data.vehicle.photos.map((p) => p.id), [ids[2], ids[0], ids[1]]);
    assert.equal((await approver.del(`${base}/${ids[1]}`)).status, 200);
    assert.equal((await viewer.get(path(`/vehicles/${car.id}`))).data.vehicle.photos.length, 2);
    assert.equal((await approver.get(path('/vehicles'))).data.vehicles[0].photo.id, ids[2], 'the first photo shows in the list');
  });

  test('orders: owners order, the car is frozen, staff release, the worker opens it', async () => {
    const car = (await owner.get(path('/vehicles'))).data.vehicles[0];
    const body = { vehicle_id: car.id, product: 'slideshow', length_s: 60, notes: 'Mention the new tyres' };
    assert.equal((await approver.post(path('/orders'), body)).status, 403, 'approvers do not order');
    assert.equal((await owner.post(path('/orders'), { ...body, product: 'ai_video' })).status, 400, 'AI videos are 15 or 30 s');
    const placed = await owner.post(path('/orders'), body);
    assert.equal(placed.status, 201);
    const order = placed.data.order;
    assert.deepEqual([order.status, order.vehicle.vin, order.vehicle.price, order.vehicle.photos.length], ['awaiting_payment', VIN_A, 15688, 2]);

    // Editing the car later does not change the order.
    await approver.patch(path(`/vehicles/${car.id}`), { price: 14688 });
    assert.equal((await owner.get(path(`/orders/${order.id}`))).data.order.vehicle.price, 15688);
    assert.equal((await owner.get(path('/vehicles'))).data.vehicles[0].order_status, 'awaiting_payment');

    // Only staff release (stands in for payment); the worker sees paid orders only.
    assert.equal((await owner.post(`/api/staff/orders/${order.id}/release`)).status, 403);
    assert.deepEqual(await worker.orders(), []);
    assert.equal((await staff.post(`/api/staff/orders/${order.id}/release`)).data.order.status, 'paid');
    assert.equal((await staff.post(`/api/staff/orders/${order.id}/release`)).status, 409, 'released once');
    assert.equal((await owner.post(path(`/orders/${order.id}/cancel`))).status, 409, 'customers cannot cancel a paid order');
    const queue = await worker.orders();
    assert.deepEqual(queue.map((o) => [o.id, o.status, o.dealer_name]), [[order.id, 'paid', 'eLease Returns']]);
    assert.ok((await staff.get('/api/staff/orders?status=paid')).data.orders.some((o) => o.id === order.id));
    assert.equal((await owner.get('/api/staff/orders')).status, 403);

    // The worker fetches the order and its uploaded photos, claims it, then reports the photos copied.
    const detail = await worker.order(order.id);
    assert.equal(detail.photos.length, 2);
    assert.ok(detail.photos.every((p) => p.path));
    const bytes = await worker.orderPhoto(order.id, detail.photos[0].id);
    assert.equal(bytes[0], 0xff);
    const claimed = await worker.claimOrder(order.id, 'elease/S1');
    assert.deepEqual([claimed.status, claimed.claimed_by, claimed.studio_ref], ['in_progress', WORKER_ID, 'elease/S1']);
    assert.equal((await worker.claimOrder(order.id, 'elease/S1')).status, 'in_progress', 'opening again is fine');
    const before = readdirSync(app.config.uploadDir).length;
    await worker.photosCopied(order.id, detail.photos.map((p) => p.id));
    assert.equal(readdirSync(app.config.uploadDir).length, before - 2, 'full uploads deleted, thumbnails kept');
    assert.equal((await worker.order(order.id)).photos.filter((p) => p.path).length, 0);
    await assert.rejects(worker.orderPhoto(order.id, detail.photos[0].id), /404/);
    const thumb = await owner.bytes(path(`/vehicles/${car.id}/photos/${detail.photos[0].id}`));
    assert.equal(thumb.status, 200, 'the portal still shows the thumbnail');

    // A customer cancels an order before payment; staff can cancel later ones.
    const second = (await owner.post(path('/orders'), { ...body, product: 'ai_video', length_s: 30 })).data.order;
    assert.equal((await owner.post(path(`/orders/${second.id}/cancel`))).data.order.status, 'cancelled');
    assert.equal((await staff.post(path(`/orders/${order.id}/cancel`))).data.order.status, 'cancelled');
    assert.equal((await other.get(path(`/orders/${order.id}`))).status, 404);
  });

  test('a car without photos cannot be ordered', async () => {
    const car = (await approver.post(path('/vehicles'), { vin: VIN_E, year: 2018, make: 'Toyota', model: 'Camry' })).data.vehicle;
    assert.equal((await owner.post(path('/orders'), { vehicle_id: car.id, product: 'slideshow', length_s: 30 })).status, 400);
    assert.equal((await approver.del(path(`/vehicles/${car.id}`))).status, 200);
  });

  test('website pull: batches, customer edits kept, cars gone from the site marked, never deleted', async () => {
    site.cars = { 1: [VIN_B, { price: 21000 }], 2: [VIN_C, {}], 3: [VIN_D, {}], 4: ['NOVIN', {}], 5: [VIN_B, { price: 1 }] };
    assert.equal((await viewer.post(path('/pulls'))).status, 403);
    let pull = (await approver.post(path('/pulls'))).data.pull;
    assert.deepEqual([pull.status, pull.total, pull.done], ['running', 5, 0]);
    assert.equal((await approver.post(path('/pulls'))).data.pull.id, pull.id, 'one pull at a time');
    pull = (await approver.post(path(`/pulls/${pull.id}/continue`))).data.pull;
    assert.deepEqual([pull.status, pull.done], ['running', 4]);
    pull = (await approver.post(path(`/pulls/${pull.id}/continue`))).data.pull;
    assert.deepEqual([pull.status, pull.done, pull.added, pull.errors.length], ['done', 5, 3, 1]);
    assert.match(pull.errors[0], /no VIN/);
    let list = (await viewer.get(path('/vehicles'))).data.vehicles;
    const b = list.find((v) => v.vin === VIN_B);
    assert.deepEqual([b.source, b.price, b.make, b.photo_count], ['website', 21000, 'HONDA', 2], 'a VIN listed twice is read once');
    assert.equal((await viewer.get(path('/pulls/latest'))).data.pull.id, pull.id);

    // The customer changes the price of B; the next pull updates its miles but keeps their price; D left the site.
    await approver.patch(path(`/vehicles/${b.id}`), { price: 19995 });
    site.cars = { 1: [VIN_B, { price: 21000, miles: '42,500' }], 2: [VIN_C, {}] };
    pull = (await approver.post(path('/pulls'))).data.pull;
    pull = (await approver.post(path(`/pulls/${pull.id}/continue`))).data.pull;
    assert.deepEqual([pull.status, pull.added, pull.gone], ['done', 0, 1]);
    list = (await viewer.get(path('/vehicles'))).data.vehicles;
    const b2 = list.find((v) => v.vin === VIN_B), d = list.find((v) => v.vin === VIN_D);
    assert.deepEqual([b2.price, b2.mileage], [19995, 42500]);
    assert.ok(d.missing_since, 'not on your website anymore');
    assert.ok(!list.find((v) => v.vin === VIN_A).missing_since, 'a car typed in by the customer is never marked');

    // A car the customer removed stays removed when the site still lists it.
    await approver.del(path(`/vehicles/${b2.id}`));
    pull = (await approver.post(path('/pulls'))).data.pull;
    await approver.post(path(`/pulls/${pull.id}/continue`));
    assert.ok(!(await viewer.get(path('/vehicles'))).data.vehicles.some((v) => v.vin === VIN_B));
  });

  test('a website that blocks us, or that we cannot read yet, tells the customer we will import', async () => {
    const blockedDealer = (await staff.post('/api/dealers', { name: 'Golden Auto', slug: 'golden-auto', website: 'https://blocked.example' })).data.dealer.id;
    const realFetch = site.fetch;
    site.fetch = async (url) => (url.startsWith('https://blocked.example') ? { code: 403, body: '<title>Just a moment...</title> cf-chl', url, headers: '' } : realFetch(url));
    const pull = (await staff.post(`/api/dealers/${blockedDealer}/pulls`)).data.pull;
    site.fetch = realFetch;
    assert.equal(pull.status, 'blocked');
    assert.match(pull.message, /We will import your cars for you/);
    assert.equal((await staff.post(`/api/dealers/${otherDealerId}/pulls`)).status, 400, 'no website saved');
  });

  test('staff import a browser snapshot for a site that blocks us', async () => {
    const snapshot = [
      { stock: '0931', vin: VIN_A, year: 2013, make: 'SUBARU', model: 'XV CROSSTREK', trim: '2.0i Premium', mileage: 98000, prices: [9995, 10990], description: 'One owner',
        photo_urls: ['https://imagescf.dealercenter.net/640/480/a.jpg'], page_url: 'https://www.mygoldenauto.net/inventory/subaru/xv/0931/' },
      { stock: '0932', list_only: true },
      { stock: '0933', year: 2015, make: 'RAM', model: '1500' },
    ];
    assert.equal((await owner.post(`/api/staff/dealers/${otherDealerId}/snapshot`, { snapshot })).status, 403);
    const r = await staff.post(`/api/staff/dealers/${otherDealerId}/snapshot`, { snapshot });
    assert.deepEqual([r.data.added, r.data.skipped.length], [1, 2]);
    const [car] = (await other.get(`/api/dealers/${otherDealerId}/vehicles`)).data.vehicles;
    assert.deepEqual([car.vin, car.price, car.source, car.photo_count], [VIN_A, 10990, 'dms', 1]);
  });
});
