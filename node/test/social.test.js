// Posting to Facebook and Instagram. Meta is a fake: no request ever leaves this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb } from '../src/lib/db.js';
import { jsonEncode } from '../src/lib/storedjson.js';
import { socialApi, socialWorkerRun, socialAccount } from '../src/lib/social.js';

const NOW = Date.parse('2026-10-21T17:00:00Z');
const FILE = 'a'.repeat(40) + '.mp4';
function setup(job = {}) {
  const dir = mkdtempSync(tmpdir() + '/ga-social-');
  const cfg = { asset_dir: dir, data_dir: dir + '/data', public_base_url: 'https://staging.example.com:4343',
    meta_accounts: { 'golden-auto': { page_id: '1111111111', page_token: 'PAGE-TOKEN', ig_user_id: '17840000000000000' } } };
  writeFileSync(dir + '/' + FILE, 'video');
  const db = openMemoryDb();
  const j = { id: 'job1', client: 'golden-auto', vehicle: '2016 CHEVROLET SILVERADO', stock: '217723', format: 'instagram_reels', duration: 30, finish_status: 'completed',
    captioned_url: cfg.public_base_url + '/assets/' + FILE, script: 'Take a look at this 2016 Chevrolet Silverado. Priced at $19,366.', ...job };
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(j.id, null, jsonEncode(j));
  let n = 0;
  const api = (a, inp, o = {}) => socialApi(a, inp, db, cfg, { now: NOW, user: 'mark@example.com', random: () => Buffer.from([n++, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ...o });
  return { dir, cfg, db, api };
}
const done = (dir) => rmSync(dir, { recursive: true, force: true });

/** A fake Meta: answers by URL; every call is recorded. */
function fakeMeta({ fbStatus = ['ready'], igStatus = ['FINISHED'], fail = {} } = {}) {
  const calls = [];
  const transport = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body: Buffer.isBuffer(body) ? body.toString() : body });
    for (const [part, r] of Object.entries(fail)) if (url.includes(part)) { if (r === 'network') throw new Error('socket hang up'); return r; }
    if (url.endsWith('/video_reels') && body.includes('upload_phase=start')) return { status: 200, json: { video_id: '9001', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/9001' } };
    if (url.endsWith('/video_reels')) return { status: 200, json: { success: true, post_id: '1111111111_9001' } };
    if (url.includes('rupload.facebook.com')) return { status: 200, json: { success: true } };
    if (url.includes('/9001?fields=status')) return { status: 200, json: { status: { video_status: fbStatus.length > 1 ? fbStatus.shift() : fbStatus[0] } } };
    if (url.includes('/9001?fields=permalink_url')) return { status: 200, json: { permalink_url: '/reel/9001' } };
    if (url.endsWith('/media') && method === 'POST') return { status: 200, json: { id: '5005', uri: 'https://rupload.facebook.com/ig-api-upload/v26.0/5005' } };
    if (url.includes('/5005?fields=status_code')) return { status: 200, json: { status_code: igStatus.length > 1 ? igStatus.shift() : igStatus[0] } };
    if (url.endsWith('/media_publish')) return { status: 200, json: { id: '7007' } };
    if (url.includes('/7007?fields=permalink')) return { status: 200, json: { permalink: 'https://www.instagram.com/reel/ABC/' } };
    return { status: 404, json: { error: { message: 'unexpected ' + url } } };
  };
  return { calls, transport };
}
const prepare = async (cfg, src, out) => { writeFileSync(out, 'social copy'); return out; };

test('status: platforms set up, Reels only, suggested caption; secrets never returned', () => {
  const { dir, api, cfg } = setup();
  try {
    const s = api('social_status', { id: 'job1' });
    assert.deepEqual([s.facebook, s.instagram, s.eligible], [true, true, true]);
    assert.ok(s.caption.startsWith('Take a look at this 2016 Chevrolet Silverado.') && s.caption.endsWith('mygoldenauto.net') && !JSON.stringify(s).includes('PAGE-TOKEN'));
    assert.deepEqual(socialAccount({ meta_accounts: { x: { page_id: 'abc', page_token: 't' } } }, 'x').facebook, false, 'ids must be numbers');
    cfg.meta_accounts['golden-auto'].ig_user_id = '';
    assert.equal(api('social_status', { id: 'job1' }).instagram, false);
  } finally { done(dir); }
  const sq = setup({ format: 'square' });
  try { assert.match(sq.api('social_status', { id: 'job1' }).reason, /9:16/); assert.throws(() => sq.api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x' }), /9:16/); } finally { done(sq.dir); }
});

test('posting is checked: platforms, caption, time window, client access, duplicates', () => {
  const { dir, api, cfg } = setup();
  try {
    assert.throws(() => api('social_post', { id: 'job1', platforms: [], caption: 'x' }), /Choose Facebook, Instagram or both/);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: ' ' }), /Write a caption/);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x'.repeat(2201) }), /2200/);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x', when: new Date(NOW + 5 * 60000).toISOString() }), /10 minutes/);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x', when: new Date(NOW + 30 * 86400000).toISOString() }), /29 days/);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x' }, { allowed: ['other'] }), /no access/);
    const later = new Date(NOW + 3600000).toISOString();
    const r = api('social_post', { id: 'job1', platforms: ['facebook', 'instagram'], caption: 'Hello', when: later });
    assert.ok(/Scheduled for Facebook and Instagram/.test(r.message) && r.post.platforms.facebook.status === 'scheduled' && r.post.scheduled_at === later);
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['instagram'], caption: 'Hello' }), /already scheduled for Instagram/);
    api('social_cancel', { id: r.post.id });
    assert.equal(api('social_list', { id: 'job1' }).posts[0].platforms.instagram.status, 'canceled');
    assert.throws(() => api('social_cancel', { id: r.post.id }), /not started/);
    delete cfg.meta_accounts['golden-auto'];
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x' }), /not connected/);
  } finally { done(dir); }
});

