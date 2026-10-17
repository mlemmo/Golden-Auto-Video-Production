import { test } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.js';

test('health check answers; unknown routes 404', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(base + '/api/node/health');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    assert.equal((await fetch(base + '/api/node/nope')).status, 404);
  } finally {
    server.close();
  }
});
