// The LotSpotlight portal's API inside the studio server, on the studio's database: sign-in with studio accounts and
// portal customers, dealers = studio clients, the live website read, uploads, orders, staff release, the studio's
// Orders window opening an order, people, dealer details and the static pages' address. Websites and the VIN service
// are faked; nothing outside is called.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { server, actions } from '../src/server.js';
import { setConfig } from '../src/lib/config.js';
import { openDb, save, state } from '../src/lib/db.js';
import { clientDetails, clientFind, clientsLoad } from '../src/lib/clients.js';
import { userCreate, userByEmail } from '../src/lib/users.js';
import { setPortalDeps } from '../src/portal/api.js';
import { JPEG_1800x900, JPEG_1800x900_B } from './fixtures/images.js';

const PW = 'correct horse battery';
const SITE = 'https://lr.example';
const PAGES = 'https://staging.lotspotlight.example';
const VIN_A = '1HGBH41JXMN109101', VIN_B = '1HGBH41JXMN109102';
const vdp = (id, vin, price) =>
  `<html><script>var init_utag_data = { "product_make": "Honda", "product_model": "Civic", "product_year": "2019", "product_price": "${price}", "product_id": "${id}", };</script>`
  + `<ul><li class="detailOptTrim"><label>Trim:</label> EX</li><li class="detailOptMPG"><label>Mileage:</label> 41,000</li><li class="detailOptStock"><label>Stock #:</label> S${id}</li>`
  + `<li class="detailOptVin"><label>Vin:</label> ${vin}</li></ul><img data-src='https://imagescdn.dealercarsearch.com/Media/1/${id}/p1.jpg'></html>`;
const fetched = [];
async function siteFetch(url) {
  fetched.push(url);
  const ok = (body) => ({ code: 200, body, url, headers: 'HTTP/1.1 200 OK\r\n\r\n' });
  if (url === SITE) return ok('<html><script src="https://www.dealercarsearch.com/x.js"></script></html>');
  if (url === SITE + '/robots.txt') return ok(`Sitemap: ${SITE}/sitemap.xml`);
  if (url === SITE + '/sitemap.xml') return ok(`<loc>${SITE}/vdp/1/Used-2019-Honda-Civic</loc><loc>${SITE}/vdp/2/Used-2019-Honda-Civic</loc>`);
  if (url.includes('/vdp/1/')) return ok(vdp(1, VIN_A, 15688));
  if (url.includes('/vdp/2/')) return ok(vdp(2, VIN_B, 17995));
  if (url.startsWith('https://imagescdn.dealercarsearch.com/')) return { code: 200, bodyBuffer: Buffer.from(JPEG_1800x900, 'base64'), url };
  return { code: 404, body: '', url, headers: '' };
}
const vinService = async () => ({ ok: true, status: 200, json: async () => ({ Results: [{ ModelYear: '2018', Make: 'TOYOTA', Model: 'Camry', Trim: 'SE', DriveType: 'FWD' }] }) });

let base, db, cfg;
function portalBrowser() {
  let cookie = '', csrf = '';
  const call = async (method, path, body, type = 'application/json') => {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': type } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) cookie = /Max-Age=0/.test(c) ? '' : c.split(';')[0];
    const bytes = Buffer.from(await r.arrayBuffer());
    let data = null; try { data = JSON.parse(bytes.toString('utf8')); } catch { /* a photo */ }
    if (data?.csrf) csrf = data.csrf;
    return { status: r.status, data, bytes, headers: r.headers };
  };
  return { call, get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p, {}),
    upload: (p, buf) => call('POST', p, buf, 'image/jpeg'), login: (email) => call('POST', '/api/auth/login', { email, password: PW }) };
}

before(async () => {
  const dir = mkdtempSync(tmpdir() + '/portal-api-');
  cfg = { data_dir: dir, asset_dir: mkdtempSync(tmpdir() + '/portal-assets-'), public_base_url: 'https://studio.example.com:4343', password_hash: 'x', portal_api: { url: 'https://api.example', origins: [PAGES] } };
  setConfig(cfg);
  setPortalDeps({ fetchFn: vinService, siteFetch });
  db = openDb(cfg);
  const c = clientsLoad(db);
  c.items.push({ id: 'elease', name: 'eLease Returns', website: SITE, created_at: '2026-11-03T00:00:00+00:00' });
  save(db, 'clients', c);
  const admin = { email: 'boss@eshield.test' };
  userCreate(db, admin, { email: 'staff@eshield.test', password: PW, role: 'admin' });
  userCreate(db, admin, { email: 'maker@eshield.test', password: PW, role: 'user', clients: ['elease'] });
  userCreate(db, admin, { email: 'owner@lr.test', password: PW, role: 'customer', clients: ['elease'] });
  userCreate(db, admin, { email: 'look@lr.test', password: PW, role: 'customer_viewer', clients: ['elease'] });
  base = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
});
after(() => server.close());