test('Facebook and Instagram: upload, wait for processing across runs, publish once, links saved', async () => {
  const { dir, api, db, cfg } = setup();
  const meta = fakeMeta({ fbStatus: ['processing', 'ready'], igStatus: ['IN_PROGRESS', 'FINISHED'] });
  try {
    const { post } = api('social_post', { id: 'job1', platforms: ['facebook', 'instagram'], caption: 'Hello #silverado' });
    const run = (t = NOW) => socialWorkerRun(db, cfg, { transport: meta.transport, prepare, now: t });
    await run();
    let p = api('social_list', {}).posts[0];
    assert.deepEqual([p.platforms.facebook.status, p.platforms.instagram.status], ['processing', 'processing'], 'uploaded, waiting for Meta');
    const start = meta.calls[0];
    assert.equal(start.url, 'https://graph.facebook.com/v26.0/1111111111/video_reels');
    assert.equal(start.headers.Authorization, 'OAuth PAGE-TOKEN');
    assert.equal(start.body, 'upload_phase=start');
    const fbUp = meta.calls.find((c) => c.url === 'https://rupload.facebook.com/video-upload/v26.0/9001');
    assert.deepEqual([fbUp.headers.offset, fbUp.headers.file_size, fbUp.body], ['0', '11', 'social copy'], 'the prepared copy is uploaded');
    const ig = meta.calls.find((c) => c.url === 'https://graph.facebook.com/v26.0/17840000000000000/media');
    assert.equal(ig.body, new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: 'Hello #silverado', share_to_feed: 'true' }).toString());
    assert.ok(meta.calls.some((c) => c.url === 'https://rupload.facebook.com/ig-api-upload/v26.0/5005'));
    assert.ok(!existsSync(cfg.data_dir + '/social/' + post.id + '.mp4'), 'upload copy removed once both are uploaded');
    await run(NOW + 60000);
    assert.ok(!meta.calls.some((c) => c.body?.includes?.('upload_phase=finish') || c.url.endsWith('/media_publish')), 'nothing published while Meta is still processing');
    await run(NOW + 120000);
    p = api('social_list', {}).posts[0];
    assert.deepEqual([p.platforms.facebook.status, p.platforms.facebook.url], ['published', 'https://www.facebook.com/reel/9001']);
    assert.deepEqual([p.platforms.instagram.status, p.platforms.instagram.url], ['published', 'https://www.instagram.com/reel/ABC/']);
    const finish = meta.calls.find((c) => c.body?.includes?.('upload_phase=finish'));
    assert.equal(finish.body, new URLSearchParams({ video_id: '9001', upload_phase: 'finish', video_state: 'PUBLISHED', description: 'Hello #silverado' }).toString());
    assert.equal(meta.calls.find((c) => c.url.endsWith('/media_publish')).body, 'creation_id=5005');
    const count = meta.calls.length;
    await run(NOW + 180000);
    assert.equal(meta.calls.length, count, 'published posts are left alone');
    assert.throws(() => api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x' }), /already posted to Facebook/);
    assert.ok(api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'x', again: true }).post);
  } finally { done(dir); }
});

