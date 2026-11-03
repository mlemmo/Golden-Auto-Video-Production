// Cars and orders (Milestone 2, reworked 2026-11-03): the dealer's website read live and never saved, photo uploads,
// orders that store only the ordered car, the staff release, the worker's order endpoints, and the static customer
// site calling the API from another address. Websites, the VIN service and the worker are faked or local.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { NO_DB, freshDb, startApp, browser, jpeg, WORKER_ID, WORKER_SECRET } from './helpers.js';
import { createUser } from '../src/lib/users.js';
import { portalClient } from '../../node/src/lib/portal-client.js';

const PW = 'correct horse battery';
const VIN_A = '1HGBH41JXMN109101', VIN_B = '1HGBH41JXMN109102', VIN_C = '1HGBH41JXMN109103';
const SITE = 'https://lr.example';
const STATIC_SITE = 'https://staging.lotspotlight.example';

/** A Dealer Car Search vehicle page (the parts shared/dcs.js reads). */
const vdp = (id, vin, { price = 15688, miles = '41,000' } = {}) =>
  `<html><script>var init_utag_data = { "product_make": "Honda", "product_model": "Civic", "product_year": "2019", "product_price": "${price}", "product_id": "${id}", };</script>`
  + `<ul><li class="detailOptTrim"><label>Trim:</label> EX</li><li class="detailOptColor"><label>Color:</label> BLUE</li>`
  + `<li class="detailOptMPG"><label>Mileage:</label> ${miles}</li><li class="detailOptStock"><label>Stock #:</label> S${id}</li><li class="detailOptVin"><label>Vin:</label> ${vin}</li></ul>`
  + `<img data-src='https://imagescdn.dealercarsearch.com/Media/1/${id}/p1.jpg'><img data-src='https://imagescdn.dealercarsearch.com/Media/1/${id}/p2.jpg'></html>`;

/** A fake Dealer Car Search website (cars = { id: [vin, options] }) that counts page reads. */
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
    if (url.startsWith('https://blocked.example') || url.startsWith('https://www.bare.example')) return { code: 403, body: 'cf-chl', url, headers: '' };
    if (url.includes('.example')) return { code: 0, body: '', url, headers: '', error: 'it keeps redirecting (a redirect loop)' };
    return { code: 404, body: '', url, headers: '' };
  };
  return site;
}