test('studio accounts and customers sign in; each sees only their dealers; customers stay out of the studio', async () => {
  const staff = portalBrowser();
  const me = (await staff.login('staff@eshield.test')).data;
  assert.equal(me.user.is_staff, true);
  assert.deepEqual(me.dealers.map((d) => [d.id, d.role]), [['elease', 'staff'], ['golden-auto', 'staff']], 'every studio client is a dealer');
  assert.deepEqual(me.dealers[0].can, { staff: true, order: true, people: true, details: true });
  const owner = portalBrowser();
  assert.deepEqual((await owner.login('owner@lr.test')).data.dealers.map((d) => [d.id, d.role]), [['elease', 'order_people']], 'a customer account from before the split keeps both');
  assert.equal((await owner.get('/api/dealers/golden-auto/vehicles')).status, 404);
  assert.equal((await portalBrowser().call('POST', '/api/auth/login', { email: 'owner@lr.test', password: 'wrong password' })).status, 401);
  assert.equal((await portalBrowser().get('/api/auth/me')).status, 401);
  // The studio's own sign-in page refuses a portal customer.
  const page = await fetch(base + '/');
  const csrf = (await page.text()).match(/name="csrf" value="([a-f0-9]{48})"/)[1];
  const jar = page.headers.getSetCookie()[0].split(';')[0];
  const r = await fetch(base + '/', { method: 'POST', redirect: 'manual', headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, email: 'owner@lr.test', password: PW }) });
  assert.match(await r.text(), /This account is for the LotSpotlight portal/);
});

test('the website is read live and nothing is stored until an order', async () => {
  const look = portalBrowser(); await look.login('look@lr.test');
  const r = (await look.get('/api/dealers/elease/website-cars')).data;
  assert.deepEqual(r.cars.map((c) => [c.vin, c.price]), [[VIN_A, 15688], [VIN_B, 17995]]);
  assert.deepEqual((await look.get('/api/dealers/elease/vehicles')).data.vehicles, []);
  assert.equal((await look.post('/api/dealers/elease/orders', {})).status, 403, 'view only');
});

test('a customer orders; staff release it; the studio opens it into the dealer’s cars', async () => {
  const owner = portalBrowser(); await owner.login('owner@lr.test');
  const webCar = (await owner.get('/api/dealers/elease/website-cars')).data.cars[0];
  const up = await owner.upload('/api/dealers/elease/uploads', Buffer.from(JPEG_1800x900_B, 'base64'));
  assert.equal(up.status, 201);
  assert.equal((await owner.upload('/api/dealers/elease/uploads', Buffer.from('nope'))).status, 415);
  const body = { car: { ...webCar, price: 14999 }, photos: [{ url: webCar.photos[0] }, { upload_id: up.data.photo_id }], source: 'website', product: 'slideshow', length_s: 30, notes: 'New tyres' };
  assert.equal((await owner.post('/api/dealers/elease/orders', { ...body, length_s: 45 })).status, 400);
  const order = (await owner.post('/api/dealers/elease/orders', body)).data.order;
  assert.deepEqual([order.status, order.vehicle.vin, order.vehicle.price, order.dealer_name], ['awaiting_payment', VIN_A, 14999, 'eLease Returns']);
  assert.deepEqual((await owner.get('/api/dealers/elease/vehicles')).data.vehicles.map((v) => [v.vin, v.order_status, v.photo_count]), [[VIN_A, 'awaiting_payment', 2]]);
  assert.equal((await owner.post(`/api/staff/orders/${order.id}/release`)).status, 403);

  const staff = portalBrowser(); await staff.login('staff@eshield.test');
  assert.equal((await staff.post(`/api/staff/orders/${order.id}/release`)).data.order.status, 'paid');
  assert.equal((await owner.post(`/api/dealers/elease/orders/${order.id}/cancel`)).status, 409, 'paid: only eShield cancels');

  // The studio's Orders window, same database.
  const user = userByEmail(db, 'staff@eshield.test');
  const list = await actions.portal_orders({ db, cfg, user });
  assert.deepEqual(list.orders.map((o) => [o.id, o.client, o.vehicle.photos]), [[order.id, 'elease', 2]]);
  const session = { data: {} };
  const opened = await actions.portal_order_open({ db, cfg, body: { id: order.id }, session, user });
  assert.deepEqual([opened.client, opened.stock, session.data.client], ['elease', 'S1', 'elease']);
  assert.deepEqual([opened.length_s, opened.product, opened.notes], [30, 'slideshow', 'New tyres'], 'the studio takes the order’s length and type');
  assert.match(opened.message, /make a 30-second photo slideshow .* Customer notes: New tyres/);
  const car = state(db, 'inventory:elease').vehicles.find((v) => v.StockNumber === 'S1');
  assert.deepEqual([car.source, car.price, car.photos.length], ['portal', 14999, 2]);
  assert.equal((await owner.get(`/api/dealers/elease/orders/${order.id}`)).data.order.status, 'in_progress');
});

