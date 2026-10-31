// Milestone 1 "done" check: a test job goes portal → worker → portal, using the real worker client from node/.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NO_DB, freshDb, startApp, browser, WORKER_ID, WORKER_SECRET } from './helpers.js';
import { createUser } from '../src/lib/users.js';
import { portalClient, runOnce, HANDLERS } from '../../node/src/lib/portal-client.js';

const PW = 'correct horse battery';

describe('portal ↔ worker round trip', { skip: NO_DB }, () => {
  let pool, app, staff, dealerId, client;
  before(async () => {
    pool = await freshDb();
    app = await startApp(pool);
    await createUser(pool, { email: 'staff@eshield.test', password: PW, isStaff: true });
    staff = browser(app.url);
    await staff.login('staff@eshield.test', PW);
    dealerId = (await staff.post('/api/dealers', { name: 'Golden Auto', slug: 'golden-auto' })).data.dealer.id;
    client = portalClient({ api: `${app.url}/api/worker`, workerId: WORKER_ID, secret: WORKER_SECRET });
  });
  after(async () => { await app?.close(); await pool?.end(); });

  test('a ping job queued in the portal is leased, answered and marked done', async () => {
    const queued = await staff.post(`/api/dealers/${dealerId}/jobs/ping`);
    assert.equal(queued.status, 201);
    const outcome = await runOnce(client);
    assert.deepEqual(outcome, { id: queued.data.job.id, type: 'ping', outcome: 'done' });
    const [job] = (await staff.get(`/api/dealers/${dealerId}/jobs`)).data.jobs;
    assert.equal(job.status, 'done');
    assert.equal(job.leased_by, WORKER_ID);
    const [[row]] = await pool.query('SELECT result_json FROM jobs WHERE id = ?', [job.id]);
    assert.equal(row.result_json.pong, true);
    assert.ok(row.result_json.received.sent_at);
    assert.equal(await runOnce(client), null, 'queue is empty afterwards');
  });

  test('a failing handler reports the error and the job is retried later', async () => {
    const queued = await staff.post(`/api/dealers/${dealerId}/jobs/ping`);
    const broken = { ping: async () => { throw new Error('renderer offline'); } };
    assert.equal((await runOnce(client, broken)).outcome, 'failed');
    const [[row]] = await pool.query('SELECT status, attempts, error FROM jobs WHERE id = ?', [queued.data.job.id]);
    assert.deepEqual({ ...row }, { status: 'queued', attempts: 1, error: 'renderer offline' });
    await pool.query('UPDATE jobs SET available_at = NOW(3) WHERE id = ?', [queued.data.job.id]);
    assert.equal((await runOnce(client, HANDLERS)).outcome, 'done');
  });

  test('heartbeats keep the lease while a long job runs', async () => {
    await staff.post(`/api/dealers/${dealerId}/jobs/ping`);
    let beats = 0;
    const counting = { ...client, heartbeat: async (id) => { beats++; return client.heartbeat(id); } };
    const slow = { ping: () => new Promise((resolve) => setTimeout(() => resolve({ slow: true }), 250)) };
    assert.equal((await runOnce(counting, slow, { heartbeatMs: 50 })).outcome, 'done');
    assert.ok(beats >= 3, `heartbeats sent: ${beats}`);
  });

  test('inventory sync and dealer config over the signed API', async () => {
    const car = (vin, price) => ({ vin, stock_no: vin.slice(-5), year: 2019, make: 'Honda', model: 'Civic', trim: 'EX', mileage: 41000, price, photos: ['https://imagescf.dealercenter.net/a.jpg'] });
    const first = await client.syncInventory(dealerId, [car('1HGBH41JXMN109186', 15688), car('2HGFC2F59KH123456', 17995)], true);
    assert.deepEqual(first, { received: 2, added: 2, changed: 0, sold: 0 });
    const second = await client.syncInventory(dealerId, [car('1HGBH41JXMN109186', 14688)], true);
    assert.deepEqual(second, { received: 1, added: 0, changed: 1, sold: 1 });
    const [rows] = await pool.query('SELECT vin, price, status FROM vehicles ORDER BY vin');
    assert.deepEqual(rows.map((r) => [r.vin, r.price, r.status]), [['1HGBH41JXMN109186', 14688, 'active'], ['2HGFC2F59KH123456', 17995, 'sold']]);
    await assert.rejects(client.syncInventory(dealerId, [car('BAD', 1)]), /Invalid VIN/);
    const cfg = await client.dealerConfig(dealerId);
    assert.equal(cfg.dealer.slug, 'golden-auto');
    assert.match(cfg.disclaimer, /Plus tax, title and fees/);
  });
});
