import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
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

test('pages still served by PHP: actions use the PHP sign-in, a CSRF token, and use the session’s client', async () => {
  // Stand-in for public/node_auth.php: cookie PHPSESSID=ok is signed in with client golden-auto, PHPSESSID=bay with bay-motors;
  // the session's CSRF token is "t".
  let authCalls = 0;
  const auth = createServer((req, res) => {
    authCalls++;
    const cookie = req.headers.cookie ?? '';
    const signed = cookie.includes('PHPSESSID=ok') ? 'golden-auto' : cookie.includes('PHPSESSID=bay') ? 'bay-motors' : null;
    if (!signed) { res.writeHead(401); return res.end('{"error":"Sign in again."}'); }
    if (req.headers['x-node-method'] !== 'GET' && req.headers['x-csrf-token'] !== 't') { res.writeHead(403); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ client: signed }));
  });
  process.env.NODE_AUTH_URL = (await listen(auth)) + '/node_auth.php';
  const dir = mkdtempSync(tmpdir() + '/ga-srv-');
  const cfg = { data_dir: dir, public_base_url: 'https://node.example.com:4343', password_hash: 'x' };
  setConfig(cfg); clearAuthCache();
  const base = await listen(server);
  const post = (action, body, headers = {}) => fetch(base + '/api/node/' + action, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const signedIn = { cookie: 'PHPSESSID=ok', 'x-csrf-token': 't' };
  try {
    assert.equal((await post('clients', {})).status, 401, 'no cookie');
    assert.equal((await post('clients', {}, { cookie: 'PHPSESSID=nope', 'x-csrf-token': 't' })).status, 401, 'not signed in');
    assert.equal((await post('clients', {}, { cookie: 'PHPSESSID=ok', 'x-csrf-token': 'wrong' })).status, 403, 'wrong CSRF token');
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
    assert.equal((await (await post('inventory', {}, { cookie: 'PHPSESSID=bay', 'x-csrf-token': 't' })).json()).vehicles[0].StockNumber, 'B1');
    const saved = await (await post('client_details', { name: 'Bay Motors', city: 'Oakland', website: 'bay.com' }, { cookie: 'PHPSESSID=bay', 'x-csrf-token': 't' })).json();
    assert.equal(saved.client.script_details.city, 'Oakland');
    // Speech says the selected client's website as written in its details (as PHP sets per request).
    const bay = { cookie: 'PHPSESSID=bay', 'x-csrf-token': 't' };
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

test('Node sign-in: pages, password, CSRF, sessions, client choice, sign-out', { skip: spawnSync('php', ['-v']).status !== 0 && 'php CLI missing' }, async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-login-');
  const hash = spawnSync('php', ['-r', 'echo password_hash("correct horse", PASSWORD_DEFAULT);']).stdout.toString();
  const cfg = { data_dir: dir, public_base_url: 'https://node.example.com:4343', password_hash: hash, environment: 'node' };
  setConfig(cfg);
  const base = await listen(server);
  const jar = {};
  const go = async (path, opts = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(opts.headers ?? {}) } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    return r;
  };
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  try {
    let r = await go('/');
    let html = await r.text();
    assert.ok(r.headers.get('set-cookie').includes('HttpOnly; SameSite=Strict') && html.includes('NODE TEST • Golden Auto • Sign in'));
    const csrf = html.match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    assert.equal((await go('/api/node/inventory', { method: 'POST', headers: { 'x-csrf-token': csrf } })).status, 401, 'actions need sign-in');
    assert.equal((await go('/', form({ csrf: 'bad', password: 'x' }))).status, 403, 'sign-in form needs its CSRF token');
    html = await (await go('/', form({ csrf, password: 'wrong' }))).text();
    assert.ok(html.includes('Incorrect password.'));
    const before = jar.ga_sid;
    r = await go('/', form({ csrf, password: 'correct horse' }));
    assert.equal(r.status, 303, 'sign-in redirects (no form resend on reload)');
    assert.equal(r.headers.get('location'), '/');
    html = await (await go('/')).text();
    assert.ok(html.includes('window.CSRF="' + csrf + '"') && html.includes('window.NODE_ACTIONS=') && html.includes('"client_select"') && html.includes('NODE TEST — test copy'), 'dashboard page');
    assert.notEqual(jar.ga_sid, before, 'new session id after sign-in');
    assert.ok((await (await go('/index.php')).text()).includes('id="stepVehicle"'), 'signed in on reload');
    const post = (action, body, token = csrf) => go('/api/node/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(body) });
    assert.equal((await post('clients', {}, 'wrong')).status, 403, 'actions need the CSRF token');
    assert.equal((await (await post('clients', {})).json()).current, 'golden-auto');
    assert.equal((await go('/?api=inventory', { method: 'POST', headers: { 'x-csrf-token': csrf } })).status, 200, 'PHP-style ?api= address works too');
    save(openDb(cfg), 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'bay-motors', name: 'Bay Motors', website: 'https://bay.com' }] });
    assert.match((await (await post('client_select', { id: 'bay-motors' })).json()).message, /Client selected/);
    assert.equal((await (await post('clients', {})).json()).current, 'bay-motors', 'choice kept in the session');
    assert.equal((await post('client_select', { id: 'nope' })).status, 400);
    assert.deepEqual(await (await post('logout', {})).json(), {});
    assert.equal(jar.ga_sid, undefined, 'cookie cleared');
    assert.ok((await (await go('/')).text()).includes('Sign in'), 'signed out');
    // Five wrong passwords in five minutes lock the form.
    const c2 = (await (await go('/')).text()).match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    for (let i = 0; i < 5; i++) await go('/', form({ csrf: c2, password: 'no' }));
    assert.ok((await (await go('/', form({ csrf: c2, password: 'correct horse' }))).text()).includes('Too many attempts'));
    assert.equal((await go('/', { headers: { 'x-forwarded-proto': 'http' } })).status, 403, 'plain http refused');
    assert.equal((await go('/style.css')).status, 404, 'static files are Nginx’s');
  } finally {
    server.close(); closeDb(cfg); rmSync(dir, { recursive: true, force: true });
  }
});
