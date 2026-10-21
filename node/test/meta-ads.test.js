// Meta ads through the Marketing API. Meta is a fake: no request ever leaves this machine, nothing is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openMemoryDb } from '../src/lib/db.js';
import { jsonEncode } from '../src/lib/storedjson.js';
import { adApi } from '../src/lib/ads.js';
import { adsWorkerRun, metaAdsAccount } from '../src/lib/meta-ads.js';

const NOW = Date.parse('2026-10-21T17:00:00Z');
const FILE = 'a'.repeat(40) + '.mp4';
const MIN = 60000;
function setup({ connected = true } = {}) {
  const dir = mkdtempSync(tmpdir() + '/ga-metaads-');
  const cfg = { asset_dir: dir, data_dir: dir + '/data', facebook: { graph_version: 'v26.0' } };
  writeFileSync(dir + '/' + FILE, 'video');
  const db = openMemoryDb();
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run('job1', null, jsonEncode({ id: 'job1', client: 'golden-auto', vehicle: '2018 VOLVO XC90', stock: '324492', format: 'instagram_reels',
    duration: 30, price: 25988, finish_status: 'completed', captioned_url: 'https://staging.example.com:4343/assets/' + FILE, script: 'Take a look at this 2018 Volvo XC90.' }));
  if (connected) {
    db.exec('CREATE TABLE IF NOT EXISTS client_secrets (client TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT INTO client_secrets VALUES (?, ?)').run('golden-auto', jsonEncode({ facebook: { token: 'SYSTEM-USER-TOKEN', page_id: '1111111111',
      pages: [{ id: '1111111111', name: 'Golden Auto', token: 'PAGE-TOKEN', ig_id: '17840000000000000', ig_username: 'goldenauto' }, { id: '2222222222', name: 'Other Page', token: 'P2' }] } }));
  }
  let n = 0;
  const api = (a, inp, o = {}) => adApi(a, inp, db, { now: NOW, user: 'mark@example.com', random: () => Buffer.from([n++, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ...o });
  api('ad_settings_save', { client: 'golden-auto', meta_account: 'act_1331366881207657', meta_page: 'Golden Auto', radius_address: '24532 San Ramon Valley Blvd, San Ramon, CA', radius_miles: 15, daily_budget: 20, days: 7 });
  const { ad } = api('ad_request', { id: 'job1', platforms: ['meta'], daily_budget: 20, days: 7, start_date: '2026-10-22', radius_address: '24532 San Ramon Valley Blvd, San Ramon, CA',
    radius_miles: 15, text: 'Take a look at this 2018 Volvo XC90.', headline: '2018 Volvo XC90 · $25,988', link: 'https://mygoldenauto.net' });
  return { dir, cfg, db, api, id: ad.id, list: () => api('ad_list', { id: 'job1' }).ads[0].platforms.meta };
}
const done = (dir) => rmSync(dir, { recursive: true, force: true });

/** A fake Meta: answers by URL; every call is recorded (form bodies decoded). */
function fakeMeta({ video = ['ready'], account = { account_status: 1, currency: 'USD', timezone_offset_hours_utc: -7 }, fail = {} } = {}) {
  const calls = [];
  const transport = async (method, url, headers, body) => {
    const params = typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : null;
    calls.push({ method, url, headers, params, multipart: body instanceof FormData });
    for (const [part, r] of Object.entries(fail)) if (url.includes(part)) { if (r === 'network') throw new Error('socket hang up'); return r; }
    if (url.includes('/act_1331366881207657?fields=')) return { status: 200, json: account };
    if (url.includes('graph-video.facebook.com') && url.endsWith('/advideos')) return { status: 200, json: { id: '8001' } };
    if (url.includes('/8001?fields=')) return { status: 200, json: { status: { video_status: video.length > 1 ? video.shift() : video[0] }, thumbnails: { data: [{ uri: 'https://scontent.example/t1.jpg' }, { uri: 'https://scontent.example/t2.jpg', is_preferred: true }] } } };
    if (url.endsWith('/campaigns')) return { status: 200, json: { id: '120200000000001' } };
    if (url.endsWith('/adsets')) return { status: 200, json: { id: '120200000000002' } };
    if (url.endsWith('/adcreatives')) return { status: 200, json: { id: '120200000000003' } };
    if (url.endsWith('/ads')) return { status: 200, json: { id: '120200000000004' } };
    if (url.includes('/120200000000001/insights')) return { status: 200, json: { data: [{ spend: '12.34', impressions: '3400', clicks: '41' }] } };
    if (/\/12020000000000[1-4]$/.test(url) && method === 'POST') return { status: 200, json: { success: true } };
    return { status: 404, json: { error: { message: 'unexpected ' + url } } };
  };
  return { calls, transport };
}

test('the ad account and Page: the Page named in the ad settings, else the chosen one; config fallback', () => {
  const { db, cfg, dir } = setup();
  try {
    assert.deepEqual(metaAdsAccount(db, cfg, 'golden-auto', 'golden auto'), { token: 'SYSTEM-USER-TOKEN', page_id: '1111111111', ig_user_id: '17840000000000000' });
    assert.equal(metaAdsAccount(db, cfg, 'golden-auto', 'Other Page').page_id, '2222222222');
    assert.deepEqual(metaAdsAccount(db, { meta_accounts: { eastbay: { ads_token: 'T', page_id: '3333333333' } } }, 'eastbay'), { token: 'T', page_id: '3333333333', ig_user_id: '' });
    assert.deepEqual(metaAdsAccount(db, { ...cfg, meta_accounts: { 'golden-auto': { ads_token: 'ADS-TOKEN' } } }, 'golden-auto', 'Golden Auto'),
      { token: 'ADS-TOKEN', page_id: '1111111111', ig_user_id: '17840000000000000' }, 'a token made for ads wins; the Page still comes from the connection');
  } finally { done(dir); }
});

test('launch: upload from this server, wait for processing, everything created PAUSED with budget, area and end time', async () => {
  const { db, cfg, dir, list } = setup();
  try {
    const meta = fakeMeta({ video: ['processing', 'ready'] });
    const run = (t) => adsWorkerRun(db, cfg, { transport: meta.transport, now: t });
    assert.match((await run(NOW)).join(), /video uploaded/);
    assert.equal(list().status, 'launching');
    const up = meta.calls.find((c) => c.url.endsWith('/advideos'));
    assert.ok(up.multipart && up.url.startsWith('https://graph-video.facebook.com/v26.0/act_1331366881207657'), 'the file itself is uploaded');
    assert.equal(up.headers.Authorization, 'OAuth SYSTEM-USER-TOKEN');
    assert.deepEqual(await run(NOW + MIN), [], 'still processing: nothing created yet');
    assert.match((await run(NOW + 2 * MIN)).join(), /created paused \(campaign 120200000000001\)/);
    const x = list();
    assert.deepEqual([x.status, x.campaign_id, x.ad_set_id, x.creative_id, x.ad_id], ['launched_paused', '120200000000001', '120200000000002', '120200000000003', '120200000000004']);
    const p = (end) => meta.calls.find((c) => c.url.endsWith(end)).params;
    const c = p('/campaigns'), s = p('/adsets'), cr = p('/adcreatives'), ad = p('/ads');
    assert.deepEqual([c.objective, c.status, c.special_ad_categories, c.name], ['OUTCOME_TRAFFIC', 'PAUSED', '[]', '2018 VOLVO XC90 324492 2026-10-22']);
    assert.deepEqual([s.status, s.daily_budget, s.optimization_goal, s.campaign_id], ['PAUSED', '2000', 'LINK_CLICKS', '120200000000001']);
    // Oct 22 00:00 to Oct 29 00:00 in the account's time zone (UTC-7).
    assert.deepEqual([Number(s.start_time), Number(s.end_time)], [Date.parse('2026-10-22T07:00:00Z') / 1000, Date.parse('2026-10-29T07:00:00Z') / 1000]);
    assert.deepEqual(JSON.parse(s.targeting).geo_locations.custom_locations, [{ address_string: '24532 San Ramon Valley Blvd, San Ramon, CA', radius: 15, distance_unit: 'mile' }]);
    const story = JSON.parse(cr.object_story_spec);
    assert.deepEqual([story.page_id, story.instagram_user_id, story.video_data.video_id, story.video_data.image_url, story.video_data.call_to_action.value.link],
      ['1111111111', '17840000000000000', '8001', 'https://scontent.example/t2.jpg', 'https://mygoldenauto.net']);
    assert.deepEqual([ad.status, JSON.parse(ad.creative).creative_id], ['PAUSED', '120200000000003']);
    assert.ok(!meta.calls.some((c) => c.params?.status === 'ACTIVE'), 'nothing switched on');
    const before = meta.calls.length; await run(NOW + 3 * MIN);
    assert.equal(meta.calls.length, before, 'a paused ad with no request waits quietly');
  } finally { done(dir); }
});

test('Switch on, Pause, results, and the end date', async () => {
  const { db, cfg, dir, api, id, list } = setup();
  try {
    const meta = fakeMeta();
    const run = (t) => adsWorkerRun(db, cfg, { transport: meta.transport, now: t });
    assert.throws(() => api('ad_switch_on', { id }), /not created yet/);
    await run(NOW); await run(NOW + MIN);
    assert.equal(list().status, 'launched_paused');
    assert.throws(() => api('ad_switch_on', { id }, { allowed: ['eastbay'] }), /no access/);
    assert.match(api('ad_switch_on', { id }).message, /up to \$20 a day until 2026-10-28/);
    assert.match((await run(NOW + 2 * MIN)).join(), /switched on/);
    const on = meta.calls.filter((c) => c.params?.status === 'ACTIVE').map((c) => c.url.split('/').pop());
    assert.deepEqual(on, ['120200000000004', '120200000000002', '120200000000001'], 'ad, ad set and campaign');
    assert.deepEqual([list().status, list().stats.spend, list().stats.clicks], ['active', 12.34, 41]);
    api('ad_pause', { id });
    await run(NOW + 3 * MIN);
    assert.equal(list().status, 'paused');
    assert.equal(meta.calls.filter((c) => c.url.includes('/insights')).length, 1, 'results at most hourly');
    api('ad_switch_on', { id }); await run(NOW + 4 * MIN);
    assert.equal(list().status, 'active');
    assert.match((await run(Date.parse('2026-10-29T17:00:00Z'))).join(), /ended/);
    assert.equal(list().status, 'ended');
    const last = meta.calls.filter((c) => c.params?.status).at(-1);
    assert.deepEqual([last.url.split('/').pop(), last.params.status], ['120200000000001', 'PAUSED'], 'the campaign is paused at the end');
    assert.throws(() => api('ad_switch_on', { id }), /has ended/);
  } finally { done(dir); }
});

test('failures: closed ad account, not connected, a refusal halfway; Retry carries on without duplicates', async () => {
  const closed = setup();
  try {
    await adsWorkerRun(closed.db, closed.cfg, { transport: fakeMeta({ account: { account_status: 101, currency: 'USD' } }).transport, now: NOW });
    assert.deepEqual([closed.list().status, /cannot run ads \(status 101\)/.test(closed.list().error)], ['failed', true]);
  } finally { done(closed.dir); }
  const none = setup({ connected: false });
  try {
    const meta = fakeMeta();
    await adsWorkerRun(none.db, none.cfg, { transport: meta.transport, now: NOW });
    assert.match(none.list().error, /not connected/);
    assert.equal(meta.calls.length, 0);
  } finally { done(none.dir); }
  const half = setup();
  try {
    const refuse = fakeMeta({ fail: { '/adcreatives': { status: 400, json: { error: { message: 'Invalid parameter', error_user_msg: 'The Page cannot be used for this ad.', code: 100 } } } } });
    await adsWorkerRun(half.db, half.cfg, { transport: refuse.transport, now: NOW });
    await adsWorkerRun(half.db, half.cfg, { transport: refuse.transport, now: NOW + MIN });
    let x = half.list();
    assert.deepEqual([x.status, x.campaign_id, x.ad_set_id, x.creative_id ?? ''], ['failed', '120200000000001', '120200000000002', '']);
    assert.match(x.error, /The Page cannot be used for this ad\. \[code 100\]/);
    assert.throws(() => half.api('ad_switch_on', { id: half.id }), /not created yet/);
    half.api('ad_retry', { id: half.id });
    const ok = fakeMeta();
    await adsWorkerRun(half.db, half.cfg, { transport: ok.transport, now: NOW + 2 * MIN });
    await adsWorkerRun(half.db, half.cfg, { transport: ok.transport, now: NOW + 3 * MIN });
    x = half.list();
    assert.equal(x.status, 'launched_paused');
    assert.ok(!ok.calls.some((c) => /\/(campaigns|adsets|advideos)$/.test(c.url)), 'video, campaign and ad set were not made again');
  } finally { done(half.dir); }
});

test('a request cancelled before the worker reaches it is left alone', async () => {
  const { db, cfg, dir, api, id, list } = setup();
  try {
    api('ad_cancel', { id });
    const meta = fakeMeta();
    await adsWorkerRun(db, cfg, { transport: meta.transport, now: NOW });
    assert.deepEqual([list().status, meta.calls.length], ['canceled', 0]);
  } finally { done(dir); }
});
