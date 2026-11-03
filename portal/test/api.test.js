import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NO_DB, freshDb, startApp, browser, WORKER_ID, WORKER_SECRET } from './helpers.js';
import { createUser } from '../src/lib/users.js';
import { signHeaders } from '../../node/src/lib/portal-client.js';

const PW = 'correct horse battery';

describe('portal API', { skip: NO_DB }, () => {
  let pool, app, dealerId;
  before(async () => {
    pool = await freshDb();
    app = await startApp(pool);
    await createUser(pool, { email: 'staff@eshield.test', name: 'Staff', password: PW, isStaff: true });
    const staff = browser(app.url);
    await staff.login('staff@eshield.test', PW);
    dealerId = (await staff.post('/api/dealers', { name: 'Golden Auto', slug: 'golden-auto', website: 'https://www.mygoldenauto.net' })).data.dealer.id;
    for (const [email, role] of [['owner@golden.test', 'owner'], ['admin@golden.test', 'admin'], ['viewer@golden.test', 'viewer']]) {
      assert.equal((await staff.post(`/api/dealers/${dealerId}/users`, { email, role, password: PW })).status, 201);
    }
  });
  after(async () => { await app?.close(); await pool?.end(); });

  test('sign in, who am I, sign out', async () => {
    const b = browser(app.url);
    assert.equal((await b.get('/api/auth/me')).status, 401);
    assert.equal((await b.login('OWNER@golden.test', 'wrong password')).status, 401);
    const ok = await b.login(' OWNER@golden.test ', PW);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.dealers.map((d) => [d.slug, d.role]), [['golden-auto', 'owner']]);
    assert.equal((await b.get('/api/auth/me')).data.user.email, 'owner@golden.test');
    assert.equal((await b.post('/api/auth/logout')).status, 200);
    assert.equal((await b.get('/api/auth/me')).status, 401);
  });

  test('changes need the CSRF token and a JSON body', async () => {
    const b = browser(app.url);
    await b.login('owner@golden.test', PW);
    const r = await b.post(`/api/dealers/${dealerId}/users`, { email: 'x@golden.test', role: 'viewer', password: PW }, { sendCsrf: false });
    assert.equal(r.status, 403);
    const form = await fetch(`${app.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
    assert.equal(form.status, 415);
  });

  test('roles are enforced on the server', async () => {
    const viewer = browser(app.url);
    await viewer.login('viewer@golden.test', PW);
    assert.equal((await viewer.get(`/api/dealers/${dealerId}`)).data.role, 'viewer');
    assert.equal((await viewer.get(`/api/dealers/${dealerId}/jobs`)).status, 200);
    assert.equal((await viewer.get(`/api/dealers/${dealerId}/users`)).status, 403);
    assert.equal((await viewer.post(`/api/dealers/${dealerId}/users`, { email: 'v2@golden.test', role: 'viewer', password: PW })).status, 403);
    assert.equal((await viewer.post('/api/dealers', { name: 'X', slug: 'x' })).status, 403);
    assert.equal((await viewer.post(`/api/dealers/${dealerId}/jobs/ping`)).status, 403);

    const admin = browser(app.url);
    await admin.login('admin@golden.test', PW);
    assert.equal((await admin.post(`/api/dealers/${dealerId}/users`, { email: 'o2@golden.test', role: 'owner', password: PW })).status, 403, 'admins cannot make owners');
    const added = await admin.post(`/api/dealers/${dealerId}/users`, { email: 'approver@golden.test', role: 'approver', password: PW });
    assert.equal(added.status, 201);
    const owner = (await admin.get(`/api/dealers/${dealerId}/users`)).data.users.find((u) => u.role === 'owner');
    assert.equal((await admin.del(`/api/dealers/${dealerId}/users/${owner.id}`)).status, 403, 'admins cannot remove owners');

    const ownerB = browser(app.url);
    await ownerB.login('owner@golden.test', PW);
    assert.equal((await ownerB.patch(`/api/dealers/${dealerId}/users/${owner.id}`, { role: 'admin' })).status, 409, 'the last owner stays');
  });

  test('staff add dealers from the form: checks and the new dealer in /me', async () => {
    const staff = browser(app.url);
    await staff.login('staff@eshield.test', PW);
    assert.equal((await staff.post('/api/dealers', { name: '', slug: 'empty' })).status, 400);
    assert.equal((await staff.post('/api/dealers', { name: 'Bad Slug', slug: 'Bad Slug!' })).status, 400);
    assert.equal((await staff.post('/api/dealers', { name: 'Not A Site', slug: 'not-a-site', website: 'not a website' })).status, 400);
    const plain = await staff.post('/api/dealers', { name: 'Plain Http', slug: 'plain-http', website: 'http://Example.com/used-cars' });
    assert.equal(plain.data.dealer.website, 'https://example.com', 'websites are kept as their https address');
    assert.equal((await staff.post('/api/dealers', { name: 'Golden Again', slug: 'golden-auto' })).status, 409);
    const added = await staff.post('/api/dealers', { name: 'Bay Motors', slug: 'bay-motors', website: '', timezone: 'America/Denver' });
    assert.equal(added.status, 201);
    assert.equal(added.data.dealer.website, null, 'a blank website is stored as none');
    assert.equal(added.data.dealer.timezone, 'America/Denver');
    const me = (await staff.get('/api/auth/me')).data;
    assert.ok(me.dealers.some((d) => d.slug === 'bay-motors' && d.role === 'staff'));
  });

  test('owners and admins edit their dealer; only staff change the short name', async () => {
    const owner = browser(app.url), viewer = browser(app.url), admin = browser(app.url), staff = browser(app.url);
    await owner.login('owner@golden.test', PW); await viewer.login('viewer@golden.test', PW);
    await admin.login('admin@golden.test', PW); await staff.login('staff@eshield.test', PW);
    assert.equal((await viewer.patch(`/api/dealers/${dealerId}`, { city: 'X' })).status, 403);
    const r = await owner.patch(`/api/dealers/${dealerId}`, { website: 'mygoldenauto.net', city: 'San Ramon', state: 'CA', phone: '(925) 555-1234' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.dealer.website, r.data.dealer.city, r.data.dealer.phone, r.data.changed.length], ['https://mygoldenauto.net', 'San Ramon', '(925) 555-1234', 4]);
    assert.equal((await admin.patch(`/api/dealers/${dealerId}`, { phone: '12' })).status, 400);
    assert.equal((await admin.patch(`/api/dealers/${dealerId}`, { timezone: 'Mars/Base' })).status, 400);
    assert.equal((await admin.patch(`/api/dealers/${dealerId}`, { slug: 'golden' })).status, 403, 'short name is staff only');
    assert.equal((await staff.patch(`/api/dealers/${dealerId}`, { slug: 'bay-motors' })).status, 409, 'short names stay unique');
    assert.equal((await staff.patch(`/api/dealers/${dealerId}`, { name: 'Golden Auto Sales' })).data.dealer.name, 'Golden Auto Sales');
    assert.equal((await owner.get('/api/auth/me')).data.dealers[0].name, 'Golden Auto Sales');
    await staff.patch(`/api/dealers/${dealerId}`, { name: 'Golden Auto' });
  });

  test('a dealer you do not belong to looks like it does not exist', async () => {
    const staff = browser(app.url);
    await staff.login('staff@eshield.test', PW);
    const other = (await staff.post('/api/dealers', { name: 'Other Motors', slug: 'other-motors' })).data.dealer.id;
    const owner = browser(app.url);
    await owner.login('owner@golden.test', PW);
    assert.equal((await owner.get(`/api/dealers/${other}`)).status, 404);
    assert.equal((await owner.get(`/api/dealers/${other}/jobs`)).status, 404);
    assert.deepEqual((await owner.get('/api/dealers')).data.dealers.map((d) => d.slug), ['golden-auto']);
  });

  test('sign-in, dealer and member changes are in the audit log', async () => {
    const owner = browser(app.url);
    await owner.login('owner@golden.test', PW);
    const actions = (await owner.get(`/api/dealers/${dealerId}/audit`)).data.entries.map((e) => e.action);
    assert.ok(actions.includes('dealer_create'));
    assert.ok(actions.includes('member_add'));
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('login', 'login_failed')");
    assert.ok(rows[0].n > 0);
  });

  test('five wrong passwords lock that email for 15 minutes', async () => {
    const b = browser(app.url);
    for (let i = 0; i < 5; i++) assert.equal((await b.login('approver@golden.test', 'nope nope nope')).status, 401);
    assert.equal((await b.login('approver@golden.test', PW)).status, 429);
  });

  test('worker API refuses unsigned or wrongly signed requests', async () => {
    const path = '/api/worker/jobs/lease';
    const body = JSON.stringify({ types: ['ping'] });
    const send = (headers) => fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal((await send({})).status, 401);
    assert.equal((await send(signHeaders(WORKER_ID, 'x'.repeat(40), 'POST', path, body))).status, 401);
    assert.equal((await send(signHeaders(WORKER_ID, WORKER_SECRET, 'POST', path, body, Date.now() - 600_000))).status, 401);
    const ok = await send(signHeaders(WORKER_ID, WORKER_SECRET, 'POST', path, body));
    assert.equal(ok.status, 204, 'signed request with an empty queue');
  });
});