describe('cars and orders', { skip: NO_DB }, () => {
  let pool, app, staff, owner, approver, viewer, other, dealerId, otherDealerId, worker;
  const site = fakeSite({ 1: [VIN_B, { price: 21000 }], 2: [VIN_C, {}], 3: ['NOVIN', {}], 4: [VIN_B, { price: 1 }] });
  const vinService = async () => ({ ok: true, status: 200, json: async () => ({ Results: [{ ModelYear: '2019', Make: 'HONDA', Model: 'Civic', Trim: 'EX', DriveType: 'FWD' }] }) });
  const login = async (email) => { const b = browser(app.url); await b.login(email, PW); return b; };
  const path = (p) => `/api/dealers/${dealerId}${p}`;

  before(async () => {
    pool = await freshDb();
    app = await startApp(pool, { CORS_ORIGINS: STATIC_SITE }, { fetchFn: vinService, siteFetch: (url) => site.fetch(url) });
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

  test('the website is read live, held 15 minutes, and nothing is saved', async () => {
    const r = await viewer.get(path('/website-cars'));
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'ok');
    assert.deepEqual(r.data.cars.map((c) => [c.vin, c.price, c.make, c.photos.length, c.order_status]), [[VIN_B, 21000, 'HONDA', 2, null], [VIN_C, 15688, 'HONDA', 2, null]],
      'site order kept; a VIN listed twice is read once');
    assert.equal(r.data.errors.length, 1);
    assert.match(r.data.errors[0], /no VIN/);
    const reads = site.fetched.length;
    await viewer.get(path('/website-cars'));
    assert.equal(site.fetched.length, reads, 'the second visit uses the held read');
    await viewer.get(path('/website-cars?fresh=1'));
    assert.ok(site.fetched.length > reads, 'Refresh reads the site again');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM vehicles');
    assert.equal(Number(n), 0, 'no car is stored before it is ordered');
    assert.equal((await other.get(path('/website-cars'))).status, 404);
  });

  test('sites that cannot be read say why', async () => {
    const add = async (slug, website) => (await staff.post('/api/dealers', { name: slug, slug, website })).data.dealer.id;
    const blocked = (await staff.get(`/api/dealers/${await add('golden', 'https://blocked.example')}/website-cars`)).data;
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.message, "Your website blocks automatic reading. Add your cars by hand, or contact eShield and we'll import them for you.");
    const loop = (await staff.get(`/api/dealers/${await add('loop', 'loop.example')}/website-cars`)).data;
    assert.equal(loop.status, 'failed');
    assert.match(loop.message, /https:\/\/loop\.example: it keeps redirecting/);
    assert.equal((await staff.get(`/api/dealers/${await add('bare', 'bare.example')}/website-cars`)).data.status, 'blocked', 'tried www.bare.example');
    assert.equal((await staff.get(`/api/dealers/${otherDealerId}/website-cars`)).data.status, 'none', 'no website saved');
  });

  test('VIN lookup (owners and admins, who order)', async () => {
    assert.deepEqual((await owner.get(path(`/vin/${VIN_A}`))).data.vehicle, { year: 2019, make: 'HONDA', model: 'Civic', trim: 'EX', drivetrain: 'FWD' });
    assert.equal((await approver.get(path(`/vin/${VIN_A}`))).status, 403);
  });

  test('uploads: JPEG only, owners and admins, thumbnails, delete before ordering', async () => {
    assert.equal((await owner.upload(path('/uploads'), Buffer.from('not a jpeg'))).status, 415);
    assert.equal((await owner.upload(path('/uploads'), Buffer.from('GIF89a'), 'image/gif')).status, 415);
    assert.equal((await approver.upload(path('/uploads'), jpeg())).status, 403);
    const r = await owner.upload(path('/uploads'), jpeg(300, 2));
    assert.equal(r.status, 201);
    const id = r.data.photo_id;
    assert.equal((await owner.upload(path(`/uploads/${id}/thumb`), jpeg(50, 12))).status, 200);
    assert.deepEqual((await viewer.bytes(path(`/photos/${id}`))).bytes, jpeg(300, 2));
    assert.deepEqual((await viewer.bytes(path(`/photos/${id}?size=thumb`))).bytes, jpeg(50, 12));
    assert.equal((await other.bytes(path(`/photos/${id}`))).status, 404);
    assert.equal((await owner.del(path(`/uploads/${id}`))).status, 200);
    assert.equal((await viewer.bytes(path(`/photos/${id}`))).status, 404);
  });

  test('ordering stores only the ordered car; ordering again updates it; staff release; the worker opens it', async () => {
    const webCar = (await owner.get(path('/website-cars'))).data.cars[0];
    const up = (await owner.upload(path('/uploads'), jpeg(300, 5))).data.photo_id;
    await owner.upload(path(`/uploads/${up}/thumb`), jpeg(50, 15));
    const body = { car: { ...webCar, price: 19995 }, photos: [{ url: webCar.photos[0] }, { upload_id: up }], source: 'website', product: 'slideshow', length_s: 60, notes: 'Mention the new tyres' };

    assert.equal((await approver.post(path('/orders'), body)).status, 403, 'approvers do not order');
    assert.equal((await owner.post(path('/orders'), { ...body, photos: [] })).status, 400, 'a photo is needed');
    assert.equal((await owner.post(path('/orders'), { ...body, car: { ...body.car, vin: 'BAD' } })).status, 400);
    assert.equal((await owner.post(path('/orders'), { ...body, product: 'ai_video' })).status, 400, 'AI videos are 15 or 30 s');
    const otherUpload = (await other.upload(`/api/dealers/${otherDealerId}/uploads`, jpeg())).data.photo_id;
    assert.equal((await owner.post(path('/orders'), { ...body, photos: [{ upload_id: otherUpload }] })).status, 400, 'another dealer’s upload');

    const order = (await owner.post(path('/orders'), body)).data.order;
    assert.deepEqual([order.status, order.vehicle.vin, order.vehicle.price, order.vehicle.photos.length], ['awaiting_payment', VIN_B, 19995, 2]);
    const cars = (await viewer.get(path('/vehicles'))).data.vehicles;
    assert.deepEqual(cars.map((v) => [v.vin, v.price, v.source, v.photo_count, v.order_status]), [[VIN_B, 19995, 'website', 2, 'awaiting_payment']], 'only the ordered car');
    assert.equal(cars[0].photo.url, webCar.photos[0], 'website photos stay links');
    assert.equal((await viewer.get(path('/website-cars'))).data.cars.find((c) => c.vin === VIN_B).order_status, 'awaiting_payment');

    // Ordering again with other details and without the upload: the car changes, the first order keeps its copy.
    const again = (await owner.post(path('/orders'), { ...body, car: { ...webCar, price: 18995 }, photos: [{ url: webCar.photos[1] }], product: 'ai_video', length_s: 30 })).data.order;
    assert.equal((await viewer.get(path('/vehicles'))).data.vehicles[0].price, 18995);
    assert.equal((await owner.get(path(`/orders/${order.id}`))).data.order.vehicle.price, 19995);
    assert.equal((await viewer.bytes(path(`/photos/${up}`))).status, 404, 'the upload it no longer uses is deleted');
    assert.equal((await owner.post(path(`/orders/${again.id}/cancel`))).data.order.status, 'cancelled');

    // A car added by hand, with its own upload.
    const hand = (await owner.upload(path('/uploads'), jpeg(300, 7))).data.photo_id;
    await owner.upload(path(`/uploads/${hand}/thumb`), jpeg(50, 17));
    const third = (await owner.post(path('/orders'), { car: { vin: VIN_A.toLowerCase(), year: '2018', make: 'Toyota', model: 'Camry', mileage: '52,000 mi' }, photos: [{ upload_id: hand }], source: 'form', product: 'ai_video', length_s: 15 })).data.order;
    assert.deepEqual([third.vehicle.vin, third.vehicle.mileage], [VIN_A, 52000]);

    // Only staff release (stands in for payment); the worker sees paid orders only.
    assert.equal((await owner.post(`/api/staff/orders/${third.id}/release`)).status, 403);
    assert.deepEqual(await worker.orders(), []);
    assert.equal((await staff.post(`/api/staff/orders/${third.id}/release`)).data.order.status, 'paid');
    assert.equal((await staff.post(`/api/staff/orders/${third.id}/release`)).status, 409, 'released once');
    assert.equal((await owner.post(path(`/orders/${third.id}/cancel`))).status, 409, 'customers cannot cancel a paid order');
    assert.deepEqual((await worker.orders()).map((o) => [o.id, o.status, o.dealer_name]), [[third.id, 'paid', 'eLease Returns']]);

    const detail = await worker.order(third.id);
    assert.deepEqual(detail.photos.map((p) => Boolean(p.path)), [true]);
    assert.deepEqual(await worker.orderPhoto(third.id, hand), jpeg(300, 7));
    const claimed = await worker.claimOrder(third.id, 'elease/9101');
    assert.deepEqual([claimed.status, claimed.claimed_by, claimed.studio_ref], ['in_progress', WORKER_ID, 'elease/9101']);
    assert.equal((await worker.claimOrder(third.id, 'elease/9101')).status, 'in_progress', 'opening again is fine');
    const files = readdirSync(app.config.uploadDir).length;
    await worker.photosCopied(third.id, [hand]);
    assert.equal(readdirSync(app.config.uploadDir).length, files - 1, 'the full upload is deleted, the thumbnail kept');
    await assert.rejects(worker.orderPhoto(third.id, hand), /404/);
    assert.equal((await owner.bytes(path(`/photos/${hand}`))).status, 200, 'the portal still shows the thumbnail');

    // The first order's website photos come from its own copy, even after the car was ordered with other photos.
    await staff.post(`/api/staff/orders/${order.id}/release`);
    assert.deepEqual((await worker.order(order.id)).photos.map((p) => p.url ?? 'upload'), [webCar.photos[0]]);
    assert.equal((await staff.post(path(`/orders/${order.id}/cancel`))).data.order.status, 'cancelled', 'staff cancel paid orders');
    assert.equal((await other.get(path(`/orders/${order.id}`))).status, 404);
  });

  test('the static customer site may call the API with its sign-in; other sites may not', async () => {
    const pre = await fetch(app.url + path('/vehicles'), { method: 'OPTIONS', headers: { Origin: STATIC_SITE, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), STATIC_SITE);
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers'), /X-CSRF-Token/);
    const stranger = await fetch(app.url + path('/vehicles'), { headers: { Origin: 'https://evil.example' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null);
    const workerApi = await fetch(app.url + '/api/worker/orders', { method: 'OPTIONS', headers: { Origin: STATIC_SITE } });
    assert.equal(workerApi.headers.get('access-control-allow-origin'), null, 'never the worker API');
  });
});