test('scheduled posts wait for their time', async () => {
  const { dir, api, db, cfg } = setup();
  const meta = fakeMeta();
  try {
    api('social_post', { id: 'job1', platforms: ['instagram'], caption: 'Later', when: new Date(NOW + 3600000).toISOString() });
    await socialWorkerRun(db, cfg, { transport: meta.transport, prepare, now: NOW + 3500000 });
    assert.equal(meta.calls.length, 0, 'not before its time');
    await socialWorkerRun(db, cfg, { transport: meta.transport, prepare, now: NOW + 3600000 });
    assert.equal(api('social_list', {}).posts[0].platforms.instagram.status, 'processing');
  } finally { done(dir); }
});

test('failures: a refusal can be retried; a lost publish answer is never repeated', async () => {
  const { dir, api, db, cfg } = setup();
  try {
    const refuse = fakeMeta({ fail: { '/video_reels': { status: 400, json: { error: { message: 'Invalid OAuth access token.', code: 190 } } } } });
    const { post } = api('social_post', { id: 'job1', platforms: ['facebook'], caption: 'Hi' });
    await socialWorkerRun(db, cfg, { transport: refuse.transport, prepare, now: NOW });
    let x = api('social_list', {}).posts[0].platforms.facebook;
    assert.deepEqual([x.status, x.error], ['failed', 'Meta refused the request: Invalid OAuth access token. [code 190]']);
    api('social_retry', { id: post.id });
    const lost = fakeMeta({ fail: { 'upload_phase=finish': 'never' } });
    const transport = async (m, url, h, body) => { if (String(body).includes('upload_phase=finish')) throw new Error('timeout'); return lost.transport(m, url, h, body); };
    await socialWorkerRun(db, cfg, { transport, prepare, now: NOW + 60000 });
    await socialWorkerRun(db, cfg, { transport, prepare, now: NOW + 120000 });
    x = api('social_list', {}).posts[0].platforms.facebook;
    assert.ok(x.status === 'check' && /Check the Facebook page/.test(x.error), x.error);
    assert.throws(() => api('social_retry', { id: post.id }), /Nothing to retry/);
    const before = lost.calls.length;
    await socialWorkerRun(db, cfg, { transport, prepare, now: NOW + 180000 });
    assert.equal(lost.calls.length, before, 'not published again');
  } finally { done(dir); }
});

test('Instagram: processing error fails; an already published container is not published twice', async () => {
  const { dir, api, db, cfg } = setup();
  try {
    api('social_post', { id: 'job1', platforms: ['instagram'], caption: 'Hi' });
    const bad = fakeMeta({ igStatus: ['ERROR'] });
    await socialWorkerRun(db, cfg, { transport: bad.transport, prepare, now: NOW });
    await socialWorkerRun(db, cfg, { transport: bad.transport, prepare, now: NOW + 60000 });
    assert.match(api('social_list', {}).posts[0].platforms.instagram.error, /could not process the video \(ERROR\)/);
    const again = setup();
    try {
      again.api('social_post', { id: 'job1', platforms: ['instagram'], caption: 'Hi' });
      const pub = fakeMeta({ igStatus: ['PUBLISHED'] });
      await socialWorkerRun(again.db, again.cfg, { transport: pub.transport, prepare, now: NOW });
      await socialWorkerRun(again.db, again.cfg, { transport: pub.transport, prepare, now: NOW + 60000 });
      assert.equal(again.api('social_list', {}).posts[0].platforms.instagram.status, 'published');
      assert.ok(!pub.calls.some((c) => c.url.endsWith('/media_publish')));
    } finally { done(again.dir); }
  } finally { done(dir); }
});
