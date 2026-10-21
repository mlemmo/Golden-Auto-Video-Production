// Connect Facebook & Instagram (Facebook Login for Business). Facebook is a fake: nothing leaves this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb } from '../src/lib/db.js';
import { facebookApi, facebookCallback, facebookConnection, connectedAccount, facebookBouncePage } from '../src/lib/facebook.js';
import { socialAccount } from '../src/lib/social.js';

const NOW = Date.parse('2026-10-21T17:00:00Z');
const cfg = { public_base_url: 'https://staging.example.com:4343', facebook: { app_id: '1828647338557647', app_secret: 'APP-SECRET', config_id: '1721634192854903' } };
const user = { email: 'mark@example.com', role: 'admin' };
const twoPages = { data: [
  { id: '1111111111', name: 'Golden Auto', access_token: 'PAGE-TOKEN', instagram_business_account: { id: '17840000000000000', username: 'goldenauto' } },
  { id: '2222222222', name: 'Other Page', access_token: 'PAGE-2' }] };
function fakeFacebook(accounts = { data: [twoPages.data[0]] }) {
  const calls = [];
  const transport = async (method, url, headers) => {
    calls.push({ method, url, headers });
    if (url.includes('/oauth/access_token?')) return { status: 200, json: { access_token: 'SYSTEM-USER-TOKEN', token_type: 'bearer' } };
    if (url.includes('/me/accounts?')) return { status: 200, json: accounts };
    return { status: 400, json: { error: { message: 'unexpected' } } };
  };
  return { calls, transport };
}
const start = (db, session, client = 'golden-auto') => facebookApi('facebook_connect', {}, db, cfg, session, client, { random: () => Buffer.alloc(24, 7), now: NOW });