test('delivery and review: staff send finished videos; one free remake; a second rejection goes to staff', async () => {
  const owner = portalBrowser(); await owner.login('owner@lr.test');
  const staff = portalBrowser(); await staff.login('staff@eshield.test');
  const user = userByEmail(db, 'staff@eshield.test');
  const [order] = (await owner.get('/api/dealers/elease/orders?status=in_progress')).data.orders;
  assert.ok(order, 'the order opened in the studio above');
  // Two finished videos of the car in the studio (as the caption worker leaves them), and one of another car.
  const job = (id, stock, format) => db.prepare('INSERT INTO jobs (id, fingerprint, payload) VALUES (?,?,?)').run(id, null,
    JSON.stringify({ id, client: 'elease', stock, vehicle: '2019 HONDA CIVIC', format, duration: 30, finish_status: 'completed', captioned_url: `https://studio.example.com:4343/assets/${id}.mp4`, poster_url: `https://studio.example.com:4343/assets/posters/${id}.jpg`, provider: 'slideshow', created_at: '2026-11-03T20:00:00Z' }));
  job('aaaaaaaaaaaaaaaa', 'S1', 'instagram_reels'); job('bbbbbbbbbbbbbbbb', 'S1', 'youtube'); job('cccccccccccccccc', 'S9', 'instagram_reels');
  const row = (await actions.portal_orders({ db, cfg, user })).orders.find((o) => o.id === order.id);
  assert.deepEqual(row.finished.map((f) => f.id).sort(), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], 'only this car’s finished videos');
  assert.throws(() => actions.portal_order_deliver({ db, body: { id: order.id, videos: ['cccccccccccccccc'] }, user }), /not a finished video of this car/);
  assert.equal((await owner.post(`/api/dealers/elease/orders/${order.id}/approve`)).status, 409, 'nothing sent yet');

  actions.portal_order_deliver({ db, body: { id: order.id, videos: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] }, user });
  let o = (await owner.get(`/api/dealers/elease/orders/${order.id}`)).data.order;
  assert.deepEqual([o.status, o.videos.length, o.videos[0].url.endsWith('.mp4'), o.free_remakes_left], ['ready_for_review', 2, true, 1]);
  const look = portalBrowser(); await look.login('look@lr.test');
  assert.equal((await look.post(`/api/dealers/elease/orders/${order.id}/approve`)).status, 403, 'view only cannot answer');
  assert.equal((await owner.post(`/api/dealers/elease/orders/${order.id}/reject`, { reason: '' })).status, 400, 'a reason is needed');

  // First rejection: a free remake (back in progress with the reason).
  o = (await owner.post(`/api/dealers/elease/orders/${order.id}/reject`, { reason: 'Say $14,995' })).data.order;
  assert.deepEqual([o.status, o.remake.reason, o.free_remakes_left], ['in_progress', 'Say $14,995', 0]);
  assert.equal((await actions.portal_orders({ db, cfg, user })).orders.find((x) => x.id === order.id).remake.reason, 'Say $14,995');
  // Second rejection: staff decide.
  actions.portal_order_deliver({ db, body: { id: order.id, videos: ['bbbbbbbbbbbbbbbb'] }, user });
  o = (await owner.post(`/api/dealers/elease/orders/${order.id}/reject`, { reason: 'Still the old price' })).data.order;
  assert.deepEqual([o.status, o.rejections.length], ['rejected', 2]);
  // Staff try again; this time the customer approves.
  actions.portal_order_deliver({ db, body: { id: order.id, videos: ['aaaaaaaaaaaaaaaa'] }, user });
  o = (await owner.post(`/api/dealers/elease/orders/${order.id}/approve`)).data.order;
  assert.deepEqual([o.status, o.approved_by, o.videos.length], ['approved', 'owner@lr.test', 1]);
  assert.ok(!(await actions.portal_orders({ db, cfg, user })).orders.some((x) => x.id === order.id), 'approved orders leave the studio window');
  assert.equal((await owner.get('/api/dealers/elease/vehicles')).data.vehicles[0].order_status, 'approved');
  assert.equal((await staff.get('/api/staff/orders?status=approved')).data.orders.length, 1);
});

