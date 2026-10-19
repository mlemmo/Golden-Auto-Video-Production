// Accounts: first admin from the old dashboard password, admin-managed users, roles and per-client access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';
import { server } from '../src/server.js';
import { setConfig } from '../src/lib/config.js';
import { closeDb, openDb, save } from '../src/lib/db.js';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
function browser(base) {
  const jar = {};
  const go = async (path, opts = {}) => {
    const r = await fetch(base + path, { redirect: 'manual', ...opts, headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), ...(opts.headers ?? {}) } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0/.test(c)) delete jar[k]; else jar[k] = v; }
    return r;
  };
  const b = { go, csrf: null };
  b.signIn = async (email, password) => {
    b.csrf = (await (await go('/')).text()).match(/name="csrf" value="([a-f0-9]{48})"/)[1];
    const r = await go('/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: b.csrf, email, password }).toString() });
    return r.status;
  };
  b.post = async (action, body = {}) => { const r = await go('/api/node/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': b.csrf }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  return b;
}

test('accounts: first admin, users and viewers, per-client access, management', async () => {
  const dir = mkdtempSync(tmpdir() + '/ga-acct-');
  const cfg = { data_dir: dir, public_base_url: 'https://site.example.com:4343', password_hash: bcrypt.hashSync('old shared password', 4) };
  setConfig(cfg);
  save(openDb(cfg), 'clients', { items: [{ id: 'golden-auto', name: 'Golden Auto', website: 'https://www.mygoldenauto.net' }, { id: 'bay-motors', name: 'Bay Motors', website: 'https://bay.com' }] });
  save(openDb(cfg), 'inventory', { vehicles: [{ StockNumber: 'G1' }] });
  save(openDb(cfg), 'inventory:bay-motors', { vehicles: [{ StockNumber: 'B1' }] });
  const base = await listen(server);
  try {
    // First sign-in: the old password creates the admin for the email given; afterwards it is just a password.
    const admin = browser(base);
    assert.equal(await admin.signIn('Boss@Example.com', 'wrong'), 200, 'wrong old password: no account');
    assert.equal(await admin.signIn('Boss@Example.com', 'old shared password'), 303);
    let me = (await admin.post('me')).body;
    assert.deepEqual([me.user.email, me.user.role, me.clients.length], ['boss@example.com', 'admin', 2]);
    assert.equal(await browser(base).signIn('someone@else.com', 'old shared password'), 200, 'the old password creates no second admin');

    // The admin creates a user (Bay Motors only), a viewer (Golden Auto) and an account without clients.
    const mk = (b) => admin.post('user_create', b);
    assert.match((await mk({ email: 'u@example.com', password: 'short', role: 'user' })).body.error, /at least 10/);
    assert.equal((await mk({ email: 'u@example.com', password: 'user password 1', role: 'user', clients: ['bay-motors', 'nope'] })).body.user.clients.join(), 'bay-motors', 'unknown clients dropped');
    assert.match((await mk({ email: 'U@example.com', password: 'another one 123', role: 'user' })).body.error, /already/);
    await mk({ email: 'v@example.com', password: 'viewer password', role: 'viewer', clients: ['golden-auto'] });
    await mk({ email: 'n@example.com', password: 'nobody password', role: 'user', clients: [] });
    const list = (await admin.post('users_list')).body.users;
    assert.deepEqual(list.map((u) => u.email), ['boss@example.com', 'n@example.com', 'u@example.com', 'v@example.com']);
    assert.ok(list.every((u) => u.password_hash === undefined), 'no password hashes leave the server');

    // A user sees and works on only their clients, and cannot manage users or clients.
    const user = browser(base);
    assert.equal(await user.signIn('u@example.com', 'user password 1'), 303);
    const cl = (await user.post('clients')).body;
    assert.deepEqual([cl.items.map((c) => c.id), cl.current], [['bay-motors'], 'bay-motors']);
    assert.equal((await user.post('inventory')).body.vehicles[0].StockNumber, 'B1');
    assert.equal((await user.post('client_select', { id: 'golden-auto' })).status, 403, 'no access to another client');
    for (const a of ['users_list', 'client_add', 'client_details', 'spokesperson_delete']) assert.equal((await user.post(a)).status, 403, a);
    assert.notEqual((await user.post('generate', {})).status, 403, 'users may start paid steps (refused here only for missing details)');

    // A viewer reads only.
    const viewer = browser(base);
    assert.equal(await viewer.signIn('v@example.com', 'viewer password'), 303);
    assert.equal((await viewer.post('inventory')).body.vehicles[0].StockNumber, 'G1');
    assert.equal((await viewer.post('jobs')).status, 200);
    for (const a of ['generate', 'narration_preview', 'job_delete', 'sync', 'import', 'finish', 'footage_build']) {
      const r = await viewer.post(a); assert.equal(r.status, 403, a); assert.match(r.body.error, /view/);
    }

    // An account with no clients gets a clear message.
    const none = browser(base);
    await none.signIn('n@example.com', 'nobody password');
    assert.match((await none.post('inventory')).body.error, /No clients are assigned/);
    assert.deepEqual((await none.post('clients')).body.items, []);

    // Password change, and the admin's own account is protected.
    assert.match((await viewer.post('password_change', { current: 'nope', password: 'brand new viewer pw' })).body.error, /current password/);
    assert.equal((await viewer.post('password_change', { current: 'viewer password', password: 'brand new viewer pw' })).status, 200);
    assert.equal(await browser(base).signIn('v@example.com', 'brand new viewer pw'), 303);
    me = (await admin.post('me')).body.user;
    assert.match((await admin.post('user_update', { id: me.id, role: 'user' })).body.error, /your own admin/);
    assert.match((await admin.post('user_delete', { id: me.id })).body.error, /your own/);

    // Switching an account off signs it out at once; deleting removes it.
    const uid = list.find((u) => u.email === 'u@example.com').id;
    assert.equal((await admin.post('user_update', { id: uid, active: false })).status, 200);
    assert.equal((await user.post('inventory')).status, 401, 'switched-off account is signed out');
    assert.equal(await browser(base).signIn('u@example.com', 'user password 1'), 200, 'and cannot sign in');
    assert.equal((await admin.post('user_update', { id: uid, active: true, clients: ['golden-auto', 'bay-motors'], password: 'reset by admin 1' })).status, 200);
    const again = browser(base);
    assert.equal(await again.signIn('u@example.com', 'reset by admin 1'), 303, 'admin reset the password');
    assert.equal((await again.post('clients')).body.items.length, 2, 'new client access applies');
    assert.equal((await admin.post('user_delete', { id: uid })).status, 200);
    assert.equal((await again.post('inventory')).status, 401, 'deleted account is signed out');
  } finally {
    server.close(); closeDb(cfg); rmSync(dir, { recursive: true, force: true });
  }
});
