import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { JPEG_1800x900 } from './fixtures/images.js';
import { tmpdir } from 'node:os';
import { server } from '../src/server.js';
import { setConfig } from '../src/lib/config.js';
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

/** A site folder with a built dashboard page and a stylesheet (what web/ builds into public/app). */
function siteRoot() {
  const root = mkdtempSync(tmpdir() + '/ga-root-');
  mkdirSync(root + '/public/app/static', { recursive: true });
  writeFileSync(root + '/public/app/index.html', '<!doctype html><html><head><title>Golden Auto • Video Studio</title><!--GA_BOOT--></head><body><div id="root"></div></body></html>');
  writeFileSync(root + '/public/app/static/index-abc.js', 'console.log(1)');
  writeFileSync(root + '/public/style.css', 'body{}');
  writeFileSync(root + '/public/app/static/.secret.js', 'x');
  return root;
}
/** A browser: cookie jar, sign-in form and JSON actions with the session's CSRF token. */
function browser(base) {
  const jar = {};
  const go = async (path, opts = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(opts.headers ?? {}) } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    return r;
  };
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const b = { jar, go, form, csrf: null };
  b.signIn = async (password = 'correct horse', email = 'admin@example.com') => {
    b.csrf = (await (await go('/')).text()).match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    return go('/', form({ csrf: b.csrf, email, password }));
  };
  b.post = (action, body, token) => go('/api/node/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token ?? b.csrf }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return b;
}
const HASH = bcrypt.hashSync('correct horse', 4);