test('people: order videos and add people are separate permissions, alone or together', async () => {
  const owner = portalBrowser(); await owner.login('owner@lr.test');
  const add = (email, order, people) => owner.post('/api/dealers/elease/users', { email, name: email, password: PW, order, people });
  assert.deepEqual((await add('buyer@lr.test', true, false)).data.user.role, 'order');
  assert.deepEqual((await add('hr@lr.test', false, true)).data.user.role, 'people');
  assert.deepEqual((await add('both@lr.test', true, true)).data.user.role, 'order_people');
  assert.deepEqual((await add('sales@lr.test', false, false)).data.user.role, 'viewer');
  assert.equal((await owner.post('/api/dealers/elease/users', { email: 'maker@eshield.test', order: true })).status, 400, 'studio accounts are managed in the studio');

  // Each permission on its own.
  const buyer = portalBrowser(); await buyer.login('buyer@lr.test');
  assert.deepEqual((await buyer.get('/api/auth/me')).data.dealers[0].can, { staff: false, order: true, people: false, details: false });
  assert.equal((await buyer.get('/api/dealers/elease/users')).status, 403);
  assert.equal((await buyer.patch('/api/dealers/elease', { city: 'X' })).status, 403);
  assert.equal((await buyer.upload('/api/dealers/elease/uploads', Buffer.from(JPEG_1800x900_B, 'base64'))).status, 201, 'can order: uploads allowed');
  const hr = portalBrowser(); await hr.login('hr@lr.test');
  assert.equal((await hr.post('/api/dealers/elease/orders', {})).status, 403, 'add people only: no ordering');
  assert.equal((await hr.get('/api/dealers/elease/vin/1HGBH41JXMN109101')).status, 403);
  assert.equal((await hr.post('/api/dealers/elease/users', { email: 'new@lr.test', password: PW, order: true })).status, 201);
  assert.equal((await hr.patch('/api/dealers/elease', { city: 'San Ramon' })).status, 200, 'add people includes Dealer details');

  // Permissions change later; nobody takes away their own "add people".
  const people = (await owner.get('/api/dealers/elease/users')).data.users;
  const byEmail = Object.fromEntries(people.map((u) => [u.email, u]));
  assert.deepEqual([byEmail['maker@eshield.test'].role, byEmail['maker@eshield.test'].studio], ['order', true]);
  assert.deepEqual((await owner.patch(`/api/dealers/elease/users/${byEmail['buyer@lr.test'].id}`, { order: true, people: true })).data.user.role, 'order_people');
  assert.equal((await hr.patch(`/api/dealers/elease/users/${byEmail['hr@lr.test'].id}`, { order: false, people: false })).status, 400);
  assert.equal((await owner.del(`/api/dealers/elease/users/${byEmail['sales@lr.test'].id}`)).status, 200);
  const look = portalBrowser(); await look.login('look@lr.test');
  assert.equal((await look.get('/api/dealers/elease/users')).status, 403);
});

test('dealer details are the studio client’s details', async () => {
  const owner = portalBrowser(); await owner.login('owner@lr.test');
  const r = await owner.patch('/api/dealers/elease', { city: 'Dublin', phone: '925-555-0100', website: 'www.eleasereturns.example' });
  assert.equal(r.status, 200);
  const d = clientDetails(clientFind(db, 'elease'));
  assert.deepEqual([d.city, d.phone, d.website], ['Dublin', '925-555-0100', 'eleasereturns.example']);
  assert.equal(r.data.dealer.website, 'https://www.eleasereturns.example');
  assert.equal((await owner.patch('/api/dealers/elease', { name: 'Golden Auto' })).status, 409);
  await owner.patch('/api/dealers/elease', { website: 'lr.example' });
});

test('password change works on both sites; only the pages’ address may call the API from a browser', async () => {
  const look = portalBrowser(); await look.login('look@lr.test');
  assert.equal((await look.post('/api/auth/password', { current: 'wrong one!!', password: 'a new password!' })).status, 400);
  assert.equal((await look.post('/api/auth/password', { current: PW, password: 'a new password!' })).status, 200);
  assert.equal((await portalBrowser().call('POST', '/api/auth/login', { email: 'look@lr.test', password: 'a new password!' })).status, 200);
  const pre = await fetch(base + '/api/dealers', { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), PAGES);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  const stranger = await fetch(base + '/api/dealers', { headers: { Origin: 'https://evil.example' } });
  assert.equal(stranger.headers.get('access-control-allow-origin'), null);
  const nochange = portalBrowser(); await nochange.login('staff@eshield.test');
  const noToken = await fetch(base + '/api/dealers/elease/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 401, 'no session');
});
