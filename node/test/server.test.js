import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { JPEG_1800x900 } from './fixtures/images.js';
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
    // Speech says the selected client's website as written in its details (as PHP sets per request).
    const bay = { cookie: 's=bay', 'x-csrf-token': 't' };
    assert.equal((await (await post('speech', { script: 'Visit bay.com today.' }, bay)).json()).speech, 'Visit bay dot com today.');
    assert.equal((await (await post('speech', { script: 'Visit bay.com today.' }, signedIn)).json()).speech, 'Visit bay.com today.');
    // Multipart upload (spokesperson form): fields and the file arrive like $_POST/$_FILES; temp files are removed.
    mkdirSync(dir + '/assets', { recursive: true }); cfg.asset_dir = dir + '/assets';
    const form = new FormData(); form.append('name', 'Ann'); form.append('description', 'adult woman'); form.append('image', new Blob([Buffer.from(JPEG_1800x900, 'base64')]), 'ann.jpg');
    const up = await (await fetch(base + '/api/node/spokesperson_upload', { method: 'POST', headers: signedIn, body: form })).json();
    assert.ok(up.items.some((i) => i.name === 'Ann' && existsSync(dir + '/assets/' + i.file)), JSON.stringify(up));
    const noFile = await fetch(base + '/api/node/spokesperson_upload', { method: 'POST', headers: signedIn, body: (() => { const f = new FormData(); f.append('name', 'B'); f.append('description', 'x'); return f; })() });
    assert.match((await noFile.json()).error, /Image upload failed/);
    assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('ga-upload-')).length, 0, 'upload temp folders removed');
  } finally {
    server.close(); auth.close(); closeDb(cfg); delete process.env.NODE_AUTH_URL;
    rmSync(dir, { recursive: true, force: true });
  }
});
