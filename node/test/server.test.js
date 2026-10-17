import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { server } from '../src/server.js';
import { setConfig } from '../src/lib/config.js';
import { clearAuthCache } from '../src/lib/auth.js';
import { closeDb, openDb, save } from '../src/lib/db.js';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

test('health check answers; unknown routes 404', async () => {
  const base = await listen(server);
  try {
    const ok = await fetch(base + '/api/node/health');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    assert.equal((await fetch(base + '/api/node/nope')).status, 404);
  } finally {
    server.close();
  }
});

test('actions need the PHP sign-in, a CSRF token, and use the session’s client', async () => {
  // Stand-in for public/node_auth.php: cookie "s=ok" is signed in with client golden-auto, "s=bay" with bay-motors;
  // the session's CSRF token is "t".
  let authCalls = 0;
  const auth = createServer((req, res) => {
    authCalls++;
    const cookie = req.headers.cookie ?? '';
    const signed = cookie.includes('s=ok') ? 'golden-auto' : cookie.includes('s=bay') ? 'bay-motors' : null;
    if (!signed) { res.writeHead(401); return res.end('{"error":"Sign in again."}'); }
    if (req.headers['x-node-method'] !== 'GET' && req.headers['x-csrf-token'] !== 't') { res.writeHead(403); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ client: signed }));
  });
  process.env.NODE_AUTH_URL = (await listen(auth)) + '/node_auth.php';
  const dir = mkdtempSync(tmpdir() + '/ga-srv-');
  const cfg = { data_dir: dir, public_base_url: 'https://node.example.com:4343' };
  setConfig(cfg); clearAuthCache();
  const base = await listen(server);
  const post = (action, body, headers = {}) => fetch(base + '/api/node/' + action, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const signedIn = { cookie: 's=ok', 'x-csrf-token': 't' };
  try {
    assert.equal((await post('clients', {})).status, 401, 'no cookie');
    assert.equal((await post('clients', {}, { cookie: 's=nope', 'x-csrf-token': 't' })).status, 401, 'not signed in');
    assert.equal((await post('clients', {}, { cookie: 's=ok', 'x-csrf-token': 'wrong' })).status, 403, 'wrong CSRF token');
    assert.equal((await fetch(base + '/api/node/clients')).status, 405, 'GET refused');
    const list = await (await post('clients', {}, signedIn)).json();
    assert.equal(list.current, 'golden-auto');
    assert.equal(list.items[0].id, 'golden-auto');
    assert.equal(list.items[0].script_details.website, 'mygoldenauto.net');
    const calls = authCalls;
    await post('clients', {}, signedIn);
    assert.equal(authCalls, calls, 'sign-in answer cached briefly');
    const bad = await post('client_details', { name: 'X', website: 'x.com' }, signedIn);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /fixed/, 'a user-facing message, as in PHP');
    assert.equal((await post('clients', '[1]', signedIn)).status, 400, 'non-object JSON refused');
    // The session's client decides which inventory is read.
    save(openDb(cfg), 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'bay-motors', name: 'Bay Motors', website: 'https://bay.com' }] });
    save(openDb(cfg), 'inventory:bay-motors', { vehicles: [{ StockNumber: 'B1' }] });
    save(openDb(cfg), 'inventory', { vehicles: [{ StockNumber: 'G1' }] });
    assert.equal((await (await post('inventory', {}, signedIn)).json()).vehicles[0].StockNumber, 'G1');
    assert.equal((await (await post('inventory', {}, { cookie: 's=bay', 'x-csrf-token': 't' })).json()).vehicles[0].StockNumber, 'B1');
    const saved = await (await post('client_details', { name: 'Bay Motors', city: 'Oakland', website: 'bay.com' }, { cookie: 's=bay', 'x-csrf-token': 't' })).json();
    assert.equal(saved.client.script_details.city, 'Oakland');
  } finally {
    server.close(); auth.close(); closeDb(cfg); delete process.env.NODE_AUTH_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});
