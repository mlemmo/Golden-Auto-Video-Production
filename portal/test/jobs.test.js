import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NO_DB, freshDb } from './helpers.js';
import { enqueueJob, getJob, leaseJobs, heartbeat, completeJob, failJob, MAX_ATTEMPTS } from '../src/lib/jobs.js';

describe('job queue', { skip: NO_DB }, () => {
  let pool, dealerId;
  before(async () => {
    pool = await freshDb();
    [{ insertId: dealerId }] = await pool.query("INSERT INTO dealers (name, slug) VALUES ('Test Motors', 'test-motors')");
  });
  after(() => pool?.end());
  const clear = () => pool.query('DELETE FROM jobs');
  const expireLease = (id) => pool.query('UPDATE jobs SET lease_expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [id]);
  const makeReady = (id) => pool.query('UPDATE jobs SET available_at = NOW(3) WHERE id = ?', [id]);

  test('leases the oldest queued job of the requested types, once', async () => {
    await clear();
    const a = await enqueueJob(pool, { dealerId, type: 'ping', payload: { n: 1 } });
    const b = await enqueueJob(pool, { dealerId, type: 'ping', payload: { n: 2 } });
    await enqueueJob(pool, { dealerId, type: 'render_video' });
    const [first] = await leaseJobs(pool, 'w1', ['ping']);
    assert.equal(first.id, a);
    assert.deepEqual(first.payload, { n: 1 });
    assert.equal(first.attempts, 1);
    const [second] = await leaseJobs(pool, 'w2', ['ping']);
    assert.equal(second.id, b);
    assert.deepEqual(await leaseJobs(pool, 'w1', ['ping']), []);
    assert.deepEqual(await leaseJobs(pool, 'w1', ['not_a_type']), []);
    const j = await getJob(pool, a);
    assert.equal(j.status, 'leased');
    assert.equal(j.leased_by, 'w1');
    assert.ok(j.lease_expires_at.getTime() - Date.now() > 14 * 60_000);
  });

  test('two workers leasing at the same moment never get the same job', async () => {
    await clear();
    for (let i = 0; i < 6; i++) await enqueueJob(pool, { dealerId, type: 'ping' });
    const results = await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].map((w) => leaseJobs(pool, w, ['ping'])));
    const ids = results.flat().map((j) => j.id);
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, 6);
  });

  test('only the worker holding the lease can heartbeat, complete or fail', async () => {
    await clear();
    const id = await enqueueJob(pool, { dealerId, type: 'ping' });
    await leaseJobs(pool, 'w1', ['ping']);
    assert.equal(await heartbeat(pool, id, 'w2'), false);
    assert.equal(await completeJob(pool, id, 'w2', {}), false);
    assert.equal(await failJob(pool, id, 'w2', 'x', true), false);
    assert.equal(await heartbeat(pool, id, 'w1'), true);
    assert.equal(await completeJob(pool, id, 'w1', { pong: true }), true);
    const j = await getJob(pool, id);
    assert.equal(j.status, 'done');
    assert.deepEqual(j.result_json, { pong: true });
    assert.equal(await completeJob(pool, id, 'w1', {}), false, 'a finished job cannot be completed twice');
  });

  test('retryable failures wait with backoff and stop after 3 attempts', async () => {
    await clear();
    const id = await enqueueJob(pool, { dealerId, type: 'ping' });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const [job] = await leaseJobs(pool, 'w1', ['ping']);
      assert.equal(job.id, id);
      assert.equal(job.attempts, attempt);
      assert.equal(await failJob(pool, id, 'w1', `boom ${attempt}`, true), true);
      const j = await getJob(pool, id);
      if (attempt < MAX_ATTEMPTS) {
        assert.equal(j.status, 'queued');
        const wait = (j.available_at.getTime() - Date.now()) / 1000;
        const expected = 30 * 2 ** (attempt - 1);
        assert.ok(wait > expected - 5 && wait <= expected, `waits about ${expected}s (got ${wait})`);
        assert.deepEqual(await leaseJobs(pool, 'w1', ['ping']), [], 'not leased again before the backoff');
        await makeReady(id);
      } else {
        assert.equal(j.status, 'failed');
        assert.equal(j.error, 'boom 3');
      }
    }
  });

  test('a non-retryable failure fails at once', async () => {
    await clear();
    const id = await enqueueJob(pool, { dealerId, type: 'ping' });
    await leaseJobs(pool, 'w1', ['ping']);
    await failJob(pool, id, 'w1', 'bad input', false);
    assert.equal((await getJob(pool, id)).status, 'failed');
  });

  test('an expired lease returns to the queue, and the old holder can no longer finish it', async () => {
    await clear();
    const id = await enqueueJob(pool, { dealerId, type: 'ping' });
    await leaseJobs(pool, 'w1', ['ping']);
    await expireLease(id);
    assert.equal(await completeJob(pool, id, 'w1', {}), false);
    const [job] = await leaseJobs(pool, 'w2', ['ping']);
    assert.equal(job.id, id);
    assert.equal(job.attempts, 2);
    assert.equal((await getJob(pool, id)).leased_by, 'w2');
  });

  test('an expired lease on the last attempt fails the job', async () => {
    await clear();
    const id = await enqueueJob(pool, { dealerId, type: 'ping' });
    await leaseJobs(pool, 'w1', ['ping']);
    await pool.query('UPDATE jobs SET attempts = ? WHERE id = ?', [MAX_ATTEMPTS, id]);
    await expireLease(id);
    assert.deepEqual(await leaseJobs(pool, 'w2', ['ping']), []);
    const j = await getJob(pool, id);
    assert.equal(j.status, 'failed');
    assert.match(j.error, /Lease expired/);
  });
});
