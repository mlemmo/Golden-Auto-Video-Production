import test from 'node:test';
import assert from 'node:assert/strict';
import { signature, verifyWorkerRequest, parseWorkerSecrets } from '../src/lib/hmac.js';
import { signHeaders } from '../../node/src/lib/portal-client.js';

const SECRET = 'a'.repeat(40);
const secrets = new Map([['w1', SECRET]]);
const NOW = 1_800_000_000;
const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
const signed = (body = '{"x":1}', path = '/api/worker/jobs/lease', at = NOW) => lower(signHeaders('w1', SECRET, 'POST', path, body, at * 1000));

test('worker signature (node/ client) verifies on the portal', () => {
  const r = verifyWorkerRequest({ secrets, headers: signed(), method: 'POST', path: '/api/worker/jobs/lease', body: Buffer.from('{"x":1}'), now: NOW });
  assert.deepEqual(r, { ok: true, workerId: 'w1' });
});

test('signature covers timestamp, method, path and body', () => {
  const h = signed();
  assert.equal(h['x-signature'], signature(SECRET, String(NOW), 'post', '/api/worker/jobs/lease', '{"x":1}'));
  const base = { secrets, headers: h, method: 'POST', path: '/api/worker/jobs/lease', body: '{"x":1}', now: NOW };
  assert.equal(verifyWorkerRequest({ ...base, body: '{"x":2}' }).reason, 'bad signature');
  assert.equal(verifyWorkerRequest({ ...base, path: '/api/worker/jobs/9/complete' }).reason, 'bad signature');
  assert.equal(verifyWorkerRequest({ ...base, method: 'GET' }).reason, 'bad signature');
  assert.equal(verifyWorkerRequest({ ...base, secrets: new Map([['w1', 'b'.repeat(40)]]) }).reason, 'bad signature');
});

test('requests older or newer than 300 s, unknown workers and malformed signatures are refused', () => {
  const base = { secrets, method: 'POST', path: '/p', body: '' };
  assert.equal(verifyWorkerRequest({ ...base, headers: signed('', '/p', NOW - 301), now: NOW }).reason, 'timestamp outside 300 s');
  assert.equal(verifyWorkerRequest({ ...base, headers: signed('', '/p', NOW + 301), now: NOW }).reason, 'timestamp outside 300 s');
  assert.equal(verifyWorkerRequest({ ...base, headers: signed('', '/p', NOW - 299), now: NOW }).ok, true);
  assert.equal(verifyWorkerRequest({ ...base, headers: { ...signed('', '/p'), 'x-worker-id': 'w2' }, now: NOW }).reason, 'unknown worker');
  assert.equal(verifyWorkerRequest({ ...base, headers: { ...signed('', '/p'), 'x-signature': 'zz' }, now: NOW }).reason, 'malformed signature');
  assert.equal(verifyWorkerRequest({ ...base, headers: {}, now: NOW }).reason, 'unknown worker');
});

test('WORKER_SHARED_SECRETS parsing refuses short secrets and bad ids', () => {
  assert.deepEqual([...parseWorkerSecrets(` a:${SECRET} , b-2:${SECRET}`)], [['a', SECRET], ['b-2', SECRET]]);
  assert.equal(parseWorkerSecrets('').size, 0);
  assert.throws(() => parseWorkerSecrets('a:short'), /shorter than 32/);
  assert.throws(() => parseWorkerSecrets(SECRET), /workerId:secret/);
  assert.throws(() => parseWorkerSecrets(`bad id:${SECRET}`), /workerId:secret/);
});