test('connect: the login dialog uses the app, configuration, exact callback and a one-time state', () => {
  const db = openMemoryDb(), session = { data: {} };
  const u = new URL(start(db, session).url);
  assert.equal(u.origin + u.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
  assert.deepEqual(Object.fromEntries(u.searchParams), { client_id: '1828647338557647', redirect_uri: 'https://staging.example.com:4343/api/node/facebook/callback',
    config_id: '1721634192854903', response_type: 'code', override_default_response_type: 'true', state: '07'.repeat(24) });
  assert.deepEqual(session.data.fb_state, { state: '07'.repeat(24), client: 'golden-auto', at: NOW });
  assert.throws(() => facebookApi('facebook_connect', {}, db, { public_base_url: cfg.public_base_url }, session, 'golden-auto'), /not set up/);
  assert.equal(facebookApi('facebook_status', {}, db, cfg, session, 'golden-auto').connected, false);
});

test('callback: code exchanged with the secret, Page and Instagram saved; tokens never shown', async () => {
  const db = openMemoryDb(), session = { data: {} };
  start(db, session);
  const fb = fakeFacebook();
  const q = new URLSearchParams({ code: 'CODE', state: '07'.repeat(24) });
  const msg = await facebookCallback(db, cfg, session, user, q, ['golden-auto'], { transport: fb.transport, now: NOW + 60000 });
  assert.equal(msg, 'Connected to Golden Auto and Instagram @goldenauto.');
  const ex = new URL(fb.calls[0].url);
  assert.deepEqual(Object.fromEntries(ex.searchParams), { client_id: '1828647338557647', client_secret: 'APP-SECRET', redirect_uri: 'https://staging.example.com:4343/api/node/facebook/callback', code: 'CODE' });
  assert.equal(fb.calls[1].headers.Authorization, 'OAuth SYSTEM-USER-TOKEN');
  assert.deepEqual(connectedAccount(db, 'golden-auto'), { page_token: 'PAGE-TOKEN', page_id: '1111111111', ig_user_id: '17840000000000000' });
  const a = socialAccount({}, 'golden-auto', db);
  assert.deepEqual([a.facebook, a.instagram, a.token], [true, true, 'PAGE-TOKEN'], 'publishing uses the connection');
  session.data.fb_message = msg;
  const s = facebookApi('facebook_status', {}, db, cfg, session, 'golden-auto');
  assert.deepEqual([s.connected, s.page_name, s.ig_username, s.message], [true, 'Golden Auto', 'goldenauto', msg]);
  assert.ok(!JSON.stringify(s).includes('TOKEN') && !('fb_message' in session.data), 'names only; the message is shown once');
  assert.match(await facebookCallback(db, cfg, session, user, q, ['golden-auto'], { transport: fb.transport, now: NOW }), /expired or did not match/, 'a state is used once');
  facebookApi('facebook_disconnect', {}, db, cfg, session, 'golden-auto');
  assert.equal(facebookConnection(db, 'golden-auto'), null);
  assert.equal(socialAccount({}, 'golden-auto', db).facebook, false);
});

test('callback refusals: wrong or old state, cancelled login, viewer, other client', async () => {
  const db = openMemoryDb(), fb = fakeFacebook();
  const run = async (q, o = {}) => {
    const session = { data: {} }; start(db, session, o.client ?? 'golden-auto');
    return facebookCallback(db, cfg, session, o.user ?? user, new URLSearchParams(q), o.allowed ?? ['golden-auto'], { transport: fb.transport, now: o.now ?? NOW });
  };
  assert.match(await run({ code: 'C', state: 'x'.repeat(48) }), /did not match/);
  assert.match(await run({ code: 'C', state: '07'.repeat(24) }, { now: NOW + 16 * 60000 }), /expired/);
  assert.match(await run({ error: 'access_denied', error_description: 'Permissions error', state: '07'.repeat(24) }), /cancelled: Permissions error/);
  assert.match(await run({ code: 'C', state: '07'.repeat(24) }, { user: { email: 'v@x', role: 'viewer' } }), /not connect Facebook/);
  assert.match(await run({ code: 'C', state: '07'.repeat(24) }, { client: 'eastbay', allowed: ['golden-auto'] }), /no access/);
  assert.equal(fb.calls.length, 0, 'nothing sent to Facebook for a refused return');
});

test('several Pages: the dealer chooses one', async () => {
  const db = openMemoryDb(), session = { data: {} };
  start(db, session);
  const msg = await facebookCallback(db, cfg, session, user, new URLSearchParams({ code: 'C', state: '07'.repeat(24) }), ['golden-auto'], { transport: fakeFacebook(twoPages).transport, now: NOW });
  assert.equal(msg, 'Connected. Choose which Page to post to.');
  const s = facebookApi('facebook_status', {}, db, cfg, session, 'golden-auto');
  assert.deepEqual([s.connected, s.pages.map((p) => p.name)], [false, ['Golden Auto', 'Other Page']]);
  assert.equal(connectedAccount(db, 'golden-auto'), null, 'nothing posted until a Page is chosen');
  assert.throws(() => facebookApi('facebook_page', { page_id: '999' }, db, cfg, session, 'golden-auto'), /Choose one of the Pages/);
  const r = facebookApi('facebook_page', { page_id: '2222222222' }, db, cfg, session, 'golden-auto');
  assert.deepEqual([r.connected, r.page_name, r.instagram], [true, 'Other Page', false]);
  const a = socialAccount({}, 'golden-auto', db);
  assert.deepEqual([a.facebook, a.instagram], [true, false], 'a Page without Instagram posts to Facebook only');
});

test('Facebook\'s return is bounced to this origin so the SameSite=Strict session cookie is sent', () => {
  const page = facebookBouncePage(new URLSearchParams({ code: 'AQ<b>&x', state: 'abc', other: 'dropped' }));
  assert.ok(page.includes('<meta http-equiv="refresh" content="0;url=/api/node/facebook/return?code=AQ%3Cb%3E%26x&amp;state=abc">'), page);
  assert.ok(!page.includes('other') && !page.includes('<script') && page.includes('name="referrer" content="no-referrer"'));
});