test('actions: signed-in session, CSRF token, the session’s client, uploads', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-srv-');
  const cfg = { data_dir: dir, public_base_url: 'https://node.example.com:4343', password_hash: HASH };
  setConfig(cfg);
  const base = await listen(server);
  const b = browser(base);
  try {
    assert.equal((await b.post('clients', {}, 't')).status, 401, 'not signed in');
    assert.equal((await b.signIn()).status, 303);
    assert.equal((await b.post('clients', {}, 'wrong')).status, 403, 'wrong CSRF token');
    assert.equal((await fetch(base + '/api/node/clients')).status, 405, 'GET refused');
    const list = await (await b.post('clients', {})).json();
    assert.equal(list.current, 'golden-auto');
    assert.equal(list.items[0].id, 'golden-auto');
    assert.equal(list.items[0].script_details.website, 'mygoldenauto.net');
    const bad = await b.post('client_details', { name: 'Golden Auto', website: 'not a site' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /website/, 'a user-facing message');
    const ga = await (await b.post('client_details', { name: 'Golden Auto', city: 'San Ramon', website: 'mygoldenauto.net', phone: '925-555-1234' })).json();
    assert.equal(ga.client.script_details.phone, '925-555-1234', 'Golden Auto’s details are editable, with a phone number');
    assert.equal((await b.post('clients', '[1]')).status, 400, 'non-object JSON refused');
    // The session's client decides which inventory is read.
    save(openDb(cfg), 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'bay-motors', name: 'Bay Motors', website: 'https://bay.com' }] });
    save(openDb(cfg), 'inventory:bay-motors', { vehicles: [{ StockNumber: 'B1' }] });
    save(openDb(cfg), 'inventory', { vehicles: [{ StockNumber: 'G1' }] });
    assert.equal((await (await b.post('inventory', {})).json()).vehicles[0].StockNumber, 'G1');
    // Speech says the selected client's website as written in its details.
    assert.equal((await (await b.post('speech', { script: 'Visit bay.com today.' })).json()).speech, 'Visit bay.com today.');
    assert.match((await (await b.post('client_select', { id: 'bay-motors' })).json()).message, /Client selected/);
    assert.equal((await (await b.post('inventory', {})).json()).vehicles[0].StockNumber, 'B1');
    const saved = await (await b.post('client_details', { name: 'Bay Motors', city: 'Oakland', website: 'bay.com' })).json();
    assert.equal(saved.client.script_details.city, 'Oakland');
    assert.equal((await (await b.post('speech', { script: 'Visit bay.com today.' })).json()).speech, 'Visit bay dot com today.');
    assert.equal((await b.post('client_select', { id: 'nope' })).status, 400);
    // Multipart upload (spokesperson form): fields and the file arrive; temp files are removed.
    mkdirSync(dir + '/assets', { recursive: true }); cfg.asset_dir = dir + '/assets';
    const headers = { cookie: 'ga_sid=' + b.jar.ga_sid, 'x-csrf-token': b.csrf };
    const form = new FormData(); form.append('name', 'Ann'); form.append('description', 'adult woman'); form.append('image', new Blob([Buffer.from(JPEG_1800x900, 'base64')]), 'ann.jpg');
    const up = await (await fetch(base + '/api/node/spokesperson_upload', { method: 'POST', headers, body: form })).json();
    assert.ok(up.items.some((i) => i.name === 'Ann' && existsSync(dir + '/assets/' + i.file)), JSON.stringify(up));
    const noFile = await fetch(base + '/api/node/spokesperson_upload', { method: 'POST', headers, body: (() => { const f = new FormData(); f.append('name', 'B'); f.append('description', 'x'); return f; })() });
    assert.match((await noFile.json()).error, /Image upload failed/);
    assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('ga-upload-')).length, 0, 'upload temp folders removed');
  } finally {
    server.close(); closeDb(cfg);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign-in, the React dashboard page, static files, sign-out', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-login-'), root = siteRoot();
  const cfg = { data_dir: dir, public_base_url: 'https://node.example.com:4343', password_hash: HASH, environment: 'staging' };
  process.env.GOLDEN_ROOT = root; setConfig(cfg, root);
  const base = await listen(server);
  const b = browser(base);
  try {
    let r = await b.go('/');
    let html = await r.text();
    assert.ok(r.headers.get('set-cookie').includes('HttpOnly; SameSite=Strict') && html.includes('STAGING • Golden Auto • Sign in'));
    const csrf = html.match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    assert.ok(html.includes('First sign-in'), 'first sign-in note while there are no accounts');
    assert.equal((await b.go('/', b.form({ csrf: 'bad', email: 'a@b.co', password: 'x' }))).status, 403, 'sign-in form needs its CSRF token');
    assert.ok((await (await b.go('/', b.form({ csrf, email: 'admin@example.com', password: 'wrong' }))).text()).includes('Incorrect email or password.'));
    const before = b.jar.ga_sid;
    r = await b.go('/', b.form({ csrf, email: 'admin@example.com', password: 'correct horse' }));
    assert.equal(r.status, 303, 'sign-in redirects (no form resend on reload)');
    assert.equal(r.headers.get('location'), '/');
    assert.notEqual(b.jar.ga_sid, before, 'new session id after sign-in');
    html = await (await b.go('/')).text();
    const boot = JSON.parse(html.match(/window\.GA=(.*?);<\/script>/)[1]);
    assert.deepEqual([boot.csrf, boot.env, boot.user.email, boot.user.role], [csrf, 'staging', 'admin@example.com', 'admin'], 'session values put in the page');
    assert.match(boot.banner, /^STAGING — test copy/);
    assert.ok(html.includes('<title>STAGING • Golden Auto • Video Studio</title>') && html.includes('<div id="root">'), 'the React page');
    b.csrf = csrf;
    assert.equal((await (await b.post('clients', {})).json()).current, 'golden-auto');
    assert.equal((await b.go('/?api=inventory', { method: 'POST', headers: { 'x-csrf-token': csrf } })).status, 303, 'a POST to / is not an action (it redirects to the dashboard)');
    // Static files.
    r = await b.go('/app/static/index-abc.js');
    assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /immutable/); assert.match(r.headers.get('content-type'), /javascript/);
    assert.equal((await b.go('/style.css')).status, 200);
    for (const bad of ['/app/static/.secret.js', '/app/static/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/app/static/nope.js', '/app/index.html', '/private/config.json', '/assets/../private/config.json']) {
      assert.notEqual((await b.go(bad)).status, 200, bad);
    }
    assert.deepEqual(await (await b.post('logout', {})).json(), {});
    assert.equal(b.jar.ga_sid, undefined, 'cookie cleared');
    assert.ok((await (await b.go('/')).text()).includes('Sign in'), 'signed out');
    // Five wrong passwords in five minutes lock the form.
    const c2 = (await (await b.go('/')).text()).match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    for (let i = 0; i < 5; i++) await b.go('/', b.form({ csrf: c2, email: 'admin@example.com', password: 'no' }));
    assert.ok((await (await b.go('/', b.form({ csrf: c2, email: 'admin@example.com', password: 'correct horse' }))).text()).includes('Too many attempts'));
    assert.equal((await b.go('/', { headers: { 'x-forwarded-proto': 'http' } })).status, 403, 'plain http refused');
    // Not built yet: a clear message instead of a broken page.
    rmSync(root + '/public/app/index.html');
    const b2 = browser(base); await b2.signIn();
    r = await b2.go('/');
    assert.equal(r.status, 503); assert.match(await r.text(), /npm run build/);
  } finally {
    server.close(); closeDb(cfg); delete process.env.GOLDEN_ROOT;
    rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  }
});
